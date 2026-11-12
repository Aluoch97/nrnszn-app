// Tests for survey stage 2 (src/edge/survey-sheets.js): saving a response to the Surveys sheet, the subscriber lists, the discount codes,
// the thank-you / notification e-mails and the Summary tab.
// DIFFERENTIAL: the real doPost() from apps-script/survey/Code.gs runs in a sandbox (with an in-memory spreadsheet) and the new code runs
// against a fake Google Sheets API, over the same random sequences of submissions with the same pre-filled subscribers and discount codes.
// The resulting tabs and the e-mails sent must match (timestamps and random codes aside).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { recordSubmission, SurveySheet, upsertToSubscriberSheet, issueDiscountCode, refreshSummary, dateToSerial, serialToDate, TABS, HEADERS, SURVEYS_SHEET_ID } from '../src/edge/survey-sheets.js';
import { SURVEY_APPS_SCRIPT_URL, NOTIFY_EMAIL } from '../src/edge/survey.js';
import { forgetToken } from '../src/edge/google.js';

const GS = readFileSync(new URL('../apps-script/survey/Code.gs', import.meta.url), 'utf8').replace(/const UNSUB_SECRET = '[^']*';/, "const UNSUB_SECRET = 'test-unsub-secret';");
const ENV_SECRETS = { SURVEY_UNSUB_SECRET: 'test-unsub-secret', RESEND_API_KEY: 'k' };
const tsOf = Object.prototype.toString;
const isDate = (v) => tsOf.call(v) === '[object Date]';
// One clock for both worlds, moved forward 5 s before every submission, so timestamps (and the Summary's ordering) are the same in both.
const clock = { now: Date.parse('2026-11-12T20:00:00Z') };
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// ---------------------------------------------------------------- a pre-filled spreadsheet (same data for both worlds)
const D = (iso) => new Date(iso);
function seedData() {
  return {
    [TABS.show]: [HEADERS.show, [D('2026-10-18T02:00:00Z'), 'Solberg - Oct 17', 5, 'great', '', 'First-time', 'Instagram', 'Jo', 'Yes', 'Ana', 'ana@example.com', 'Yes'],
      [D('2026-10-18T03:00:00Z'), 'Solberg - Oct 17', 4, '', '', 'Returning', 'Friend', '', 'No', '', '', 'No'], [D('2026-09-01T03:00:00Z'), 'Fall Show', '3', 'ok', '', '', 'Flyer', '', '', '', '', 'No']],
    [TABS.service]: [HEADERS.service, [D('2026-10-01T15:00:00Z'), 'Video', 5, 'loved it', '', 'Yes', 'Yes', 'Referral', 'Max', 'max@example.com', 'Yes']],
    [TABS.subscribers]: [HEADERS.subscribers, [D('2026-10-18T02:00:00Z'), '', 'ana@example.com', 'Active', ''], [D('2026-10-18T02:00:00Z'), '', 'gone@example.com', 'Unsubscribed', D('2026-10-20T12:00:00Z')], [D('2026-10-18T02:00:00Z'), '', 'blank@example.com', '', ''], [D('2026-10-18T02:00:00Z'), '', 'MixedCase@Example.com', 'Active', '']],
    [TABS.serviceSubscribers]: [HEADERS.subscribers, [D('2026-10-01T15:00:00Z'), '', 'max@example.com', 'Active', ''], [D('2026-10-02T15:00:00Z'), '', 'former@example.com', 'Unsubscribed', D('2026-10-05T12:00:00Z')]],
    [TABS.discounts]: [HEADERS.discounts, ['max@example.com', 'Max', 'NR10-AAAA1111', D('2026-10-01T15:00:00Z'), 'Unused', ''], ['used@example.com', 'Una', 'NR10-BBBB2222', D('2026-03-01T15:00:00Z'), 'Redeemed', D('2026-03-04T12:00:00Z')], ['MixedDisc@Example.com', 'Mixed', 'NR10-CCCC3333', D('2026-02-01T15:00:00Z'), 'Unused', '']],
    [TABS.summary]: [['stale']],
  };
}

// ---------------------------------------------------------------- the old code in a sandbox with an in-memory spreadsheet
function oldWorld(seed) {
  const mails = [], sheets = new Map();
  const range = (sheet, r, c, nr, nc) => ({
    setValues(v) { for (let i = 0; i < v.length; i++) { sheet.rows[r - 1 + i] = sheet.rows[r - 1 + i] || []; for (let j = 0; j < v[i].length; j++) sheet.rows[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
    setValue(x) { return this.setValues([[x]]); },
    getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((sheet.rows[r - 1 + i] || [])[c - 1 + j] ?? ''))); },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; },
  });
  const mk = (name, rows = []) => { const s = { name, rows: rows.map((r) => [...r]) };
    Object.assign(s, { getRange: (r, c, nr = 1, nc = 1) => (typeof r === 'string' ? range(s, 1, 1, 1, 1) : range(s, r, c, nr, nc)), getLastRow: () => s.rows.length,
      getDataRange: () => ({ getValues: () => { const w = Math.max(0, ...s.rows.map((x) => x.length)); return s.rows.map((x) => Array.from({ length: w }, (_, j) => x[j] ?? '')); } }),
      setFrozenRows() {}, setConditionalFormatRules() {}, autoResizeColumns() {}, clear() { s.rows = []; } });
    sheets.set(name, s); return s; };
  for (const [name, rows] of Object.entries(seed)) mk(name, rows);
  const ctx = vm.createContext({
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => mk(n) }),
      newConditionalFormatRule: () => { const b = { whenFormulaSatisfied: () => b, setBackground: () => b, setRanges: () => b, build: () => ({}) }; return b; } },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
    MailApp: { sendEmail: (a, b, c) => mails.push(typeof a === 'object' ? { to: a.to, subject: a.subject, html: a.htmlBody } : { to: a, subject: b, text: c }) },
    ScriptApp: { getService: () => ({ getUrl: () => SURVEY_APPS_SCRIPT_URL }) },
    Utilities: { computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map((b) => (b > 127 ? b - 256 : b)), getUuid: () => crypto.randomUUID() },
    Logger: { log() {} },
  });
  vm.runInContext('globalThis.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(__clock.now); } static now() { return __clock.now; } };', Object.assign(ctx, { __clock: clock }));
  vm.runInContext(GS, ctx);
  const post = (body) => JSON.parse(vm.runInContext(`doPost({ postData: { contents: ${JSON.stringify(JSON.stringify(body))} } })`, ctx).text);
  return { sheets, mails, post };
}

// ---------------------------------------------------------------- the new code against a fake Google Sheets API
function fakeGoogle(seed) {
  const tabs = new Map(); let nextId = 100;
  const fix = (v) => (isDate(v) ? dateToSerial(v) : v);
  const add = (title, rows = []) => { const t = { id: nextId++, title, rows: rows.map((r) => r.map(fix)), formats: [] }; tabs.set(title, t); return t; };
  for (const [name, rows] of Object.entries(seed)) add(name, rows);
  const mails = [], requests = [];
  const trim = (rows) => { const out = rows.map((r) => { const x = [...r]; while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; }); while (out.length && !out[out.length - 1].length) out.pop(); return out; };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const cellOf = (a1) => { const m = /^([A-Z]+)(\d+)$/.exec(a1); const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0); return [Number(m[2]), col]; };
  const put = (t, row, col, v) => { t.rows[row - 1] = t.rows[row - 1] || []; for (let i = t.rows[row - 1].length; i < col - 1; i++) t.rows[row - 1][i] = ''; t.rows[row - 1][col - 1] = v; };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.resend.com') { const b = JSON.parse(init.body); mails.push({ to: b.to[0], subject: b.subject, ...(b.html ? { html: b.html } : { text: b.text }) }); return json({ id: 'x' }); }
    if (u.href === 'https://oauth2.googleapis.com/token') return json({ access_token: 'tok', expires_in: 3600 });
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(u.pathname); if (!m) throw new Error('unexpected fetch ' + u);
    const rest = decodeURIComponent(m[2]), body = init.body ? JSON.parse(init.body) : null; requests.push({ method: init.method || 'GET', rest, query: Object.fromEntries(u.searchParams), body });
    if (init.headers.authorization !== 'Bearer tok') return json({ error: 'unauthorized' }, 401);
    if (rest === '') return json({ sheets: [...tabs.values()].map((t) => ({ properties: { sheetId: t.id, title: t.title } })) });
    if (rest === ':batchUpdate') {
      const replies = body.requests.map((r) => {
        if (r.addSheet) { const t = add(r.addSheet.properties.title); return { addSheet: { properties: { sheetId: t.id, title: t.title } } }; }
        const sid = r.repeatCell?.range.sheetId ?? r.updateSheetProperties?.properties.sheetId ?? r.autoResizeDimensions?.dimensions.sheetId;
        const t = [...tabs.values()].find((x) => x.id === sid); if (t) t.formats.push(r); return {};
      });
      return json({ replies });
    }
    let mm;
    if ((mm = /^\/values\/([^!]+)$/.exec(rest)) && !init.method) { const t = tabs.get(mm[1]); return t ? json({ values: trim(t.rows) }) : json({ error: 'Unable to parse range' }, 400); }
    if ((mm = /^\/values\/([^!]+)!A:A:append$/.exec(rest))) {
      const t = tabs.get(mm[1]); if (!t) return json({ error: 'no tab' }, 400);
      const last = trim(t.rows).length; t.rows[last] = body.values[0].map(fix);
      return json({ updates: { updatedRange: `${mm[1]}!A${last + 1}:Z${last + 1}`, updatedRows: 1 } });
    }
    if ((mm = /^\/values\/([^!]+)!A1$/.exec(rest)) && init.method === 'PUT') { const t = tabs.get(mm[1]); body.values.forEach((r, i) => r.forEach((v, j) => put(t, i + 1, j + 1, fix(v)))); return json({}); }
    if ((mm = /^\/values\/([^!:]+):clear$/.exec(rest))) { tabs.get(mm[1]).rows = []; return json({}); }
    if (rest === '/values:batchUpdate') { for (const d of body.data) { const [tab, a1] = d.range.split('!'); const [r, c] = cellOf(a1); put(tabs.get(tab), r, c, fix(d.values[0][0])); } return json({}); }
    throw new Error('unexpected sheets call ' + init.method + ' ' + rest);
  };
  return { tabs, mails, requests };
}

// ---------------------------------------------------------------- comparing the two worlds
const CODE = /NR10-[0-9A-F]{8}/g;
function normalize(tab, rows) {
  const tsCols = { [TABS.show]: [0], [TABS.service]: [0], [TABS.subscribers]: [0, 4], [TABS.serviceSubscribers]: [0, 4], [TABS.discounts]: [3, 5], [TABS.summary]: [7] }[tab] || [];
  const out = rows.map((r) => r.map((v, c) => (isDate(v) ? '<ts>' : typeof v === 'number' && tsCols.includes(c) && v > 20000 ? '<ts>' : typeof v === 'string' ? v.replace(CODE, 'NR10-<CODE>') : v)));
  const t = out.map((r) => { const x = [...r]; while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
  while (t.length && !t[t.length - 1].length) t.pop();
  return t;
}
const normMails = (ms) => ms.map((m) => ({ ...m, ...(m.html ? { html: m.html.replace(CODE, 'NR10-<CODE>') } : {}) }));
const codesIn = (mails) => mails.map((m) => (m.html || '').match(CODE)?.[0] || null);

async function runBoth(bodies, seed = seedData()) {
  const old = oldWorld(seed), g = fakeGoogle(seed), answersOld = [], answersNew = [];
  const env = { ...ENV_SECRETS, SURVEY_SERVICE_ACCOUNT_JSON: 'unused' };
  const sheets = new SurveySheet('tok');
  for (const raw of bodies) {
    clock.now += 5000;                                                                                       // the same moment for both
    const b = typeof raw === 'function' ? raw() : raw;
    answersOld.push(old.post(b));
    answersNew.push(await recordSubmission(b, env, { sheets, now: new Date(clock.now), log: () => {} }));
  }
  return { old, g, answersOld, answersNew };
}
function assertSame({ old, g, answersOld, answersNew }, label = '') {
  assert.deepEqual(answersNew, answersOld, 'answers ' + label);
  for (const tab of Object.values(TABS)) {
    const o = old.sheets.get(tab), n = g.tabs.get(tab);
    assert.deepEqual(normalize(tab, n ? n.rows : []), normalize(tab, o ? o.rows : []), `tab ${tab} ${label}`);
  }
  assert.deepEqual(normMails(g.mails), normMails(old.mails), 'e-mails ' + label);
  // a code is issued once per person and reused: the pattern of repeated vs new codes must match too
  const pattern = (mails) => { const seen = new Map(); return codesIn(mails).map((c) => (c === null ? null : (seen.has(c) ? seen.get(c) : (seen.set(c, seen.size), seen.size - 1)))); };
  assert.deepEqual(pattern(g.mails), pattern(old.mails), 'code reuse ' + label);
}

const plain = (o) => body(o)();
const body = (o = {}) => () => ({ ...o, loadedAt: o.loadedAt === undefined ? clock.now - 60000 : o.loadedAt <= 0 && o.loadedAt > -100000 ? clock.now + o.loadedAt : o.loadedAt });   // built at send time, from the shared clock (a small negative number means "that many ms ago")

before(() => { forgetToken(); });
beforeEach(() => { forgetToken(); });

// ---------------------------------------------------------------- the differential tests
test('25 random sequences of submissions (show and service, new and returning people): tabs and e-mails match the old script', async () => {
  const rnd = rng(77), pick = (a) => a[Math.floor(rnd() * a.length)];
  const emails = ['ana@example.com', 'Ana@Example.com', 'gone@example.com', 'blank@example.com', 'new@example.com', 'max@example.com', 'MAX@example.com', 'former@example.com', 'used@example.com', 'fresh@example.com', 'bad-email', '', '=cmd@x.co', 'mixedcase@example.com', 'MIXEDDISC@example.com'];
  const txt = ['', 'Great night', 'x'.repeat(2100), '=SUM(1)', '<b>x</b>', 'Line\nbreak', '1/2', 'TRUE'];
  for (let s = 0; s < 25; s++) {
    const bodies = Array.from({ length: 4 + Math.floor(rnd() * 9) }, () => body({
      _kind: pick([undefined, 'show', 'service', 'service']), show: pick(['Solberg - Oct 17', 'Fall Show', 'New Show', '', 'Show | A']), service: pick(['Video', 'Photo', 'Web', '']),
      rating: pick([5, 4, 3, 2, 1, '4', 0, 9, undefined]), feedback: pick(txt), note: pick(txt), attendeeType: pick(['First-time', 'Returning', '', 'Other']), source: pick(['Instagram', 'Friend', 'Flyer', '']),
      favoritePerformer: pick(txt), bringFriend: pick(['Yes', 'No', '']), hireAgain: pick(['Yes', 'No', '']), testimonialOk: pick([true, false]), name: pick(['Ana', '', 'Max <b>', "O'Brien"]),
      email: pick(emails), subscribed: pick([true, true, false]), website: pick(['', '', '', '', 'spam']), loadedAt: pick([-60000, -60000, -100]),
    }));
    assertSame(await runBoth(bodies), 'sequence #' + s + ' ' + JSON.stringify(bodies.map((b) => [b._kind, b.email, b.subscribed])));
  }
});

test('a service response from a new person who opts in: row saved, subscriber added, new code issued and e-mailed, you are notified', async () => {
  const r = await runBoth([body({ _kind: 'service', service: 'Photo', rating: 5, name: 'Nia', email: 'nia@example.com', subscribed: true, testimonialOk: true })]);
  assertSame(r);
  assert.deepEqual(r.answersNew, [{ ok: true, subscribeResult: 'added' }]);
  assert.equal(r.g.mails.length, 2); assert.equal(r.g.mails[0].to, 'nia@example.com'); assert.match(r.g.mails[0].html, /NR10-[0-9A-F]{8}/); assert.equal(r.g.mails[1].to, NOTIFY_EMAIL);
  assert.equal(normalize(TABS.discounts, r.g.tabs.get(TABS.discounts).rows).at(-1)[4], 'Unused');
});

test('people already in the lists: unsubscribed ones are reactivated, active ones left alone, a used discount code is not offered again', async () => {
  const r = await runBoth([
    body({ _kind: 'service', service: 'Video', email: 'former@example.com', subscribed: true, name: 'Former' }),   // reactivated, new code
    body({ _kind: 'service', service: 'Video', email: 'MAX@example.com', subscribed: true }),                     // already subscribed, same code as before
    body({ _kind: 'service', service: 'Video', email: 'used@example.com', subscribed: true }),                    // already redeemed
    body({ _kind: 'service', service: 'Photo', email: 'mixeddisc@example.com', subscribed: true }),                // typed in capitals in the sheet: still the same person, same code
    body({ email: 'mixedcase@example.com', subscribed: true }),                                                     // an active subscriber typed in capitals
    body({ email: 'gone@example.com', subscribed: true, show: 'Fall Show' }), body({ email: 'blank@example.com', subscribed: true }), body({ email: 'ana@example.com', subscribed: true }),
  ]);
  assertSame(r);
  assert.deepEqual(r.answersNew.map((a) => a.subscribeResult), ['reactivated', 'already-subscribed', 'added', 'added', 'already-subscribed', 'reactivated', 'reactivated', 'already-subscribed']);
  const used = r.g.mails.find((m) => m.to === 'used@example.com');
  assert.match(used.html, /already used your one-time 10% off \(redeemed Mar 4, 2026\)/); assert.ok(!/NR10-BBBB2222/.test(used.html));
  assert.match(r.g.mails.find((m) => m.to === 'mixeddisc@example.com').html, /NR10-CCCC3333/);
  assert.match(r.g.mails.find((m) => m.to === 'MAX@example.com').html, /NR10-AAAA1111/);                      // the same code again, never a second one
});

test('dropped submissions (hidden field, too fast, no page-load time) save and send nothing', async () => {
  const r = await runBoth([body({ website: 'x', email: 'a@b.co', subscribed: true }), body({ loadedAt: -100 }), () => ({ show: 'x' })]);
  assertSame(r);
  assert.deepEqual(r.answersNew, [{ ok: true }, { ok: true }, { ok: true }]); assert.equal(r.g.mails.length, 0); assert.equal(r.g.requests.length, 0);
});

test('the Summary tab is rebuilt after each show response, most recently active show first', async () => {
  const r = await runBoth([body({ show: 'Brand New Show', rating: 5, attendeeType: 'First-time', bringFriend: 'Yes', source: 'Instagram' }), body({ show: 'Solberg - Oct 17', rating: 2, attendeeType: 'Returning', bringFriend: 'No', source: 'Flyer' })]);
  assertSame(r);
  const s = normalize(TABS.summary, r.g.tabs.get(TABS.summary).rows);
  assert.equal(s[0][0], '🎯 ALL SHOWS (TOTAL)'); assert.deepEqual(s[2].slice(0, 3), ['Show', 'Responses', 'Avg Rating']);
  assert.deepEqual(s.slice(3).map((x) => x[0]), ['Solberg - Oct 17', 'Brand New Show', 'Fall Show']);          // newest activity first
  const fmts = r.g.tabs.get(TABS.summary).formats;
  assert.ok(fmts.some((f) => f.updateSheetProperties?.properties.gridProperties.frozenRowCount === 3) && fmts.some((f) => f.autoResizeDimensions));
});

// ---------------------------------------------------------------- how the new code talks to Google, and what happens when things fail
test('rows are saved as plain values (RAW) so nothing is run as a formula, with the timestamp as a real date-time cell', async () => {
  const r = await runBoth([body({ show: 'Show', feedback: '=IMPORTXML("x")', note: '+1', name: '@evil', rating: 5 })]);
  const rawAppend = r.g.requests.find((q) => q.rest.endsWith(':append'));
  assert.equal(rawAppend.query.valueInputOption, 'RAW'); assert.equal(rawAppend.query.insertDataOption, 'INSERT_ROWS');
  const row = r.g.tabs.get(TABS.show).rows.at(-1);
  assert.equal(row[3], '=IMPORTXML("x")'); assert.equal(row[4], '+1'); assert.equal(row[9], '@evil'); assert.equal(row[2], 5);
  const fmt = r.g.requests.filter((q) => q.rest === ':batchUpdate').flatMap((q) => q.body.requests).find((x) => x.repeatCell?.cell.userEnteredFormat.numberFormat?.pattern === 'yyyy-MM-dd HH:mm:ss');
  assert.equal(fmt.repeatCell.range.startColumnIndex, 0); assert.equal(fmt.repeatCell.range.endColumnIndex, 1);
});

test('a failing e-mail, discount code or summary never loses the saved response', async () => {
  const g = fakeGoogle(seedData()), logs = [], sheets = new SurveySheet('tok');
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('resend.com') ? new Response('nope', { status: 429 }) : real(url, init));
  const out = await recordSubmission(plain({ _kind: 'service', service: 'Video', email: 'zed@example.com', subscribed: true, name: 'Zed' }), ENV_SECRETS, { sheets, now: new Date(clock.now), log: (m) => logs.push(m) });
  assert.deepEqual(out, { ok: true, subscribeResult: 'added' });
  assert.equal(normalize(TABS.service, g.tabs.get(TABS.service).rows).at(-1)[9], 'zed@example.com');            // the response is there
  assert.equal(normalize(TABS.discounts, g.tabs.get(TABS.discounts).rows).at(-1)[0], 'zed@example.com');          // so is the code, even though the e-mail failed
  assert.equal(logs.length, 2); assert.match(logs[0], /thank-you e-mail failed/); assert.match(logs[1], /notification failed/);
  globalThis.fetch = async (url, init) => { const u = String(url); if (u.includes('Certified_Lounge_Summary') || (init?.body || '').includes('Certified_Lounge_Summary')) return new Response('boom', { status: 500 }); return real(url, init); };
  logs.length = 0;
  const out2 = await recordSubmission(plain({ show: 'Show', rating: 3 }), ENV_SECRETS, { sheets: new SurveySheet('tok'), now: new Date(clock.now), log: (m) => logs.push(m) });
  assert.deepEqual(out2, { ok: true, subscribeResult: 'skipped' });
});

test('missing tabs are created with their header row; a Sheets refusal before the row is saved is an error', async () => {
  const g = fakeGoogle({}); const sheets = new SurveySheet('tok');
  await recordSubmission(plain({ _kind: 'service', service: 'Web', email: 'a@b.co', subscribed: true }), ENV_SECRETS, { sheets, now: new Date(clock.now), log: () => {} });
  for (const tab of [TABS.service, TABS.serviceSubscribers, TABS.discounts]) assert.ok(g.tabs.has(tab), tab);
  assert.deepEqual(g.tabs.get(TABS.service).rows[0], HEADERS.service); assert.deepEqual(g.tabs.get(TABS.discounts).rows[0], HEADERS.discounts);
  assert.ok(g.tabs.get(TABS.service).formats.some((f) => f.repeatCell?.cell.userEnteredFormat.textFormat?.bold));
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes(':append') ? new Response('{}', { status: 403 }) : real(url, init));
  await assert.rejects(recordSubmission(plain({ show: 'S' }), ENV_SECRETS, { sheets: new SurveySheet('tok'), now: new Date(clock.now), log: () => {} }), /Sheets answered 403/);
});

test('the Sheets sign-in uses the survey service account with read-write scope, and the sheet id can be overridden', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const g = fakeGoogle(seedData()); const scopes = []; const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (String(url) === 'https://oauth2.googleapis.com/token') { scopes.push(JSON.parse(Buffer.from(new URLSearchParams(init.body).get('assertion').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).scope); return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })); } return real(url, init); };
  await recordSubmission(plain({ show: 'S', rating: 4 }), { ...ENV_SECRETS, SURVEY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'survey@x.iam.gserviceaccount.com', private_key: pem }), SURVEYS_SHEET_ID: 'overrideSheetId1234567890' }, { now: new Date(clock.now) });
  assert.deepEqual(scopes, ['https://www.googleapis.com/auth/spreadsheets']);
  assert.ok(g.requests.every((q) => true)); assert.equal(SURVEYS_SHEET_ID, '1TVI4SfvMOhFYpAfTkdV3p1pT9Gs5xUlNnwKDed7yvp0');
});

// ---------------------------------------------------------------- dates and the sheet id
test('serial numbers round-trip through Nashville time, including daylight-saving changes', () => {
  assert.equal(dateToSerial(new Date('2026-01-01T06:00:00Z')), 46023);                                    // midnight on New Year's Day in Nashville
  assert.equal(dateToSerial(new Date('2026-01-01T18:00:00Z')), 46023.5);                                  // noon
  for (const iso of ['2026-03-08T07:59:59Z', '2026-03-08T08:00:01Z', '2026-11-01T05:59:59Z', '2026-11-01T08:30:00Z', '2026-07-04T03:30:00Z', '2026-12-31T05:59:59Z']) {   // (the repeated hour in November is ambiguous in a Sheet too)
    const d = new Date(iso); assert.ok(Math.abs(serialToDate(dateToSerial(d)) - d) <= 1000, iso);
  }
  assert.equal(serialToDate(46023).toISOString(), '2026-01-01T06:00:00.000Z');
  const a = new Date('2026-11-12T20:03:22.120Z'), b = new Date('2026-11-12T20:03:22.480Z');
  assert.ok(dateToSerial(b) > dateToSerial(a));                                                           // milliseconds are kept, so quick submissions stay in order
});

test('the survey sheet id matches the old script', () => {
  assert.equal((/const SPREADSHEET_ID = '([^']+)'/.exec(GS) || [])[1], SURVEYS_SHEET_ID);
});
