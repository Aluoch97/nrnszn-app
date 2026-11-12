// Tests for the payment-click logger at the edge (src/edge/payments.js, functions/api/payment.js).
// The main proof is a DIFFERENTIAL test: the real doPost() from apps-script/support/Code.gs runs in a sandbox next to the new
// code on the same payloads, and the row that would be written and the answer given must match. Google is faked.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  buildRow, normalizeChoice, clampAmount, sanitizeForSheet, formatTimestamp, rateLimitOk, handlePayment, paymentStatus,
  WIDGET_TOKEN, APPS_SCRIPT_URL, PAYMENTS_SHEET_ID, BRAND_CODES, CATEGORY_CODES, PLATFORM_CODES, MAX_AMOUNT, MAX_TEXT_LENGTH, CLICK_PER_PLATFORM_MAX,
} from '../src/edge/payments.js';
import { forgetToken, SHEETS_WRITE_SCOPE, SHEETS_SCOPE } from '../src/edge/google.js';
import { onRequestGet, onRequestPost, onRequestOptions } from '../functions/api/payment.js';

const GS = readFileSync(new URL('../apps-script/support/Code.gs', import.meta.url), 'utf8');
const WIDGET = readFileSync(new URL('../public/widgets/support.html', import.meta.url), 'utf8');

// ---------------------------------------------------------------- the old code, run as written
const HEADERS = ['Timestamp', 'Brand', 'Category', 'Platform', 'Amount', 'Name', 'Email', 'Note', 'Page', 'Confirmed'];
function oldDoPost(bodyText, { rateLimited = false } = {}) {
  const appended = [];
  const ctx = vm.createContext({
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({ getRange: () => ({ getValues: () => [HEADERS] }), appendRow: (r) => appended.push(r) }) }) },
    CacheService: { getScriptCache: () => ({ get: () => (rateLimited ? '99999' : null), put() {} }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (text) => ({ setMimeType: () => ({ text }) }) },
  });
  vm.runInContext(GS, ctx);
  vm.runInContext(`WIDGET_TOKEN = ${JSON.stringify(WIDGET_TOKEN)};`, ctx);
  const out = JSON.parse(vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(bodyText)} } })`, ctx).text);
  return { out, row: appended[0] ? Array.from(appended[0]) : undefined }; // copied out of the sandbox so deepEqual compares plain arrays
}

// ---------------------------------------------------------------- the fake Google and fake edge cache
let publicKey, pem, writes, calls, tokenScopes, store, signinStatus, sheetsMode, appsScript;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = pair.publicKey;
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
});
beforeEach(() => {
  forgetToken(); writes = []; calls = []; tokenScopes = []; store = new Map(); signinStatus = 200; sheetsMode = 'ok'; appsScript = () => json({ status: 'ok' });
  globalThis.caches = { default: { match: async (r) => { const x = store.get(r.url); return x ? x.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') {
      if (signinStatus !== 200) return json({ error: 'bad' }, signinStatus);
      const [h, c, s] = new URLSearchParams(String(init.body)).get('assertion').split('.');
      assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64(s), new TextEncoder().encode(`${h}.${c}`)));
      tokenScopes.push(JSON.parse(b64(c).toString()).scope);
      return json({ access_token: 'tok-1', expires_in: 3600 });
    }
    if (u.hostname === 'sheets.googleapis.com') {
      calls.push('SHEETS');
      if (sheetsMode === 'throw') throw new Error('network down');
      if (sheetsMode === 'forbidden') return json({ error: { message: 'no access' } }, 403);
      writes.push({ path: decodeURIComponent(u.pathname), query: Object.fromEntries(u.searchParams), auth: init.headers.authorization, method: init.method, body: JSON.parse(init.body) });
      return json({ updates: { updatedRows: 1 } });
    }
    if (u.hostname === 'script.google.com') { calls.push('APPS-SCRIPT:' + init.body); return appsScript(); }
    throw new Error('unexpected fetch ' + u);
  };
});
const secret = () => JSON.stringify({ client_email: 'payments@nrn.iam.gserviceaccount.com', private_key: pem });
const post = (body, env = {}) => handlePayment({ request: new Request('https://www.nrnszn.com/api/payment', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env });
const click = (o = {}) => ({ token: WIDGET_TOKEN, brand: 'nurenaissance', platform: 'paypal', name: 'Ana Ruiz', email: 'ana@example.com', note: 'for the shoot', page: 'https://www.nrnszn.com/about#support', ...o });

// ---------------------------------------------------------------- same behaviour as the old script
test('on a normal click the new code writes exactly the row the old script wrote, and answers the same', async () => {
  const body = JSON.stringify(click());
  const old = oldDoPost(body);
  const res = await post(body, { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() });
  assert.deepEqual(await res.json(), old.out);
  assert.deepEqual(old.out, { status: 'ok' });
  const now = writes[0].body.values[0];
  assert.deepEqual(now.slice(1), old.row.slice(1));                                                       // everything but the timestamp
  assert.equal(Object.prototype.toString.call(old.row[0]), '[object Date]'); assert.match(now[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.deepEqual(now.slice(1), ['nurenaissance', '', 'paypal', '', 'Ana Ruiz', 'ana@example.com', 'for the shoot', 'https://www.nrnszn.com/about#support', false]);
});

test('300 random payloads: the old and new code agree on every field written and on the answer', async () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const text = [undefined, null, '', 'plain', 'Ana', '=IMPORTXML("http://x")', '+1 615', '-5', '@evil', '\tTab', '\rCR', ' =space', 'x'.repeat(499), 'x'.repeat(500), 'x'.repeat(900), '=' + 'y'.repeat(600), 'émoji 🎤', 7, 0, false, true];
  const pools = {
    token: [WIDGET_TOKEN, WIDGET_TOKEN, WIDGET_TOKEN, 'wrong', '', undefined, null, 42],
    brand: [undefined, 'nurenaissance', 'NuRenaissance', 'nicolassoul', 'NICOLASSOUL', 'other', '', null, 5],
    category: [undefined, 'service', 'MERCH', 'ticket', 'donation', 'x', '', null],
    platform: [undefined, 'paypal', 'CashApp', 'cashapp', 'venmo', 'zelle', 'applepay', 'bitcoin', '', null, 3],
    amount: [undefined, null, '', 0, 5, 12.5, '12.5', 'abc', -1, -0.01, 1e9, 100000, 100001, '99999.99', true, [], {}, ' '],
    name: text, email: text, note: text, page: text,
  };
  for (let n = 0; n < 300; n++) {
    const data = {}; for (const k of Object.keys(pools)) { const v = pick(pools[k]); if (v !== undefined) data[k] = v; }
    const body = JSON.stringify(data), old = oldDoPost(body);
    writes = [];
    const out = await (await post(body, { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() })).json();
    assert.deepEqual(out, old.out, 'answer for #' + n + ' ' + body);
    if (old.row) { assert.equal(writes.length, 1); assert.deepEqual(writes[0].body.values[0].slice(1), old.row.slice(1), 'row for #' + n + ' ' + body); }
    else assert.equal(writes.length, 0, 'nothing may be written for #' + n + ' ' + body);
  }
});

test('bad input gets the same refusals as before and writes nothing', async () => {
  for (const [body, want] of [[click({ token: 'nope' }), 'Unauthorized'], [{ ...click(), token: undefined }, 'Unauthorized'], [click({ token: '' }), 'Unauthorized']]) {
    const out = await (await post(body, { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() })).json();
    assert.deepEqual(out, { status: 'error', message: want }); assert.deepEqual(out, oldDoPost(JSON.stringify(body)).out);
  }
  for (const bad of ['not json {', '', 'null', '[1,2]', '"text"', '42']) { const o = await (await post(bad, { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() })).json(); assert.equal(o.status, 'error', bad); }
  assert.equal(writes.length, 0); assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- the small rules
test('amounts, choices and text are cleaned by the same rules', () => {
  assert.equal(clampAmount(undefined), ''); assert.equal(clampAmount(''), ''); assert.equal(clampAmount(null), ''); assert.equal(clampAmount('x'), ''); assert.equal(clampAmount(-3), '');
  assert.equal(clampAmount(0), 0); assert.equal(clampAmount('12.50'), 12.5); assert.equal(clampAmount(100001), MAX_AMOUNT); assert.equal(clampAmount(1e12), MAX_AMOUNT);
  assert.equal(normalizeChoice('PayPal', PLATFORM_CODES), 'paypal'); assert.equal(normalizeChoice('bitcoin', PLATFORM_CODES), ''); assert.equal(normalizeChoice(null, BRAND_CODES), '');
  assert.equal(normalizeChoice('Merch', CATEGORY_CODES), 'merch');
  for (const f of ['=SUM(1)', '+1', '-1', '@a', '\tx', '\rx']) assert.equal(sanitizeForSheet(f), "'" + f, JSON.stringify(f));        // stored as text, never run as a formula
  assert.equal(sanitizeForSheet('safe = text'), 'safe = text'); assert.equal(sanitizeForSheet(null), ''); assert.equal(sanitizeForSheet(5), '5');
  assert.equal(sanitizeForSheet('x'.repeat(2000)).length, MAX_TEXT_LENGTH); assert.equal(sanitizeForSheet('=' + 'x'.repeat(600)).length, MAX_TEXT_LENGTH + 1);
});

test('the timestamp is in the sheet\'s Nashville time, in a form Google Sheets reads as a date', () => {
  assert.equal(formatTimestamp(new Date('2026-11-12T20:03:22Z')), '2026-11-12 14:03:22');                  // standard time, UTC-6
  assert.equal(formatTimestamp(new Date('2026-07-04T03:30:00Z')), '2026-07-03 22:30:00');                  // daylight time, UTC-5, still the 3rd
  assert.equal(formatTimestamp(new Date('2026-12-31T05:59:59Z')), '2026-12-30 23:59:59');
  assert.equal(formatTimestamp(new Date('2026-01-01T06:00:00Z')), '2026-01-01 00:00:00');                  // midnight is 00, not 24
  assert.deepEqual(buildRow(click(), new Date('2026-11-12T20:03:22Z')).slice(0, 5), ['2026-11-12 14:03:22', 'nurenaissance', '', 'paypal', '']);
});

test('the flood guard allows 1000 clicks per platform per hour, then starts again', async () => {
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < CLICK_PER_PLATFORM_MAX; i++) assert.equal(await rateLimitOk('payclick_paypal', CLICK_PER_PLATFORM_MAX, 3600, t0 + i), true);
  assert.equal(await rateLimitOk('payclick_paypal', CLICK_PER_PLATFORM_MAX, 3600, t0 + 5000), false);        // the 1001st
  assert.equal(await rateLimitOk('payclick_venmo', CLICK_PER_PLATFORM_MAX, 3600, t0 + 5000), true);          // other platforms are separate
  assert.equal(await rateLimitOk('payclick_paypal', CLICK_PER_PLATFORM_MAX, 3600, t0 + 3601 * 1000), true);  // a new hour
});

test('an unknown platform is logged blank and counted in its own bucket; a rate-limited click is refused without being written', async () => {
  const env = { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() };
  await post(click({ platform: 'bitcoin' }), env);
  assert.equal(writes[0].body.values[0][3], '');
  const t = Date.now();
  for (let i = 0; i < CLICK_PER_PLATFORM_MAX; i++) await rateLimitOk('payclick_zelle', CLICK_PER_PLATFORM_MAX, 3600, t);
  writes = [];
  assert.deepEqual(await (await post(click({ platform: 'zelle' }), env)).json(), { status: 'error', message: 'Rate limited' });
  assert.equal(writes.length, 0);
  assert.deepEqual(oldDoPost(JSON.stringify(click({ platform: 'zelle' })), { rateLimited: true }).out, { status: 'error', message: 'Rate limited' });   // the old script said the same
});

// ---------------------------------------------------------------- writing to the sheet
test('a click is appended to the Payments tab with the read-write Sheets sign-in, as typed values', async () => {
  const res = await post(click({ amount: '25', note: '=HYPERLINK("x")' }), { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() });
  assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(writes.length, 1);
  const w = writes[0];
  assert.equal(w.method, 'POST'); assert.equal(w.auth, 'Bearer tok-1');
  assert.equal(w.path, `/v4/spreadsheets/${PAYMENTS_SHEET_ID}/values/Payments!A:J:append`);
  assert.deepEqual(w.query, { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' });
  assert.deepEqual(tokenScopes, [SHEETS_WRITE_SCOPE]); assert.ok(SHEETS_WRITE_SCOPE.endsWith('/spreadsheets') && !SHEETS_WRITE_SCOPE.includes('drive'));
  assert.equal(w.body.values[0][4], 25); assert.equal(w.body.values[0][7], "'=HYPERLINK(\"x\")"); assert.equal(w.body.values[0][9], false);
  assert.equal(calls.filter((c) => c.startsWith('APPS-SCRIPT')).length, 0);
});

test('a different payments sheet can be set with PAYMENTS_SHEET_ID, but only a well-formed id', async () => {
  await post(click(), { PAYMENTS_SERVICE_ACCOUNT_JSON: secret(), PAYMENTS_SHEET_ID: 'otherSheetIdForTesting123' });
  assert.ok(writes[0].path.includes('/spreadsheets/otherSheetIdForTesting123/'));
  writes = [];
  await post(click(), { PAYMENTS_SERVICE_ACCOUNT_JSON: secret(), PAYMENTS_SHEET_ID: 'x/../y' });
  assert.ok(writes[0].path.includes(PAYMENTS_SHEET_ID));
});

test('the widget token can be changed in Cloudflare without a deploy', async () => {
  await post(click({ token: 'new-token' }), { PAYMENTS_SERVICE_ACCOUNT_JSON: secret(), PAYMENT_WIDGET_TOKEN: 'new-token' });
  assert.equal(writes.length, 1);
  assert.deepEqual(await (await post(click(), { PAYMENTS_SERVICE_ACCOUNT_JSON: secret(), PAYMENT_WIDGET_TOKEN: 'new-token' })).json(), { status: 'error', message: 'Unauthorized' });
});

// ---------------------------------------------------------------- the fallback, and never logging twice
test('with no payments key set, the click goes to the old Apps Script unchanged and its answer comes back', async () => {
  const body = JSON.stringify(click({ note: 'hello' }));
  const res = await post(body, {});
  assert.deepEqual(await res.json(), { status: 'ok' });
  assert.equal(writes.length, 0); assert.equal(tokenScopes.length, 0);
  assert.deepEqual(calls, ['APPS-SCRIPT:' + body]);
});

test('a read-only gallery/cinema key is never used for payments: only PAYMENTS_SERVICE_ACCOUNT_JSON switches this on', async () => {
  await post(click(), { GOOGLE_SERVICE_ACCOUNT_JSON: secret() });
  assert.equal(writes.length, 0); assert.equal(tokenScopes.length, 0); assert.equal(calls.length, 1); assert.ok(calls[0].startsWith('APPS-SCRIPT'));
});

test('if Google sign-in or the sheet refuses (nothing written), the old Apps Script logs it instead', async () => {
  const env = { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() };
  signinStatus = 400;
  assert.deepEqual(await (await post(click(), env)).json(), { status: 'ok' });
  assert.equal(calls.filter((c) => c.startsWith('APPS-SCRIPT')).length, 1); assert.equal(writes.length, 0);
  signinStatus = 200; forgetToken(); calls = []; sheetsMode = 'forbidden';
  assert.deepEqual(await (await post(click(), env)).json(), { status: 'ok' });
  assert.deepEqual(calls.map((c) => c.split(':')[0]), ['SHEETS', 'APPS-SCRIPT']);
  calls = [];
  assert.deepEqual(await (await post(click(), { PAYMENTS_SERVICE_ACCOUNT_JSON: 'not json' })).json(), { status: 'ok' });   // a mistyped secret still logs the click
  assert.deepEqual(calls.map((c) => c.split(':')[0]), ['APPS-SCRIPT']);
});

test('if it cannot be known whether the row was written (a timeout), the click is NOT sent to the old backend as well', async () => {
  sheetsMode = 'throw';
  const res = await post(click(), { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() });
  assert.equal(res.status, 502); assert.equal((await res.json()).status, 'error');
  assert.deepEqual(calls, ['SHEETS']);                                                                          // never also Apps Script: no double-logged payment
});

test('if the old backend is also down the answer is a plain error, never a crash', async () => {
  appsScript = () => { throw new Error('offline'); };
  const res = await post(click(), {});
  assert.equal(res.status, 502); assert.equal((await res.json()).status, 'error');
  appsScript = () => json({ error: 'x' }, 500);
  assert.equal((await post(click(), {})).status, 502);
});

// ---------------------------------------------------------------- the endpoint
test('the endpoint: GET says it is alive without writing, OPTIONS allows the embed, an oversized body is refused', async () => {
  const get = await onRequestGet({ env: {} });
  assert.deepEqual(await get.json(), { status: 'ok', message: 'NuRenaissance payment logger is live.', mode: 'apps-script' });
  assert.equal((await (await onRequestGet({ env: { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() } })).json()).mode, 'sheet');
  assert.deepEqual(await (await paymentStatus({})).json(), await (await onRequestGet({ env: {} })).json());
  const opt = onRequestOptions(); assert.equal(opt.status, 204); assert.match(opt.headers.get('access-control-allow-methods'), /POST/);
  const big = await onRequestPost({ request: new Request('https://x/api/payment', { method: 'POST', body: JSON.stringify(click({ note: 'x'.repeat(30000) })) }), env: { PAYMENTS_SERVICE_ACCOUNT_JSON: secret() } });
  assert.equal(big.status, 413); assert.equal(writes.length, 0);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- the copies stay in step
test('the token, Apps Script address and sheet id here match the widget page and the Apps Script backup', () => {
  assert.equal((/var WIDGET_TOKEN = '([^']+)'/.exec(WIDGET) || [])[1], WIDGET_TOKEN);
  assert.equal((/var SCRIPT_URL = '([^']+)'/.exec(WIDGET) || [])[1], APPS_SCRIPT_URL);
  assert.equal((/var SHEET_ID = '([^']+)'/.exec(GS) || [])[1], PAYMENTS_SHEET_ID);
  assert.deepEqual(BRAND_CODES, ['nurenaissance', 'nicolassoul']);
  const num = (name) => Number((new RegExp(`var ${name} = (\\d+)`).exec(GS) || [])[1]);
  assert.equal(num('MAX_AMOUNT'), MAX_AMOUNT); assert.equal(num('MAX_TEXT_LENGTH'), MAX_TEXT_LENGTH); assert.equal(num('CLICK_PER_PLATFORM_MAX'), CLICK_PER_PLATFORM_MAX);
});

test('the widget sends clicks to the site endpoint first and keeps the old address as its fallback; the daily check still finds it', () => {
  assert.match(WIDGET, /var EDGE_URL = [^;]*'\/api\/payment'[^;]*'https:\/\/www\.nrnszn\.com\/api\/payment'/);
  assert.match(WIDGET, /fetch\(EDGE_URL, options\)\.catch\(function \(\) \{\s*try \{ fetch\(SCRIPT_URL, options\)/);
  assert.match(WIDGET, /var SCRIPT_URL = 'https:\/\/script\.google\.com\/macros\/s\/[^']+';/);
  assert.ok(SHEETS_SCOPE.endsWith('readonly'));
});
