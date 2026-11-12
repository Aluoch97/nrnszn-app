// Tests for the Services lead capture at the edge (src/edge/service-lead.js, functions/api/service-lead.js).
// DIFFERENTIAL: the real saveLead() from apps-script/services/Code.gs runs in a sandbox with an in-memory Clients tab, next to the new code on a
// fake Google Sheets API, over the same visitors (good, missing name, bad e-mail, odd types, empty optional fields). Answers and the row written
// must match, apart from the deliberate differences (formula-looking text kept as text; a time-zone-correct timestamp).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost, onRequestOptions } from '../functions/api/service-lead.js';
import { buildLeadRow, cleanCell, stampIn, forgetZones, EMAIL_RE, LEADS_PER_HOUR, MAX_BODY, MAX_CELL } from '../src/edge/service-lead.js';
import { SERVICES_API_URL } from '../src/data/services.js';
import { SERVICES_SHEET_ID } from '../src/edge/services.js';
import { forgetToken, SHEETS_WRITE_SCOPE } from '../src/edge/google.js';

const GS = readFileSync(new URL('../apps-script/services/Code.gs', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../src/pages/services.astro', import.meta.url), 'utf8');
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

function oldWorld() {
  const rows = []; const sheet = { appendRow: (r) => rows.push([...r]) };
  const ctx = vm.createContext({ SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => (n === 'Clients' ? sheet : null) }) } });
  vm.runInContext(GS, ctx);
  return { rows, save: (p) => JSON.parse(JSON.stringify(vm.runInContext(`saveLead(${JSON.stringify(p)})`, ctx))) };
}

let pem, written, calls, scopes, store, mode, appsScript;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
});
beforeEach(() => {
  forgetToken(); forgetZones(); calls = []; scopes = []; written = []; mode = { zone: 'America/Los_Angeles' }; store = new Map();
  appsScript = () => json({ success: true, from: 'old' });
  globalThis.caches = { default: { match: async (r) => { const x = store.get(r.url); return x ? x.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') {
      if (mode.signIn === 'fail') return json({ error: 'x' }, 400);
      scopes.push(JSON.parse(Buffer.from(new URLSearchParams(init.body).get('assertion').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).scope);
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    if (u.hostname === 'script.google.com') { calls.push('APPS-SCRIPT ' + init.body); return appsScript(); }
    if (u.hostname === 'sheets.googleapis.com') {
      const path = decodeURIComponent(u.pathname); calls.push((init.method || 'GET') + ' ' + path + u.search);
      if (u.searchParams.get('fields') === 'properties.timeZone') return mode.zone ? json({ properties: { timeZone: mode.zone } }) : json({}, 403);
      if (mode.append === 'refuse') return json({ error: 'no' }, 400);
      if (mode.append === 'timeout') throw new DOMException('timed out', 'TimeoutError');
      written.push({ row: JSON.parse(init.body).values[0], query: Object.fromEntries(u.searchParams), path }); return json({ updates: { updatedRange: 'Clients!A2:L2' } });
    }
    throw new Error('unexpected fetch ' + u);
  };
});
const ENV = () => ({ SERVICES_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'svc@x.iam.gserviceaccount.com', private_key: pem }) });
const post = (body, env = ENV(), raw) => onRequestPost({ request: new Request('https://www.nrnszn.com/api/service-lead', { method: 'POST', body: raw ?? JSON.stringify(body) }), env });
const GOOD = { action: 'lead', name: 'Ana Diaz', email: 'ana@example.com', phone: '615 555 0100', location: 'Nashville, TN', role: 'Artist', heardAbout: 'Instagram', timeline: 'ASAP', details: 'Need a music video', summary: 'Video: 1 shoot', total: 1250 };
const normNew = (r) => r.map((v, i) => (i === 0 ? '<ts>' : typeof v === 'string' && /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v));
const normOld = (r) => r.map((v, i) => (i === 0 ? '<ts>' : v));

test('a normal lead writes the same row as the old saveLead and answers the same', async () => {
  const old = oldWorld(); const expected = old.save(GOOD);
  const res = await post(GOOD);
  assert.deepEqual(await res.json(), expected); assert.deepEqual(expected, { success: true });
  assert.deepEqual(normNew(written[0].row), normOld(old.rows[0]));
  assert.ok(isDate(old.rows[0][0])); assert.match(written[0].row[0], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('400 random visitors (missing or bad names and e-mails, numbers, blanks, odd text) give the same answers and rows', async () => {
  let seed = 99; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pick = (a) => a[rnd(a.length)];
  const old = oldWorld(); let saved = 0;
  for (let n = 0; n < 400; n++) {
    const p = { action: 'lead' };
    for (const [k, vals] of Object.entries({
      name: ['Ana', '', 0, 'Zoë "Z" O\'Neil', 'x'.repeat(300), undefined, null, 42, false, 'Ünï'], email: ['a@b.co', 'bad', '', 'a@b', ' a@b.co', 'x y@z.co', 12, undefined, 'e@x.io', 'a@b.c@d.e'],
      role: ['Artist', '', undefined, 0, 'Manager'], heardAbout: ['Instagram', '', undefined, 'Friend'], budget: ['', '$500', undefined, 800], timeline: ['ASAP', '', undefined],
      summary: ['Video: 1 shoot', '', undefined, 'a\nb'], total: [0, 100, '250', 'abc', undefined, null, '12.5', -3, 1e6], phone: ['615', '', undefined, 6155550100],
      location: ['Nashville', '', undefined], details: ['Need help', '', undefined, 'multi\nline', '<b>x</b>'],
    })) { const v = pick(vals); if (v !== undefined) p[k] = v; }
    const expected = old.save(p); const got = await (await post(p)).json();
    assert.deepEqual(got, expected, JSON.stringify(p));
    if (expected.success) { saved++; assert.deepEqual(normNew(written.at(-1).row), normOld(old.rows.at(-1)), JSON.stringify(p)); }
  }
  assert.equal(written.length, saved); assert.equal(old.rows.length, saved); assert.ok(saved > 50 && saved < 400);
  assert.equal(EMAIL_RE.source, /var EMAIL_RE = (.*);/.exec(GS)[1].slice(1, -1));
});

test('formula-looking text is stored as plain text, long text is cut, and numbers stay numbers', async () => {
  await post({ ...GOOD, name: '=IMPORTXML("http://x")', phone: '+1 615 555 0100', details: '@SUM(1)', summary: '-5', location: 'x'.repeat(MAX_CELL + 50), total: '300' });
  const r = written[0].row;
  assert.equal(r[1], '\'=IMPORTXML("http://x")'); assert.equal(r[9], "'+1 615 555 0100"); assert.equal(r[11], "'@SUM(1)"); assert.equal(r[7], "'-5");
  assert.equal(r[10].length, MAX_CELL); assert.equal(r[8], 300); assert.equal(written[0].query.valueInputOption, 'USER_ENTERED');
  assert.equal(cleanCell(null), ''); assert.equal(cleanCell(7), 7); assert.equal(cleanCell(true), true); assert.equal(cleanCell('plain'), 'plain');
});

test('the row goes to the Clients tab of the NuServices sheet with the Editor sign-in; the time is in the sheet\'s own time zone', async () => {
  await post(GOOD);
  assert.deepEqual([...new Set(scopes)], [SHEETS_WRITE_SCOPE]);
  assert.equal(written[0].path, `/v4/spreadsheets/${SERVICES_SHEET_ID}/values/Clients!A:L:append`);
  assert.ok(calls.some((c) => c.includes('fields=properties.timeZone')));
  const d = new Date('2026-11-12T20:00:00Z');
  assert.equal(stampIn(d, 'America/Los_Angeles'), '2026-11-12 12:00:00'); assert.equal(stampIn(d, 'America/Chicago'), '2026-11-12 14:00:00');
  assert.equal(buildLeadRow(GOOD, 'T').row[0], 'T');
  await post(GOOD, { ...ENV(), SERVICES_SHEET_ID: 'otherSheetId1234567890' }); assert.ok(written.at(-1).path.includes('/spreadsheets/otherSheetId1234567890/'));
  mode.zone = null; forgetZones(); await post(GOOD); assert.equal(written.length, 3);                       // an unreadable time zone never loses a lead
});

test('with no key set the old Apps Script takes the lead unchanged and its answer comes back; invalid leads never leave the site', async () => {
  const res = await post(GOOD, {}); assert.deepEqual(await res.json(), { success: true, from: 'old' });
  assert.deepEqual(calls, ['APPS-SCRIPT ' + JSON.stringify(GOOD)]); assert.equal(scopes.length, 0);
  calls.length = 0; assert.deepEqual(await (await post({ ...GOOD, email: 'nope' }, {})).json(), { success: false, error: 'Missing or invalid name/email' }); assert.equal(calls.length, 0);
});

test('if sign-in or the Sheet refuses (nothing written) the old Apps Script takes it; a timeout is NOT sent on (no duplicate lead)', async () => {
  mode.signIn = 'fail'; assert.equal((await (await post(GOOD)).json()).from, 'old');
  forgetToken(); mode = { zone: 'UTC', append: 'refuse' }; assert.equal((await (await post(GOOD)).json()).from, 'old'); assert.equal(written.length, 0);
  forgetToken(); calls.length = 0; mode = { zone: 'UTC', append: 'timeout' };
  const res = await post(GOOD); assert.equal(res.status, 502); assert.equal((await res.json()).success, false); assert.ok(!calls.some((c) => c.startsWith('APPS-SCRIPT')));
  forgetToken(); mode = {}; assert.equal((await (await post(GOOD, { SERVICES_SERVICE_ACCOUNT_JSON: 'not json' })).json()).from, 'old');
});

test('bad bodies and a flood of leads are refused without touching the Sheet; the old backend being down gives a plain error', async () => {
  assert.deepEqual(await (await post(null, ENV(), 'not json')).json(), { success: false, error: 'Invalid JSON' });
  assert.deepEqual(await (await post(null, ENV(), '[1]')).json(), { success: false, error: 'Invalid JSON' });
  assert.equal((await post(null, ENV(), 'x'.repeat(MAX_BODY + 1))).status, 413); assert.equal(calls.length, 0);
  for (let i = 0; i < LEADS_PER_HOUR; i++) await post(GOOD);
  assert.match((await (await post(GOOD)).json()).error, /Too many requests/); assert.equal(written.length, LEADS_PER_HOUR);
  appsScript = () => { throw new Error('offline'); }; store.clear(); assert.equal((await post(GOOD, {})).status, 502);
});

test('GET reports which side is in charge and never saves; OPTIONS allows the embed', async () => {
  assert.deepEqual([(await (await onRequestGet({ env: ENV() })).json()).mode, (await (await onRequestGet({ env: {} })).json()).mode], ['sheet', 'apps-script']);
  assert.equal(calls.length, 0); assert.equal(onRequestOptions().status, 204);
  assert.ok(SERVICES_API_URL.startsWith('https://script.google.com/'));
});

test('the Services page sends the intake form to the site endpoint first and only asks the Apps Script itself if that request fails', () => {
  assert.match(PAGE, /function postLead\(payload\) \{\s*return fetch\('\/api\/service-lead', \{[\s\S]*?\}\)\.catch\(function \(\) \{ return postAction\(payload\); \}\);\s*\}/);
  assert.match(PAGE, /postLead\(\{\s*action: 'lead',/);
});
