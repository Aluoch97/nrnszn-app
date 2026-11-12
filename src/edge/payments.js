// The payment-click logger at the edge (Cloudflare Pages Functions), replacing the Apps Script web app
// (apps-script/support/Code.gs doPost): one row per click on a payment button is added to the "Payments" tab of the
// NuRenaissance Payments Log sheet (the Dashboard and Expenses tabs keep working from it, untouched).
// It logs the CLICK only; it never touches money and never blocks anyone from paying (the widget sends it fire-and-forget).
//
// It writes with its OWN Google service account (Cloudflare secret PAYMENTS_SERVICE_ACCOUNT_JSON), shared on the Payments Log
// sheet as Editor, separate from the read-only gallery/cinema account. Without that secret, or if Google refuses, the click is
// passed on to the old Apps Script exactly as before. A click is never sent to both: if it is not certain a row was NOT written
// (a timeout while writing), nothing is retried, so a payment is never logged twice.
import { parseServiceAccount, getAccessToken, SHEETS_WRITE_SCOPE } from './google.js';

export const PAYMENTS_SHEET_ID = '1aNyLjchT3jwzlY93p_h70gNtUhzge-m0nNx-sHpF2sA'; // "NuRenaissance Payments Log" (an address, not a secret)
export const PAYMENTS_TAB = 'Payments';
// Same as WIDGET_TOKEN in public/widgets/support.html. Not a secret: it is visible in that page, and only keeps bots that scan
// for open endpoints from writing straight into the sheet. (A test keeps the two copies equal.)
export const WIDGET_TOKEN = '3jf78s0qAlYtnwzyYU_gipkiGaZmmG_u';
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby8Dg2gYDBa5KDlUAkSiyb__mRKa4_Y94O1JChC9AIKhAnCXYC6gAt-NhWQwdXe4Lp1gA/exec';

// The widget only ever sends these; anything else is logged as blank so the Dashboard's totals stay trustworthy.
export const BRAND_CODES = ['nurenaissance', 'nicolassoul'];
export const CATEGORY_CODES = ['service', 'merch', 'ticket', 'donation'];
export const PLATFORM_CODES = ['paypal', 'cashapp', 'venmo', 'zelle', 'applepay'];
export const MAX_AMOUNT = 100000; // clamp any larger amount (the highest per-category cap in the widget is $100,000)
export const MAX_TEXT_LENGTH = 500;
export const CLICK_PER_PLATFORM_MAX = 1000; // flood guard per platform per hour; only ever blocks the LOGGING of a click
export const CLICK_WINDOW_SECONDS = 3600;
const MAX_BODY = 20000;
const SHEET_TIMEZONE = 'America/Chicago'; // the Payments Log sheet's time zone
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' };

// ---------------------------------------------------------------- the small rules (ported from Code.gs)
export const normalizeChoice = (value, codes) => {
  const v = value === null || value === undefined ? '' : String(value).toLowerCase();
  return codes.includes(v) ? v : '';
};

export function clampAmount(value) {
  if (value === '' || value === undefined || value === null) return ''; // "not specified" stays blank, not $0
  const n = Number(value);
  if (isNaN(n) || n < 0) return '';
  return Math.min(n, MAX_AMOUNT);
}

/** Caps the length AND stops spreadsheet formula injection: text starting with = + - @ (or a tab / carriage return) is stored as plain text. */
export function sanitizeForSheet(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (s.length > MAX_TEXT_LENGTH) s = s.slice(0, MAX_TEXT_LENGTH);
  if (s && ['=', '+', '-', '@', '\t', '\r'].includes(s.charAt(0))) s = "'" + s;
  return s;
}

const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: SHEET_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** "2026-11-12 14:03:22" in the sheet's time zone; Google Sheets reads it as a real date and time. */
export function formatTimestamp(date) {
  const p = Object.fromEntries(stamp.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** The row for the Payments tab: Timestamp, Brand, Category, Platform, Amount, Name, Email, Note, Page, Confirmed. */
export function buildRow(data, now = new Date()) {
  return [
    formatTimestamp(now),
    normalizeChoice(data.brand, BRAND_CODES),
    normalizeChoice(data.category, CATEGORY_CODES),
    normalizeChoice(data.platform, PLATFORM_CODES),
    clampAmount(data.amount),
    sanitizeForSheet(data.name || ''),
    sanitizeForSheet(data.email || ''),
    sanitizeForSheet(data.note || ''),
    sanitizeForSheet(data.page || ''),
    false, // Confirmed: you tick this yourself once you have checked the money landed
  ];
}

/** At most `max` per window per key (a simple flood guard; kept per Cloudflare data centre, so it is approximate). */
export async function rateLimitOk(key, max, windowSeconds, now = Date.now()) {
  const cache = caches.default, req = new Request('https://rate.payments.invalid/' + encodeURIComponent(key));
  const hit = await cache.match(req);
  let state = hit ? await hit.json() : null;
  if (!state || now >= state.until) state = { n: 0, until: now + windowSeconds * 1000 };
  if (state.n >= max) return false;
  state.n++;
  await cache.put(req, new Response(JSON.stringify(state), { headers: { 'cache-control': `max-age=${Math.max(1, Math.ceil((state.until - now) / 1000))}` } }));
  return true;
}

// ---------------------------------------------------------------- the request
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });

/** The old backend, as the fallback. The click is passed on unchanged and its answer is handed back. */
async function viaAppsScript(text, env) {
  try {
    const res = await fetch(env.PAYMENTS_APPS_SCRIPT_URL || APPS_SCRIPT_URL, { method: 'POST', body: text, headers: { 'content-type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return new Response(await res.text(), { status: res.ok ? 200 : 502, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });
  } catch (e) {
    return reply({ status: 'error', message: 'could not log the click: ' + String(e && e.message || e) }, 502);
  }
}

/** GET: a harmless "is it alive" answer, like the old doGet, plus which backend would log a click. */
export function paymentStatus(env) {
  return reply({ status: 'ok', message: 'NuRenaissance payment logger is live.', mode: env.PAYMENTS_SERVICE_ACCOUNT_JSON ? 'sheet' : 'apps-script' });
}

/** POST: log one click. Same checks, same answers ({status:'ok'} or {status:'error', message}) as the Apps Script doPost. */
export async function handlePayment({ request, env }) {
  let text;
  try {
    text = await request.text();
    if (text.length > MAX_BODY) return reply({ status: 'error', message: 'Request too large' }, 413);
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object') throw new TypeError('expected an object');

    if (data.token !== (env.PAYMENT_WIDGET_TOKEN || WIDGET_TOKEN)) return reply({ status: 'error', message: 'Unauthorized' });
    const platform = normalizeChoice(data.platform, PLATFORM_CODES);
    if (!(await rateLimitOk('payclick_' + (platform || 'unknown'), CLICK_PER_PLATFORM_MAX, CLICK_WINDOW_SECONDS))) return reply({ status: 'error', message: 'Rate limited' });

    const secret = String(env.PAYMENTS_SERVICE_ACCOUNT_JSON || '').trim();
    if (!secret) return viaAppsScript(text, env); // not switched over yet

    // Everything up to the moment the row is sent can safely fall back to the old backend: nothing has been written.
    const row = buildRow(data);
    let token;
    try { token = await getAccessToken(parseServiceAccount(secret), Date.now(), SHEETS_WRITE_SCOPE); }
    catch (e) { console.error('payments: Google sign-in failed, using Apps Script', e); return viaAppsScript(text, env); }

    let res;
    try {
      const sheet = /^[A-Za-z0-9_-]{20,100}$/.test(env.PAYMENTS_SHEET_ID || '') ? env.PAYMENTS_SHEET_ID : PAYMENTS_SHEET_ID;
      res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/${encodeURIComponent(PAYMENTS_TAB + '!A:J')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ values: [row] }), signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      // Cannot tell whether the row was written: do NOT also send it to the old backend (that could log a payment twice).
      console.error('payments: no answer while writing the row; not retrying', e);
      return reply({ status: 'error', message: 'could not confirm the click was logged' }, 502);
    }
    if (!res.ok) { console.error('payments: Sheets answered ' + res.status + ', using Apps Script'); return viaAppsScript(text, env); } // Google refused: nothing was written
    return reply({ status: 'ok' });
  } catch (err) {
    return reply({ status: 'error', message: String(err) });
  }
}
