// Tests for the Services page data read from the NuServices Google Sheet at the edge (src/edge/services.js and the `services` feed).
// Main proof: a DIFFERENTIAL test. The real getData() from apps-script/services/Code.gs runs in a sandbox with a fake Sheet,
// next to the new code, on the same rows (a realistic sheet, then hundreds of random ones); the JSON must match exactly.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildServicesData, readServicesRows, loadServices, SERVICES_SHEET_ID, TABS } from '../src/edge/services.js';
import { forgetToken } from '../src/edge/google.js';
import { serveFeed } from '../src/edge/feeds.js';

const GS = readFileSync(new URL('../apps-script/services/Code.gs', import.meta.url), 'utf8');
const SH = ['ID', 'Name', 'Icon', 'Tag', 'Description', 'Clicks', 'PricingModel', 'HourlyRate', 'FacilityHourlyRate', 'MinHours', 'PageRate', 'Deposit', 'DepositCredited'];
const TH = ['ServiceID', 'TierName', 'Price', 'Deposit', 'DepositCredited', 'TierDescription', 'SortOrder'];
const BH = ['BundleID', 'Name', 'RequiredServiceIDs', 'Description', 'Price'];
const pad = (r, n) => Array.from({ length: n }, (_, i) => (r[i] === undefined || r[i] === null ? '' : r[i])); // Apps Script: full-width rows
const trim = (r) => { const o = [...r]; while (o.length && (o[o.length - 1] === '' || o[o.length - 1] === undefined)) o.pop(); return o; }; // Google: cut short

/** What the old web app answered for these three tabs (header row first in each). */
function oldAnswer(s, t, b) {
  const tabs = { Services: [s[0], ...s.slice(1).map((r) => pad(r, s[0].length))], Service_Tiers: [t[0], ...t.slice(1).map((r) => pad(r, t[0].length))], Bundles: [b[0], ...b.slice(1).map((r) => pad(r, b[0].length))] };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => ({ getDataRange: () => ({ getValues: () => tabs[n].map((r) => [...r]) }) }) }) },
  });
  vm.runInContext(GS, ctx);
  return JSON.stringify(vm.runInContext('getData()', ctx));
}
const newAnswer = (s, t, b) => JSON.stringify(buildServicesData(s.map(trim), t.map(trim), b.map(trim)));

const S = [SH,
  ['video', 'Video', '🎬', 'Popular', 'Shoots', '57', 'hourly_plus_edit', '150', '300', 2, '', '100', 'yes'],
  ['web', 'Websites', '💻', '', 'Pages', 3, 'per_page', '', '', '', 200, 50, 'No'],
  ['music', 'Music', '🎵', 'New', 'Songs', 57, 'package', '', '', '', '', '', ''],
  ['studio', 'Studio', '', '', 'Hours', 0, 'hourly', 60, 90, 3, '', 25, 'YES'],
  ['', 'No id', '', '', '', 9],
  ['odd', 'Odd model', '', '', '', 'x', 'mystery', 10, 10, 1, 1, 1, 'yes'],
  [],
];
const T = [TH,
  ['music', 'Single', 300, 50, 'yes', 'One song', 2], ['music', 'EP', '800', 100, 'no', 'Five songs', 1], ['video', 'Basic edit', 200, 0, '', '', 1],
  ['video', 'Pro edit', 500, '', 'Yes', 'Colour', 2], ['', 'orphan', 1, 1, 'yes', '', 1], ['ghost', 'No service', 5, 5, '', '', 1], ['music', 'Late', 'n/a', 'n/a', 'yes', '', 'z'],
];
const B = [BH,
  ['b1', 'Launch', 'music, video ,', 'All in', 1500], ['b2', 'Solo', 'web', '', '900'], ['', 'no id', 'web', '', 1], ['b3', 'Empty', '', 'none', 'x'],
];

test('the new code gives exactly what the old Apps Script gave, on a realistic sheet', () => {
  const old = oldAnswer(S, T, B), now = newAnswer(S, T, B);
  assert.equal(now, old);
  const d = JSON.parse(now);
  assert.deepEqual(d.services.map((s) => [s.id, s.startingPrice, s.mostBooked]), [['video', 2 * 150 + 200 + 100, true], ['web', 250, false], ['music', 0, true], ['studio', 205, false], ['odd', 0, false]]);
  assert.deepEqual(d.services[2].tiers.map((t) => t.name), ['Late', 'EP', 'Single']);                       // sorted by SortOrder (a non-number counts as 0, so "Late" sorts first and sets the starting price)
  assert.deepEqual(d.bundles.map((b) => [b.id, b.requiredServiceIds]), [['b1', ['music', 'video']], ['b2', ['web']], ['b3', []]]);
});

test('sheets with only headers, and a missing column (the live Services tab has no MusicVideoDeposit), match', () => {
  assert.equal(newAnswer([SH], [TH], [BH]), oldAnswer([SH], [TH], [BH]));
  assert.equal(newAnswer([SH, ...S.slice(1)], [TH], [BH]), oldAnswer([SH, ...S.slice(1)], [TH], [BH]));
  const withMv = [[...SH, 'MusicVideoDeposit'], ['v', 'V', '', '', '', 1, 'package', '', '', '', '', '', '', 75]];
  assert.equal(newAnswer(withMv, [TH], [BH]), oldAnswer(withMv, [TH], [BH]));
  assert.equal(JSON.parse(newAnswer(withMv, [TH], [BH])).services[0].musicVideoDeposit, 75);
});

test('an empty tab is an error (the old script failed there too)', () => {
  assert.throws(() => buildServicesData([], [TH], [BH]), /Services tab is empty/);
  assert.throws(() => buildServicesData([SH], [], [BH]), /Service_Tiers tab is empty/);
  assert.throws(() => buildServicesData([SH], [TH], undefined), /Bundles tab is empty/);
});

test('300 random sheets give the same JSON as the old code', () => {
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pick = (a) => a[rnd(a.length)];
  const num = () => pick([0, 1, 57, 150.5, '12', '', ' ', 'abc', null, true, '0', '3.5', -4, 1e3]);
  const ids = ['a', 'b', 'c', 'd', 1, 2, ''];
  for (let n = 0; n < 300; n++) {
    const s = [SH], t = [TH], b = [BH];
    for (let i = rnd(7); i > 0; i--) s.push([pick(ids), pick(['N', '', 'Name']), pick(['', '🎬']), pick(['', 'Hot']), pick(['', 'D']), num(), pick(['package', 'hourly', 'hourly_plus_edit', 'per_page', '', 'zzz']), num(), num(), num(), num(), num(), pick(['yes', 'Yes', 'no', '', true, 'YES'])].slice(0, 6 + rnd(8)));
    for (let i = rnd(9); i > 0; i--) t.push([pick(ids), pick(['T', 'U', '']), num(), num(), pick(['yes', 'no', '', 'Yes']), pick(['', 'x']), num()].slice(0, 2 + rnd(6)));
    for (let i = rnd(4); i > 0; i--) b.push([pick(['b1', 'b2', '', 7]), 'B', pick(['a,b', ' a , c ', '', ',,', 'a']), pick(['', 'x']), num()].slice(0, 1 + rnd(5)));
    assert.equal(newAnswer(s, t, b), oldAnswer(s, t, b), JSON.stringify({ s, t, b }));
  }
});

// ---------------------------------------------------------------- reading through Google
let account, publicKey, pem, calls, sheetData, sheetStatus, store, appsScriptAnswer, tokenScopes;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = pair.publicKey;
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  account = { email: 'svc@nrn.iam.gserviceaccount.com', key: pem };
});
beforeEach(() => {
  forgetToken(); calls = []; tokenScopes = []; store = new Map(); appsScriptAnswer = null; sheetStatus = 200;
  sheetData = [S, T, B].map((x) => x.map(trim));
  globalThis.caches = { default: { match: async (r) => { const x = store.get(r.url); return x ? x.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') {
      const [h, c, sig] = new URLSearchParams(String(init.body)).get('assertion').split('.');
      assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64(sig), new TextEncoder().encode(`${h}.${c}`)));
      tokenScopes.push(JSON.parse(b64(c).toString()).scope);
      return json({ access_token: 'tok-' + tokenScopes.length, expires_in: 3600 });
    }
    if (u.hostname === 'sheets.googleapis.com') {
      calls.push({ path: decodeURIComponent(u.pathname), ranges: u.searchParams.getAll('ranges'), render: u.searchParams.get('valueRenderOption'), auth: init.headers?.authorization });
      return sheetStatus === 200 ? json({ valueRanges: sheetData.map((v) => (v.length ? { values: v } : {})) }) : json({ error: { message: 'no' } }, sheetStatus);
    }
    if (u.hostname === 'script.google.com') { calls.push('APPS-SCRIPT'); return appsScriptAnswer ? appsScriptAnswer() : json({ error: 'not available' }, 500); }
    throw new Error('unexpected fetch ' + u);
  };
});
const secret = () => JSON.stringify({ client_email: account.email, private_key: pem });

test('the three tabs are read in one request with a read-only Sheets sign-in, numbers kept as numbers', async () => {
  const d = await loadServices(secret());
  assert.equal(JSON.stringify(d), oldAnswer(S, T, B));
  assert.deepEqual(tokenScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, `/v4/spreadsheets/${SERVICES_SHEET_ID}/values:batchGet`);
  assert.deepEqual(calls[0].ranges, TABS); assert.equal(calls[0].render, 'UNFORMATTED_VALUE'); assert.equal(calls[0].auth, 'Bearer tok-1');
});

test('the sheet id is checked and Google errors are errors', async () => {
  await assert.rejects(readServicesRows('t', 'x/../y'), /bad services sheet id/);
  sheetStatus = 403; await assert.rejects(readServicesRows('t'), /Sheets answered 403/);
});

const ctx = (env) => ({ request: new Request('https://www.nrnszn.com/api/feed/services'), env, waitUntil: () => {} });
const oldBackend = { services: [{ id: 'old', name: 'From the old backend' }], bundles: [] };

test('feed: with the secret set the prices come from the Sheet, marked source "sheet", and the old backend is not called', async () => {
  const res = await serveFeed('services', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }));
  assert.equal(res.status, 200);
  const { source, ...rest } = await res.json();
  assert.equal(source, 'sheet'); assert.equal(JSON.stringify(rest), oldAnswer(S, T, B));
  assert.ok(!calls.includes('APPS-SCRIPT'));
  assert.equal((await serveFeed('services', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).headers.get('x-feed-cache'), 'HIT');
});

test('feed: a different Sheet can be set with SERVICES_SHEET_ID', async () => {
  await serveFeed('services', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret(), SERVICES_SHEET_ID: 'otherSheetId1234567890' }));
  assert.ok(calls[0].path.includes('/spreadsheets/otherSheetId1234567890/'));
});

test('feed: with no secret the old Apps Script answers exactly as before', async () => {
  appsScriptAnswer = () => json(oldBackend);
  const d = await (await serveFeed('services', ctx({}))).json();
  assert.equal(d.services[0].name, 'From the old backend'); assert.equal(d.source, undefined); assert.equal(tokenScopes.length, 0);
});

test('feed: if the Sheet fails or has no services the old backend answers; if both fail nothing is cached', async () => {
  appsScriptAnswer = () => json(oldBackend);
  sheetData = [[SH], [TH], [BH]];                                                                              // no services
  assert.equal((await (await serveFeed('services', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).json()).services[0].id, 'old');
  store.clear(); sheetData = [S, T, B].map((x) => x.map(trim)); sheetStatus = 403;                           // not shared yet
  assert.equal((await (await serveFeed('services', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).json()).services[0].id, 'old');
  store.clear(); appsScriptAnswer = () => json({ error: 'quota' }, 500);
  const down = await serveFeed('services', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }));
  assert.equal(down.status, 502); assert.equal(store.size, 0);
  assert.equal((await serveFeed('services', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: 'not json' }))).status, 502);
});
