// The Services page's lead capture at the edge (Cloudflare Pages Functions), replacing saveLead(p) in apps-script/services/Code.gs:
// when a visitor fills in the intake form (name, e-mail, phone, what they are after) one row is added to the "Clients" tab of the NuServices
// sheet: Timestamp, Name, Email, Role, HeardAbout, Budget, Timeline, Summary, Total, Phone, Location, Details. Answers like the old script:
// { success: true } or { success: false, error }.
//
// It WRITES, so it uses the same opt-in Cloudflare secret as the click counter, SERVICES_SERVICE_ACCOUNT_JSON (a Google service account
// shared on the NuServices sheet as Editor; the read-only key is never used for writes). Without it, or if Google refuses before anything is
// written, the lead is passed on to the old Apps Script unchanged. A lead goes to exactly ONE backend: if it is not certain whether the row was
// written (a timeout), it is not retried, so one visitor can never appear twice.
// Differences on purpose (a visitor must not be able to run a spreadsheet formula by typing one): text that starts with = + - @ is stored as plain
// text, cells are capped at 5000 characters, and at most 100 leads an hour are accepted (a bot guard).
import { parseServiceAccount, getAccessToken, SHEETS_WRITE_SCOPE } from './google.js';
import { SERVICES_SHEET_ID } from './services.js';
import { SERVICES_API_URL } from '../data/services.js';
import { rateLimitOk } from './payments.js';

export const CLIENTS_TAB = 'Clients';
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
export const LEADS_PER_HOUR = 100;
export const MAX_BODY = 20000;
export const MAX_CELL = 5000;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // same as EMAIL_RE in Code.gs (a test checks)
const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });

/** Text goes into the Sheet as typed, except that a leading = + - @ (or tab / carriage return) is kept as plain text, not run as a formula. */
export function cleanCell(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  let s = typeof v === 'object' ? String(v) : String(v);
  if (s.length > MAX_CELL) s = s.slice(0, MAX_CELL);
  return s && ['=', '+', '-', '@', '\t', '\r'].includes(s.charAt(0)) ? "'" + s : s;
}
/** "2026-11-12 14:03:22" in the sheet's own time zone; Google Sheets reads it as a real date and time. */
export function stampIn(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
/** Validation and the row, exactly like saveLead in Code.gs: { error } or { row }. */
export function buildLeadRow(p, stamp) {
  const name = p.name, email = p.email;
  if (!name || !email || typeof email !== 'string' || !EMAIL_RE.test(email)) return { error: 'Missing or invalid name/email' };
  return { row: [stamp, cleanCell(name), cleanCell(email), cleanCell(p.role || ''), cleanCell(p.heardAbout || ''), cleanCell(p.budget || ''), cleanCell(p.timeline || ''), cleanCell(p.summary || ''),
    Number(p.total) || 0, cleanCell(p.phone || ''), cleanCell(p.location || ''), cleanCell(p.details || '')] };
}

const zones = new Map();
/** The NuServices sheet's own time zone (looked up once and remembered); Nashville time if it cannot be read. */
async function sheetTimeZone(token, sheet) {
  if (zones.has(sheet)) return zones.get(sheet);
  let zone = 'America/Chicago';
  try {
    const res = await fetch(`${API}${sheet}?fields=properties.timeZone`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (res.ok) { const tz = (await res.json()).properties?.timeZone; if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; zones.set(sheet, zone); } }
  } catch { /* keep the default */ }
  return zone;
}
export const forgetZones = () => zones.clear();

/** The old backend, as the fallback: the lead is passed on unchanged and its answer handed back. */
async function viaAppsScript(text, env) {
  try {
    const res = await fetch(env.SERVICES_APPS_SCRIPT_URL || SERVICES_API_URL, { method: 'POST', body: text, headers: { 'content-type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const answer = await res.text(); JSON.parse(answer);
    return new Response(answer, { status: 200, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });
  } catch { return reply({ success: false, error: 'Something went wrong. Please try again or contact NuRenaissance Media directly.' }, 502); }
}

export function leadStatus(env) {
  return reply({ status: 'ok', message: 'NuRenaissance services lead capture is live.', mode: String(env.SERVICES_SERVICE_ACCOUNT_JSON || '').trim() ? 'sheet' : 'apps-script' });
}

/** POST: one lead, as the same JSON the page always sent ({ action: 'lead', name, email, ... }). */
export async function handleLead({ request, env }) {
  env = env || {};
  let text, p;
  try {
    text = await request.text();
    if (text.length > MAX_BODY) return reply({ success: false, error: 'Request too large' }, 413);
    p = JSON.parse(text);
    if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new TypeError('expected an object');
  } catch { return reply({ success: false, error: 'Invalid JSON' }); }

  const check = buildLeadRow(p, '');
  if (check.error) return reply({ success: false, error: check.error }); // nothing to save, nothing touched
  if (!(await rateLimitOk('svclead', LEADS_PER_HOUR, 3600))) return reply({ success: false, error: 'Too many requests, please try again later.' });

  const secret = String(env.SERVICES_SERVICE_ACCOUNT_JSON || '').trim();
  if (!secret) return viaAppsScript(text, env); // not switched over yet

  const sheet = /^[A-Za-z0-9_-]{20,100}$/.test(env.SERVICES_SHEET_ID || '') ? env.SERVICES_SHEET_ID : SERVICES_SHEET_ID;
  let token, row;
  try {
    token = await getAccessToken(parseServiceAccount(secret), Date.now(), SHEETS_WRITE_SCOPE);
    row = buildLeadRow(p, stampIn(new Date(), await sheetTimeZone(token, sheet))).row;
  } catch (e) { console.error('service lead: Google sign-in failed, using Apps Script', e); return viaAppsScript(text, env); } // nothing written yet

  let res;
  try {
    res = await fetch(`${API}${sheet}/values/${encodeURIComponent(CLIENTS_TAB + '!A:L')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [row] }), signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error('service lead: no answer while saving; not retrying', e); // may or may not be written: never save a visitor twice
    return reply({ success: false, error: 'Something went wrong. Please try again or contact NuRenaissance Media directly.' }, 502);
  }
  if (!res.ok) { console.error('service lead: Sheets answered ' + res.status + ', using Apps Script'); return viaAppsScript(text, env); } // Google refused: nothing was written
  return reply({ success: true });
}
