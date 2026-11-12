// The Services page's "most booked" click counter at the edge (Cloudflare Pages Functions), replacing logClick(id) in
// apps-script/services/Code.gs: finds the service's row in the Services tab of the NuServices sheet and adds 1 to its Clicks cell.
// Answers like the old script: { success: true, clicks: n } or { success: false, error }.
//
// It WRITES, so it has its own opt-in Cloudflare secret SERVICES_SERVICE_ACCOUNT_JSON (a Google service account shared on the NuServices
// sheet as Editor; the read-only GOOGLE_SERVICE_ACCOUNT_JSON is deliberately never used for writes). Without it, or if Google refuses
// before anything is written, the click is passed on to the old Apps Script. A click goes to exactly ONE backend: if it is not
// certain whether the number was updated (a timeout), it is not retried anywhere, so it can never count twice.
import { parseServiceAccount, getAccessToken, SHEETS_WRITE_SCOPE } from './google.js';
import { SERVICES_SHEET_ID } from './services.js';
import { SERVICES_API_URL } from '../data/services.js';
import { rateLimitOk } from './payments.js';

export const SERVICES_TAB = 'Services';
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
export const CLICK_PER_SERVICE_MAX = 120; // flood guard per service per hour; only ever blocks the COUNTING of a click
export const CLICK_WINDOW_SECONDS = 3600;
export const MAX_ID_LENGTH = 100;
const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });
const colLetter = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Which cell to bump: { row, col, clicks } for the service, or { error } like logClick in Code.gs. `values` = the Services tab rows. */
export function findClickCell(values, id) {
  if (!id) return { error: 'Missing id' };
  const data = values || [];
  const header = data[0] || [];
  const idCol = header.indexOf('ID'), clicksCol = header.indexOf('Clicks');
  if (idCol === -1 || clicksCol === -1) return { error: 'Sheet missing ID/Clicks column' };
  for (let i = 1; i < data.length; i++) {
    const cell = (data[i] || [])[idCol];
    if (String(cell === undefined || cell === null ? '' : cell) === String(id)) {
      const raw = (data[i] || [])[clicksCol];
      return { row: i + 1, col: clicksCol + 1, clicks: (Number(raw === undefined ? '' : raw) || 0) + 1 };
    }
  }
  return { error: 'Service not found' };
}

/** The old backend, as the fallback: the click is passed on and its answer handed back. */
async function viaAppsScript(id, env) {
  try {
    const res = await fetch(`${env.SERVICES_APPS_SCRIPT_URL || SERVICES_API_URL}?action=click&id=${encodeURIComponent(id)}`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    JSON.parse(text);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });
  } catch (e) {
    return reply({ success: false, error: 'could not count the click' }, 502);
  }
}

export function clickStatus(env) {
  return reply({ status: 'ok', message: 'NuRenaissance services click counter is live.', mode: String(env.SERVICES_SERVICE_ACCOUNT_JSON || '').trim() ? 'sheet' : 'apps-script' });
}

/** POST (or GET) ?id=<service id>: count one click. */
export async function handleClick({ request, env }) {
  env = env || {};
  const url = new URL(request.url);
  let id = url.searchParams.get('id') || '';
  if (!id && request.method === 'POST') { try { id = String((JSON.parse(await request.text()) || {}).id || ''); } catch { /* no id */ } }
  id = String(id);
  if (!id) return reply({ success: false, error: 'Missing id' });
  if (id.length > MAX_ID_LENGTH) return reply({ success: false, error: 'Service not found' });
  if (!(await rateLimitOk('svcclick_' + id, CLICK_PER_SERVICE_MAX, CLICK_WINDOW_SECONDS))) return reply({ success: false, error: 'Rate limited' });

  const secret = String(env.SERVICES_SERVICE_ACCOUNT_JSON || '').trim();
  if (!secret) return viaAppsScript(id, env); // not switched over yet

  // Nothing has been written until the update request is sent, so anything before that can safely fall back.
  const sheet = /^[A-Za-z0-9_-]{20,100}$/.test(env.SERVICES_SHEET_ID || '') ? env.SERVICES_SHEET_ID : SERVICES_SHEET_ID;
  let token, cell;
  try {
    token = await getAccessToken(parseServiceAccount(secret), Date.now(), SHEETS_WRITE_SCOPE);
    const res = await fetch(`${API}${sheet}/values/${encodeURIComponent(SERVICES_TAB)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Sheets answered ${res.status}`);
    cell = findClickCell((await res.json()).values, id);
  } catch (e) { console.error('service click: could not read the Sheet, using Apps Script', e); return viaAppsScript(id, env); }
  if (cell.error) return reply({ success: false, error: cell.error });

  let res;
  try {
    res = await fetch(`${API}${sheet}/values/${encodeURIComponent(`${SERVICES_TAB}!${colLetter(cell.col)}${cell.row}`)}?valueInputOption=RAW`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [[cell.clicks]] }), signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error('service click: no answer while updating; not retrying', e); // may or may not be written: never count twice
    return reply({ success: false, error: 'could not confirm the click was counted' }, 502);
  }
  if (!res.ok) { console.error('service click: Sheets answered ' + res.status + ', using Apps Script'); return viaAppsScript(id, env); }
  return reply({ success: true, clicks: cell.clicks });
}
