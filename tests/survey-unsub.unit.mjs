// Tests for survey stage 4 (the unsubscribe page in src/edge/survey-api.js, unsubscribeFromSheet in survey-sheets.js).
// DIFFERENTIAL: the real handleUnsubscribeRequest() from apps-script/survey/Code.gs runs in a sandbox with an in-memory spreadsheet,
// next to the new code on a fake Google Sheets API, over the same links (good, forged, wrong list, unknown person, odd spellings).
// The page's message and the resulting Subscribers / Service_Subscribers tabs must match.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { onRequestGet } from '../functions/api/survey.js';
import { handleUnsubscribe, SITE_SURVEY_URL } from '../src/edge/survey-api.js';
import { unsubscribeFromSheet, SurveySheet, dateToSerial, TABS, HEADERS } from '../src/edge/survey-sheets.js';
import { makeUnsubToken, buildUnsubscribeUrl, SURVEY_APPS_SCRIPT_URL } from '../src/edge/survey.js';
import { forgetToken } from '../src/edge/google.js';

const SECRET = 'test-unsub-secret';
const GS = readFileSync(new URL('../apps-script/survey/Code.gs', import.meta.url), 'utf8').replace(/const UNSUB_SECRET = '[^']*';/, `const UNSUB_SECRET = '${SECRET}';`);
const D = (iso) => new Date(iso);
const seed = () => ({
  [TABS.subscribers]: [HEADERS.subscribers, [D('2026-10-18T02:00:00Z'), '', 'ana@example.com', 'Active', ''], [D('2026-10-18T02:00:00Z'), '', 'gone@example.com', 'Unsubscribed', D('2026-10-20T12:00:00Z')], [D('2026-10-18T02:00:00Z'), '', 'MixedCase@Example.com', 'Active', ''], [D('2026-10-19T02:00:00Z'), '', 'dup@example.com', 'Active', ''], [D('2026-10-19T03:00:00Z'), '', 'dup@example.com', 'Active', '']],
  [TABS.serviceSubscribers]: [HEADERS.subscribers, [D('2026-10-01T15:00:00Z'), '', 'max@example.com', 'Active', ''], [D('2026-10-01T15:00:00Z'), '', 'ana@example.com', 'Active', '']],
});
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const messageOf = (html) => /<p[^>]*>([\s\S]*?)<\/p>/.exec(html)[1];

function oldWorld(seedData) {
  const sheets = new Map();
  const mk = (name, rows) => { const s = { rows: rows.map((r) => [...r]) };
    s.getDataRange = () => ({ getValues: () => { const w = Math.max(0, ...s.rows.map((x) => x.length)); return s.rows.map((x) => Array.from({ length: w }, (_, j) => x[j] ?? '')); } });
    s.getRange = (r, c) => ({ setValue(v) { s.rows[r - 1][c - 1] = v; } });
    sheets.set(name, s); };
  for (const [n, rows] of Object.entries(seedData)) mk(n, rows);
  const ctx = vm.createContext({
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => sheets.get(n) || null }) },
    HtmlService: { createHtmlOutput: (html) => ({ setTitle: () => ({ addMetaTag: () => ({ html }) }) }) },
    Utilities: { computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map((b) => (b > 127 ? b - 256 : b)) },
    Logger: { log() {} },
  });
  vm.runInContext(GS, ctx);
  return { sheets, click: (params) => vm.runInContext(`handleUnsubscribeRequest({ parameter: ${JSON.stringify(params)} })`, ctx).html };
}

let tabs, requests, mode;
function fakeGoogle(seedData) {
  tabs = new Map(); let id = 100; requests = []; mode = {};
  const fix = (v) => (isDate(v) ? dateToSerial(v) : v);
  for (const [n, rows] of Object.entries(seedData)) tabs.set(n, { id: id++, rows: rows.map((r) => r.map(fix)), formats: [] });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const cellOf = (a1) => { const m = /^([A-Z]+)(\d+)$/.exec(a1); return [Number(m[2]), [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)]; };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') return mode.signIn === 'fail' ? json({ error: 'x' }, 400) : json({ access_token: 'tok', expires_in: 3600 });
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(u.pathname); if (!m) throw new Error('unexpected fetch ' + u);
    const rest = decodeURIComponent(m[2]), body = init.body ? JSON.parse(init.body) : null; requests.push({ rest, method: init.method || 'GET', body });
    if (mode.sheets === 'refuse') return json({ error: 'no' }, 403);
    if (rest === '') return json({ sheets: [...tabs].map(([title, t]) => ({ properties: { sheetId: t.id, title } })) });
    if (rest === ':batchUpdate') { for (const r of body.requests) { const t = [...tabs.values()].find((x) => x.id === r.repeatCell?.range.sheetId); if (t) t.formats.push(r.repeatCell.range); } return json({ replies: [{}] }); }
    let mm;
    if ((mm = /^\/values\/([^!]+)$/.exec(rest)) && !init.method) return json({ values: tabs.get(mm[1]).rows });
    if (rest === '/values:batchUpdate') { for (const d of body.data) { const [tab, a1] = d.range.split('!'); const [r, c] = cellOf(a1); tabs.get(tab).rows[r - 1][c - 1] = d.values[0][0]; } return json({}); }
    throw new Error('unexpected sheets call ' + rest);
  };
}
const ENV = () => ({ SURVEY_SERVICE_ACCOUNT_JSON: 'x', RESEND_API_KEY: 'k', SURVEY_UNSUB_SECRET: SECRET });
const get = (params, env = ENV()) => onRequestGet({ request: new Request('https://www.nrnszn.com/api/survey?' + new URLSearchParams({ unsub: '1', ...params })), env });
let pair, pem;
beforeEach(async () => {
  forgetToken();
  pair ||= await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  pem ||= `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
});
const env = () => ({ ...ENV(), SURVEY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: pem }) });
const norm = (rows) => rows.map((r) => { const x = r.map((v) => (isDate(v) ? '<ts>' : v)); while (x.length && x[x.length - 1] === '') x.pop(); return x; });
const status = (rows) => rows.slice(1).map((r) => [r[2], r[3], r[4] !== '' && r[4] !== undefined ? '<date>' : '']);

test('every kind of link gives the same message and the same list changes as the old Apps Script page', async () => {
  const links = [];
  for (const email of ['ana@example.com', 'ANA@example.com', ' ana@example.com', 'mixedcase@example.com', 'gone@example.com', 'dup@example.com', 'max@example.com', 'nobody@example.com', "o'brien<b>@x.co"])
    for (const kind of ['show', 'service', 'SERVICE', 'weird', undefined]) links.push({ email, kind, t: await makeUnsubToken(email, SECRET) });
  links.push({ email: 'ana@example.com', kind: 'show', t: 'forged' }, { email: 'ana@example.com', kind: 'show', t: '' }, { email: '', kind: 'show', t: 'x' }, { email: 'max@example.com', kind: 'service', t: await makeUnsubToken('ana@example.com', SECRET) });
  for (const link of links) {
    const params = Object.fromEntries(Object.entries(link).filter(([, v]) => v !== undefined));
    const old = oldWorld(seed()); const oldHtml = old.click(params);
    fakeGoogle(seed());
    const res = await handleUnsubscribe({ request: new Request('https://www.nrnszn.com/api/survey?' + new URLSearchParams({ unsub: '1', ...params })), env: env() }, new Date('2026-11-12T20:00:00Z'));
    assert.equal(res.status, 200, JSON.stringify(link));
    assert.equal(messageOf(await res.text()), messageOf(oldHtml), JSON.stringify(link));
    for (const tab of [TABS.subscribers, TABS.serviceSubscribers]) assert.deepEqual(status(norm(tabs.get(tab).rows)), status(norm(old.sheets.get(tab).rows)), JSON.stringify(link) + tab);
  }
});

test('the unsubscribe date is saved as a real date and formatted; a second click on the same link is harmless', async () => {
  fakeGoogle(seed());
  const params = { email: 'ana@example.com', kind: 'show', t: await makeUnsubToken('ana@example.com', SECRET) };
  const run = () => handleUnsubscribe({ request: new Request('https://x/api/survey?' + new URLSearchParams({ unsub: '1', ...params })), env: env() }, new Date('2026-11-12T20:00:00Z'));
  assert.match(await (await run()).text(), /ana@example.com is unsubscribed/);
  const row = tabs.get(TABS.subscribers).rows[1]; assert.equal(row[3], 'Unsubscribed'); assert.equal(row[4], dateToSerial(new Date('2026-11-12T20:00:00Z')));
  assert.equal(tabs.get(TABS.subscribers).formats.at(-1).startColumnIndex, 4);
  assert.match(await (await run()).text(), /unsubscribed/); assert.equal(tabs.get(TABS.subscribers).rows[1][3], 'Unsubscribed');
  assert.equal(tabs.get(TABS.serviceSubscribers).rows[2][3], 'Active');                                       // the other list is untouched
});

test('the message is HTML-escaped and the page is not indexed or cached', async () => {
  const email = '"><script>alert(1)</script>@x.co';
  const sd = seed(); sd[TABS.subscribers].push([D('2026-10-19T02:00:00Z'), '', email, 'Active', '']); fakeGoogle(sd);
  const res = await get({ email, kind: 'show', t: await makeUnsubToken(email, SECRET) }, env());
  const html = await res.text();
  assert.ok(!html.includes('<script>alert') && html.includes('&lt;script&gt;'));
  assert.equal(res.headers.get('content-type'), 'text/html;charset=utf-8'); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(res.headers.get('x-robots-tag'), 'noindex');
});

test('without the three secrets, or when Google trouble stops the change, the link is passed to the old Apps Script page (same query)', async () => {
  fakeGoogle(seed());
  const params = { email: 'ana@example.com', kind: 'show', t: await makeUnsubToken('ana@example.com', SECRET) };
  const expected = SURVEY_APPS_SCRIPT_URL + '?' + new URLSearchParams({ unsub: '1', ...params });
  const e1 = env(); delete e1.RESEND_API_KEY;
  let res = await get(params, e1); assert.equal(res.status, 302); assert.equal(res.headers.get('location'), expected); assert.equal(requests.length, 0);
  mode.signIn = 'fail'; res = await get(params, env()); assert.equal(res.status, 302); assert.equal(res.headers.get('location'), expected);
  forgetToken(); mode = { sheets: 'refuse' }; res = await get(params, env()); assert.equal(res.status, 302); assert.equal(res.headers.get('location'), expected);
  res = await get(params, { ...env(), SURVEY_SERVICE_ACCOUNT_JSON: 'not json' }); assert.equal(res.status, 302);
  assert.equal(tabs.get(TABS.subscribers).rows[1][3], 'Active');
});

test('a bad link is answered without touching Google, even with a huge e-mail', async () => {
  fakeGoogle(seed());
  for (const params of [{ email: 'ana@example.com', t: 'nope' }, { email: 'a'.repeat(400) + '@x.co', t: 'nope' }, {}]) {
    const html = await (await get(params, env())).text(); assert.match(html, /doesn&#39;t look right/);
  }
  assert.equal(requests.length, 0);
});

test('plain GET (no unsub) still reports status; new e-mails link to the site, and the old links keep working', async () => {
  const s = await (await onRequestGet({ request: new Request('https://www.nrnszn.com/api/survey'), env: ENV() })).json();
  assert.deepEqual([s.status, s.mode], ['ok', 'sheet']);
  const url = await buildUnsubscribeUrl('a@b.co', 'service', SECRET, SITE_SURVEY_URL);
  assert.equal(url, `https://www.nrnszn.com/api/survey?unsub=1&kind=service&email=a%40b.co&t=${await makeUnsubToken('a@b.co', SECRET)}`);
  assert.ok(SURVEY_APPS_SCRIPT_URL.startsWith('https://script.google.com/'));
});

test('a missing tab or an e-mail column that is not there gives the same answers as the old code', async () => {
  fakeGoogle({ [TABS.subscribers]: [['Name', 'Status']] });
  assert.equal(await unsubscribeFromSheet(new SurveySheet('tok'), 'a@b.co', TABS.subscribers), 'no-email-column');
  assert.equal(await unsubscribeFromSheet(new SurveySheet('tok'), 'a@b.co', TABS.serviceSubscribers), 'no-subscribers-sheet');
});
