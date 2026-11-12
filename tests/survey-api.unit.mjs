// Tests for survey stage 3 (src/edge/survey-api.js, functions/api/survey.js): the live /api/survey endpoint.
// The rules, Sheet writes and e-mails are proven against the real Code.gs in survey.unit.mjs / survey-sheets.unit.mjs; here: the front door
// (traps, flood guard, size limit), which backend answers, and that a response is never lost or saved twice.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost, onRequestOptions } from '../functions/api/survey.js';
import { RATE_LIMIT_PER_MINUTE, MAX_BODY } from '../src/edge/survey-api.js';
import { SURVEYS_SHEET_ID } from '../src/edge/survey-sheets.js';
import { SURVEY_APPS_SCRIPT_URL, MIN_SUBMIT_MS } from '../src/edge/survey.js';
import { forgetToken, SHEETS_WRITE_SCOPE } from '../src/edge/google.js';

const WIDGET = readFileSync(new URL('../public/widgets/survey.html', import.meta.url), 'utf8');
const GS = readFileSync(new URL('../apps-script/survey/Code.gs', import.meta.url), 'utf8');
let pem, account, store, calls, scopes, appends, mails, appsScript, sheetsBehaviour;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  account = JSON.stringify({ client_email: 'survey@x.iam.gserviceaccount.com', private_key: pem });
});
beforeEach(() => {
  forgetToken(); calls = []; scopes = []; appends = []; mails = []; sheetsBehaviour = {};
  appsScript = () => json({ ok: true, subscribeResult: 'from-old' });
  store = new Map();
  globalThis.caches = { default: { match: async (r) => { const x = store.get(r.url); return x ? x.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') {
      if (sheetsBehaviour.signIn === 'fail') return json({ error: 'invalid_grant' }, 400);
      scopes.push(JSON.parse(Buffer.from(new URLSearchParams(init.body).get('assertion').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).scope);
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    if (u.hostname === 'api.resend.com') { mails.push(JSON.parse(init.body)); return json({ id: 'x' }); }
    if (u.hostname === 'script.google.com') { calls.push('APPS-SCRIPT'); return appsScript(init); }
    if (u.hostname === 'sheets.googleapis.com') {
      const path = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
      calls.push('sheets ' + (init.method || 'GET') + ' ' + path + ' ' + u.pathname.split('/')[3]);
      if (path === '') return json({ sheets: [{ properties: { sheetId: 1, title: 'Certified_Lounge_Surveys' } }, { properties: { sheetId: 2, title: 'Certified_Lounge_Summary' } }, { properties: { sheetId: 3, title: 'NuRenaissance_Service_Surveys' } }, { properties: { sheetId: 4, title: 'Service_Subscribers' } }, { properties: { sheetId: 5, title: 'Discount_Codes' } }, { properties: { sheetId: 6, title: 'Subscribers' } }] });
      if (path.endsWith(':append')) {
        if (sheetsBehaviour.append === 'refuse') return json({ error: 'forbidden' }, 403);
        if (sheetsBehaviour.append === 'timeout') throw new DOMException('timed out', 'TimeoutError');
        appends.push(JSON.parse(init.body).values[0]);
        return json({ updates: { updatedRange: 'Certified_Lounge_Surveys!A2:L2' } });
      }
      if (path === ':batchUpdate') return sheetsBehaviour.format === 'refuse' ? json({ error: 'no' }, 403) : json({ replies: [{}] });
      if (path.startsWith('/values/') && !init.method) return sheetsBehaviour.read === 'refuse' ? json({ error: 'no' }, 500) : json({ values: [['h']] });
      return json({});
    }
    throw new Error('unexpected fetch ' + u);
  };
});
const ENV = () => ({ SURVEY_SERVICE_ACCOUNT_JSON: account, RESEND_API_KEY: 'rk', SURVEY_UNSUB_SECRET: 'sec' });
const good = (o = {}) => ({ show: 'Solberg - Oct 17', rating: 5, feedback: 'great', loadedAt: Date.now() - MIN_SUBMIT_MS - 5000, ...o });
const post = (body, env = ENV(), raw) => onRequestPost({ request: new Request('https://www.nrnszn.com/api/survey', { method: 'POST', body: raw ?? JSON.stringify(body) }), env });

test('with all three secrets set, a response is saved to the Sheet by the survey account (read-write scope) and the old backend is not called', async () => {
  const res = await post(good());
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true, subscribeResult: 'skipped' });
  assert.equal(appends.length, 1); assert.equal(appends[0][1], 'Solberg - Oct 17'); assert.equal(appends[0][2], 5);
  assert.ok(!calls.includes('APPS-SCRIPT')); assert.deepEqual([...new Set(scopes)], [SHEETS_WRITE_SCOPE]);
  assert.ok(calls.some((c) => c.includes(`/${SURVEYS_SHEET_ID}/`) || c.endsWith(SURVEYS_SHEET_ID)));
  assert.equal(mails.length, 1); assert.equal(mails[0].to[0], 'nurrenaissance@gmail.com');               // the notification
});

test('with any of the three secrets missing, the old Apps Script takes the response unchanged and its answer comes back', async () => {
  for (const missing of ['SURVEY_SERVICE_ACCOUNT_JSON', 'RESEND_API_KEY', 'SURVEY_UNSUB_SECRET']) {
    calls.length = 0; store.clear(); const env = ENV(); delete env[missing];
    const d = await (await post(good(), env)).json();
    assert.equal(d.subscribeResult, 'from-old', missing); assert.deepEqual(calls, ['APPS-SCRIPT']); assert.equal(appends.length, 0);
  }
});

test('the hidden-field trap, the too-fast trap and a missing page-load time are dropped quietly: answered ok, saved nowhere', async () => {
  for (const b of [good({ website: 'http://spam' }), good({ loadedAt: Date.now() - 200 }), { show: 'x', rating: 5 }]) {
    const d = await (await post(b)).json(); assert.deepEqual(d, { ok: true });
  }
  assert.equal(calls.length, 0);
});

test('bad bodies get the same kind of answer as before and write nothing', async () => {
  assert.match((await (await post(null, ENV(), '')).json()).error, /No data received/);
  assert.match((await (await post(null, ENV(), 'not json')).json()).error, /Something went wrong/);
  assert.match((await (await post(null, ENV(), '[1,2]')).json()).error, /Something went wrong/);
  const big = await post(null, ENV(), 'x'.repeat(MAX_BODY + 1)); assert.equal(big.status, 413);
  assert.equal(calls.length, 0);
});

test('the flood guard lets 60 a minute through and quietly drops the rest, saving nothing', async () => {
  for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) await post(good());
  assert.equal(appends.length, RATE_LIMIT_PER_MINUTE);
  assert.deepEqual(await (await post(good())).json(), { ok: true }); assert.equal(appends.length, RATE_LIMIT_PER_MINUTE);
  assert.equal(RATE_LIMIT_PER_MINUTE, Number(/const RATE_LIMIT_PER_MINUTE = (\d+)/.exec(GS)[1]));            // same cap as the old script
});

test('if Google sign-in or the Sheet refuses the row (nothing written), the old Apps Script takes it instead', async () => {
  sheetsBehaviour = { signIn: 'fail' };
  assert.equal((await (await post(good())).json()).subscribeResult, 'from-old'); assert.ok(calls.includes('APPS-SCRIPT'));
  forgetToken(); calls.length = 0; store.clear(); sheetsBehaviour = { append: 'refuse' };
  assert.equal((await (await post(good())).json()).subscribeResult, 'from-old'); assert.ok(calls.includes('APPS-SCRIPT')); assert.equal(appends.length, 0);
  forgetToken(); calls.length = 0; store.clear();
  assert.equal((await (await post(null, { ...ENV(), SURVEY_SERVICE_ACCOUNT_JSON: 'not json' }, JSON.stringify(good()))).json()).subscribeResult, 'from-old');   // a mistyped secret never loses a response
});

test('if it cannot be known whether the row was written (a timeout), the response is NOT also sent to the old backend', async () => {
  sheetsBehaviour = { append: 'timeout' };
  const res = await post(good());
  assert.equal(res.status, 502); assert.ok((await res.json()).error); assert.ok(!calls.includes('APPS-SCRIPT'));
});

test('once the row is saved, a failing later step (summary, date format, e-mail) never loses it or sends it a second time', async () => {
  sheetsBehaviour = { format: 'refuse', read: 'refuse' };                                                     // date format and the summary/subscriber reads all fail
  const res = await post(good({ email: 'a@b.co', subscribed: true }));
  assert.equal(res.status, 200); assert.equal((await res.json()).ok, true);
  assert.equal(appends.length, 1); assert.ok(!calls.includes('APPS-SCRIPT'));
});

test('if the old backend is also down, the answer is a plain error, never a crash or a page', async () => {
  appsScript = () => { throw new Error('offline'); };
  const env = ENV(); delete env.RESEND_API_KEY;
  const res = await post(good(), env); assert.equal(res.status, 502); assert.ok((await res.json()).error);
  appsScript = () => new Response('<html>Service unavailable</html>', { status: 200 });
  const res2 = await post(good(), env); assert.equal(res2.status, 502); assert.ok((await res2.json()).error);
});

test('GET says it is alive and which backend would answer; OPTIONS allows the embed', async () => {
  const on = await (await onRequestGet({ env: ENV() })).json(); assert.deepEqual([on.status, on.mode], ['ok', 'sheet']);
  const off = await (await onRequestGet({ env: {} })).json(); assert.deepEqual([off.status, off.mode], ['ok', 'apps-script']);
  assert.equal(onRequestOptions().status, 204); assert.equal(calls.length, 0);
});

test('the widget posts to the site endpoint first and only asks the Apps Script itself if that request fails or is not an answer', () => {
  assert.match(WIDGET, /var EDGE_URL = [^;]*'\/api\/survey'[^;]*'https:\/\/www\.nrnszn\.com\/api\/survey'/);
  assert.match(WIDGET, /fetch\(EDGE_URL, sendOptions\)\s*\.then\(function\(res\)\{ return res\.json\(\); \}\)\s*\.catch\(function\(\)\{ return fetch\(APPS_SCRIPT_URL, sendOptions\)/);
  assert.match(WIDGET, /var APPS_SCRIPT_URL = '([^']+)'/); assert.equal(/var APPS_SCRIPT_URL = '([^']+)'/.exec(WIDGET)[1], SURVEY_APPS_SCRIPT_URL);
});
