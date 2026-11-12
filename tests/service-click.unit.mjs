// Tests for the Services click counter at the edge (src/edge/service-click.js, functions/api/service-click.js).
// DIFFERENTIAL: the real logClick() from apps-script/services/Code.gs runs in a sandbox with an in-memory Services tab, next to the new
// code on a fake Google Sheets API, over the same ids and the same awkward Clicks cells. Answers and the resulting sheet must match.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost, onRequestOptions } from '../functions/api/service-click.js';
import { findClickCell, CLICK_PER_SERVICE_MAX, MAX_ID_LENGTH } from '../src/edge/service-click.js';
import { SERVICES_API_URL } from '../src/data/services.js';
import { SERVICES_SHEET_ID } from '../src/edge/services.js';
import { forgetToken, SHEETS_WRITE_SCOPE } from '../src/edge/google.js';

const GS = readFileSync(new URL('../apps-script/services/Code.gs', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../src/pages/services.astro', import.meta.url), 'utf8');
const HEADER = ['ID', 'Name', 'Icon', 'Tag', 'Description', 'Clicks', 'PricingModel'];
const SHEET = () => [HEADER, ['video', 'Video', '', '', '', 57, 'x'], ['web', 'Web', '', '', '', '3', 'x'], ['music', 'Music', '', '', '', '', 'x'], ['studio', 'Studio', '', '', '', 'abc', 'x'], [7, 'Seven', '', '', '', 0, 'x'], ['dup', 'First', '', '', '', 1, 'x'], ['dup', 'Second', '', '', '', 9, 'x']];

function oldWorld(rows) {
  const data = rows.map((r) => [...r]);
  const sheet = { getDataRange: () => ({ getValues: () => data.map((r) => [...r]) }), getRange: (r, c) => ({ setValue: (v) => { data[r - 1][c - 1] = v; } }) };
  const ctx = vm.createContext({ SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) } });
  vm.runInContext(GS, ctx);
  return { data, click: (id) => JSON.parse(JSON.stringify(vm.runInContext(`logClick(${JSON.stringify(id)})`, ctx))) };
}

let pem, rows, calls, scopes, store, mode, appsScript;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
});
beforeEach(() => {
  forgetToken(); calls = []; scopes = []; mode = {}; rows = SHEET(); store = new Map(); appsScript = () => json({ success: true, clicks: 999 });
  globalThis.caches = { default: { match: async (r) => { const x = store.get(r.url); return x ? x.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') {
      if (mode.signIn === 'fail') return json({ error: 'x' }, 400);
      scopes.push(JSON.parse(Buffer.from(new URLSearchParams(init.body).get('assertion').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).scope);
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    if (u.hostname === 'script.google.com') { calls.push('APPS-SCRIPT ' + u.search); return appsScript(); }
    if (u.hostname === 'sheets.googleapis.com') {
      const path = decodeURIComponent(u.pathname); calls.push((init.method || 'GET') + ' ' + path + ' ' + u.search);
      if (!init.method) { if (mode.read === 'refuse') return json({ error: 'no' }, 403); return json({ values: rows.map((r) => { const x = [...r]; while (x.length && x[x.length - 1] === '') x.pop(); return x; }) }); }
      if (mode.write === 'refuse') return json({ error: 'no' }, 403);
      if (mode.write === 'timeout') throw new DOMException('timed out', 'TimeoutError');
      const m = /!([A-Z]+)(\d+)$/.exec(path); rows[Number(m[2]) - 1][m[1].charCodeAt(0) - 65] = JSON.parse(init.body).values[0][0]; return json({});
    }
    throw new Error('unexpected fetch ' + u);
  };
});
const ENV = () => ({ SERVICES_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'svc@x.iam.gserviceaccount.com', private_key: pem }) });
const post = (id, env = ENV()) => onRequestPost({ request: new Request('https://www.nrnszn.com/api/service-click?id=' + encodeURIComponent(id), { method: 'POST' }), env });

test('the same answers and the same sheet as the old logClick, for every kind of service id and Clicks cell', async () => {
  const ids = ['video', 'web', 'music', 'studio', '7', 'dup', 'nope', 'VIDEO', ' video'];
  const old = oldWorld(SHEET());
  for (let round = 0; round < 3; round++) for (const id of ids) {
    const expected = old.click(id);
    const res = await post(id); const got = await res.json();
    assert.deepEqual(got, expected, id + ' round ' + round);
    for (let i = 0; i < old.data.length; i++) assert.equal(String(rows[i][5]), String(old.data[i][5]), id + ' row ' + (i + 1));
  }
  assert.deepEqual(old.click(''), { success: false, error: 'Missing id' });
  assert.deepEqual(await (await onRequestPost({ request: new Request('https://x/api/service-click', { method: 'POST' }), env: ENV() })).json(), { success: false, error: 'Missing id' });
});

test('a missing ID or Clicks column gives the same error as before', async () => {
  rows = [['Name', 'Clicks'], ['x', 1]];
  assert.deepEqual(await (await post('x')).json(), { success: false, error: 'Sheet missing ID/Clicks column' });
  assert.deepEqual(findClickCell([], 'a'), { error: 'Sheet missing ID/Clicks column' });
  assert.deepEqual(oldWorld([['Name', 'Clicks']]).click('a'), { success: false, error: 'Sheet missing ID/Clicks column' });
});

test('only the Clicks cell of that service row is written, with the Editor sign-in, as a plain number', async () => {
  await post('web');
  assert.deepEqual(scopes, [SHEETS_WRITE_SCOPE]);
  const put = calls.find((c) => c.startsWith('PUT')); assert.ok(put.includes(`/spreadsheets/${SERVICES_SHEET_ID}/values/Services!F3`)); assert.match(put, /valueInputOption=RAW/);
  assert.equal(rows[2][5], 4); assert.equal(rows[1][5], 57);
  await post('web', { ...ENV(), SERVICES_SHEET_ID: 'otherSheetId1234567890' }); assert.ok(calls.at(-2).includes('/spreadsheets/otherSheetId1234567890/'));
});

test('with no click key set the click goes to the old Apps Script and its answer comes back; a read-only key is never used', async () => {
  const res = await post('web', {}); assert.deepEqual(await res.json(), { success: true, clicks: 999 });
  assert.deepEqual(calls, [`APPS-SCRIPT ?action=click&id=web`]); assert.equal(scopes.length, 0);
  assert.ok(!SERVICES_API_URL.includes('sheets.googleapis'));
  calls.length = 0; await post('web', { GOOGLE_SERVICE_ACCOUNT_JSON: ENV().SERVICES_SERVICE_ACCOUNT_JSON }); assert.deepEqual(calls, ['APPS-SCRIPT ?action=click&id=web']);
});

test('if sign-in or the Sheet refuses (nothing written) the old Apps Script counts it instead', async () => {
  mode.signIn = 'fail'; assert.equal((await (await post('web')).json()).clicks, 999);
  forgetToken(); mode = { read: 'refuse' }; assert.equal((await (await post('web')).json()).clicks, 999);
  forgetToken(); mode = { write: 'refuse' }; assert.equal((await (await post('web')).json()).clicks, 999);
  forgetToken(); mode = {}; assert.equal((await (await post('web', { SERVICES_SERVICE_ACCOUNT_JSON: 'not json' })).json()).clicks, 999);
  assert.equal(rows[2][5], '3');
});

test('if it cannot be known whether the number was updated (a timeout) the click is NOT also sent to the old backend', async () => {
  mode.write = 'timeout'; const res = await post('web');
  assert.equal(res.status, 502); assert.equal((await res.json()).success, false); assert.ok(!calls.some((c) => c.startsWith('APPS-SCRIPT')));
});

test('if the old backend is also down the answer is a plain error, never a crash', async () => {
  appsScript = () => { throw new Error('offline'); }; assert.equal((await post('web', {})).status, 502);
  appsScript = () => new Response('<html>nope</html>'); assert.equal((await post('web', {})).status, 502);
});

test('a flood guard stops counting after 120 clicks an hour per service, and long or odd ids are refused without touching the Sheet', async () => {
  for (let i = 0; i < CLICK_PER_SERVICE_MAX; i++) await post('video');
  assert.deepEqual(await (await post('video')).json(), { success: false, error: 'Rate limited' });
  calls.length = 0;
  assert.deepEqual(await (await post('x'.repeat(MAX_ID_LENGTH + 1))).json(), { success: false, error: 'Service not found' }); assert.equal(calls.length, 0);
});

test('GET never counts (it only reports status); OPTIONS allows the embed', async () => {
  const s = await (await onRequestGet({ request: new Request('https://www.nrnszn.com/api/service-click?id=web'), env: ENV() })).json();
  assert.deepEqual([s.status, s.mode], ['ok', 'sheet']); assert.equal((await (await onRequestGet({ request: new Request('https://x/api/service-click'), env: {} })).json()).mode, 'apps-script');
  assert.equal(calls.length, 0); assert.equal(onRequestOptions().status, 204);
});

test('the Services page counts through the site endpoint first and only asks the Apps Script itself if that request fails', () => {
  assert.match(PAGE, /fetch\('\/api\/service-click\?id=' \+ encodeURIComponent\(id\), \{ method: 'POST' \}\)\.catch\(function \(\) \{\s*try \{ fetch\(SCRIPT_URL \+ '\?action=click&id='/);
});
