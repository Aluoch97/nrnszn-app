// Tests for stage 1 of moving the survey off Apps Script (src/edge/survey.js): the submission rules, the e-mails and the unsubscribe links.
// DIFFERENTIAL: the real functions from apps-script/survey/Code.gs run in a sandbox next to the new code on the same inputs
// (hundreds of random ones), and what they would save, send and link must match exactly.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  shouldDrop, buildSubmission, escapeHtml, stripForSubject, formatShortDate, generateDiscountCode, makeUnsubToken, verifyUnsubToken, buildUnsubscribeUrl,
  buildServiceThankYouEmail, buildNotifySubmission, buildNotifyServiceSubmission, sendEmail, emailShell, shopBannerHtml, previewBannerHtml,
  NOTIFY_EMAIL, SHOP_URL, SHOP_BANNER_URL, SERVICE_DISCOUNT_PERCENT, MIN_SUBMIT_MS, MAILING_ADDRESS, SURVEY_APPS_SCRIPT_URL, EMAIL_RE,
} from '../src/edge/survey.js';

const GS_RAW = readFileSync(new URL('../apps-script/survey/Code.gs', import.meta.url), 'utf8');
const SECRET = 'test-unsub-secret';
const GS = GS_RAW.replace(/const UNSUB_SECRET = '[^']*';/, `const UNSUB_SECRET = '${SECRET}';`);
const WIDGET = readFileSync(new URL('../public/widgets/survey.html', import.meta.url), 'utf8');

// ---------------------------------------------------------------- the old code, run as written, with a fake Google
function oldWorld() {
  const mails = [], sheets = new Map(), logs = [];
  const range = (sheet, r, c, nr, nc) => ({
    setValues(v) { for (let i = 0; i < v.length; i++) { sheet.rows[r - 1 + i] = sheet.rows[r - 1 + i] || []; for (let j = 0; j < v[i].length; j++) sheet.rows[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
    setValue(x) { return this.setValues([[x]]); },
    getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((sheet.rows[r - 1 + i] || [])[c - 1 + j] ?? ''))); },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; },
  });
  const sheetOf = (name) => { const s = { name, rows: [] };
    Object.assign(s, {
      getRange: (r, c, nr = 1, nc = 1) => (typeof r === 'string' ? range(s, 1, 1, 1, 1) : range(s, r, c, nr, nc)),
      getLastRow: () => s.rows.length, getDataRange: () => ({ getValues: () => { const w = Math.max(0, ...s.rows.map((x) => x.length)); return s.rows.map((x) => Array.from({ length: w }, (_, j) => x[j] ?? '')); } }),
      setFrozenRows() {}, setConditionalFormatRules() {}, autoResizeColumns() {}, clear() { s.rows = []; },
    }); return s; };
  const ctx = vm.createContext({
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => { const s = sheetOf(n); sheets.set(n, s); return s; } }),
      newConditionalFormatRule: () => { const b = { whenFormulaSatisfied: () => b, setBackground: () => b, setRanges: () => b, build: () => ({}) }; return b; } },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
    MailApp: { sendEmail: (a, b, c) => mails.push(typeof a === 'object' ? { to: a.to, subject: a.subject, html: a.htmlBody } : { to: a, subject: b, text: c }) },
    ScriptApp: { getService: () => ({ getUrl: () => SURVEY_APPS_SCRIPT_URL }) },
    Utilities: {
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => ctx.__uuid || '4f91a2c7-0000-4000-8000-000000000000',
    },
    Logger: { log: (m) => logs.push(m) },
  });
  vm.runInContext(GS, ctx);
  const call = (code) => vm.runInContext(code, ctx);
  return { ctx, mails, sheets, logs, call, json: (t) => JSON.parse(t) };
}
const oldDoPost = (w, body) => JSON.parse(w.call(`doPost({ postData: { contents: ${JSON.stringify(typeof body === 'string' ? body : JSON.stringify(body))} } })`).text);
const lastRow = (w, name) => { const s = w.sheets.get(name); return s && s.rows.length ? Array.from(s.rows[s.rows.length - 1]) : null; };
const SHOW_TAB = 'Certified_Lounge_Surveys', SERVICE_TAB = 'NuRenaissance_Service_Surveys';

// A small seeded random generator so a failure can be reproduced.
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// ---------------------------------------------------------------- the submission rules
test('300 random submissions: the old and new code agree on what is dropped, and on the row that is saved', () => {
  const rnd = rng(11), pick = (a) => a[Math.floor(rnd() * a.length)];
  const t = ['', 'Fall 2026 | Show 16', 'x'.repeat(250), 'x'.repeat(2100), '  padded  ', '=SUM(1)', '<b>html</b>', 'émoji 🎤', 7, 0, null, undefined, true];
  const email = ['', 'ana@example.com', ' Ana@Example.com ', 'bad', 'a@b', '@x.co', 'x@y.z', 'two words@x.co', undefined, null, 5];
  const now = Date.now();
  for (let n = 0; n < 300; n++) {
    const body = {};
    const set = (k, v) => { if (v !== undefined) body[k] = v; };
    set('_kind', pick([undefined, 'service', 'show', 'other', 5])); set('website', pick(['', '', '', '', 'http://spam', 0]));
    set('loadedAt', pick([now - 60000, now - 60000, now - 5000, now - 100, 0, undefined, 'abc', String(now - 9000), null]));
    set('rating', pick([undefined, 1, 5, '3', '5abc', 0, 6, -1, 2.7, 'x', '', null, true]));
    for (const k of ['show', 'service', 'feedback', 'note', 'attendeeType', 'source', 'favoritePerformer', 'bringFriend', 'hireAgain', 'name']) set(k, pick(t));
    set('email', pick(email)); set('subscribed', pick([true, false, undefined, 1, 0, 'yes', '']));
    set('testimonialOk', pick([true, false, undefined, 'yes', 0]));
    const w = oldWorld();
    const out = oldDoPost(w, body);
    assert.equal(out.ok, true, 'old code errored on #' + n + ' ' + JSON.stringify(body));
    const dropped = shouldDrop(body);
    const tab = body._kind === 'service' ? SERVICE_TAB : SHOW_TAB, row = lastRow(w, tab);
    if (dropped) { assert.equal(w.sheets.size, 0, 'a dropped submission must save nothing, #' + n + ' ' + JSON.stringify(body)); continue; }
    assert.ok(row, 'the old code saved a row for #' + n);
    const mine = buildSubmission(body, 'TS');
    assert.equal(mine.kind, body._kind === 'service' ? 'service' : 'show');
    assert.deepEqual(mine.row.slice(1), row.slice(1), 'row for #' + n + ' ' + JSON.stringify(body));
    assert.equal(mine.row.length, row.length);
  }
});

test('honeypot, "too fast" and missing page-load time are dropped; a real person (page open a few seconds) is not', () => {
  const now = 1_700_000_000_000;
  assert.equal(shouldDrop({ website: 'x', loadedAt: now - 99999 }, now), true);
  assert.equal(shouldDrop({ loadedAt: now - (MIN_SUBMIT_MS - 1) }, now), true);
  assert.equal(shouldDrop({ loadedAt: now - MIN_SUBMIT_MS }, now), false);
  assert.equal(shouldDrop({}, now), true); assert.equal(shouldDrop({ loadedAt: 'nope' }, now), true); assert.equal(shouldDrop({ loadedAt: 0 }, now), true);
  assert.equal(shouldDrop({ loadedAt: String(now - 5000) }, now), false);
});

test('ratings outside 1 to 5 become blank, bad e-mails are dropped and never subscribe, kinds fall back to the show survey', () => {
  const ts = 'T', b = (o) => buildSubmission({ loadedAt: 1, ...o }, ts);
  assert.deepEqual([1, 5, '4', 2.9].map((r) => b({ rating: r }).rating), [1, 5, 4, 2]);
  assert.deepEqual([0, 6, 'x', undefined, null, -3].map((r) => b({ rating: r }).rating), ['', '', '', '', '', '']);
  const bad = b({ email: 'not-an-email', subscribed: true }); assert.equal(bad.email, ''); assert.equal(bad.subscribed, false); assert.equal(bad.row[11], 'No');
  const good = b({ email: '  a@b.co ', subscribed: true }); assert.equal(good.email, 'a@b.co'); assert.equal(good.subscribed, true); assert.equal(good.row[11], 'Yes');
  assert.equal(b({ _kind: 'service' }).kind, 'service'); assert.equal(b({ _kind: 'weird' }).kind, 'show'); assert.equal(b({}).row.length, 12); assert.equal(b({ _kind: 'service' }).row.length, 11);
  assert.equal(b({ show: 'x'.repeat(300) }).row[1].length, 200); assert.equal(b({ feedback: 'x'.repeat(3000) }).row[3].length, 2000);
  assert.ok(EMAIL_RE.test('a@b.co') && !EMAIL_RE.test('a b@c.co'));
});

// ---------------------------------------------------------------- the e-mails, byte for byte
test('escaping and subject cleaning match the old code on random text', () => {
  const w = oldWorld(), rnd = rng(3);
  const chars = ['a', 'B', ' ', '&', '<', '>', '"', "'", '\n', '\r', '\t', '=', '🎤', 'é', '​'];
  for (let n = 0; n < 200; n++) {
    const s = Array.from({ length: Math.floor(rnd() * 30) }, () => chars[Math.floor(rnd() * chars.length)]).join('');
    for (const v of [s, null, undefined, 0, 7]) {
      w.ctx.__v = v;
      assert.equal(escapeHtml(v), w.call('escapeHtml(__v)')); assert.equal(stripForSubject(v), w.call('stripForSubject(__v)'));
    }
  }
});

test('the service thank-you e-mail is identical to the old one: subject and every character of the HTML', async () => {
  const rnd = rng(5), pick = (a) => a[Math.floor(rnd() * a.length)];
  const names = ['', 'Jordan', '<script>alert(1)</script>', 'O\'Brien & "Sons"', '  Spaced  ', 'émoji 🎤', 'x'.repeat(120)];
  const emails = ['jo@example.com', 'Jo.Smith+tag@Example.COM', 'a@b.co', 'ünï@exämple.com', 'x y@z.co'];
  const dates = [null, '', undefined, new Date('2026-03-04T12:00:00Z'), '2026-11-12T12:00:00Z', 'garbage', new Date('invalid'), 0];
  for (let n = 0; n < 150; n++) {
    const email = pick(emails), name = pick(names), code = pick(['NR10-4F91A2C7', 'NR10-<b>', 'X']);
    const opts = { alreadyRedeemed: pick([true, false, undefined]), redeemedDate: pick(dates), preview: pick([true, false, undefined]) };
    const w = oldWorld();
    w.ctx.__a = [email, name, code, opts];
    w.call('sendServiceThankYouEmail(__a[0], __a[1], __a[2], __a[3])');
    const old = w.mails[0], mine = await buildServiceThankYouEmail(email, name, code, opts, SECRET);
    assert.equal(mine.subject, old.subject, 'subject #' + n); assert.equal(mine.html, old.html, 'html #' + n + ' ' + JSON.stringify([email, name, code, opts]));
    assert.equal(old.to, email);
  }
});

test('your notification e-mails (show and service) are identical to the old ones', () => {
  const rnd = rng(9), pick = (a) => a[Math.floor(rnd() * a.length)];
  const t = ['', 'Fall 2026 | Show 16\nnext line', 'Feedback with\ttab', '(none)', 'Yes', 'No', 'First-time', 'Friend', 'x'.repeat(300)];
  const results = ['added', 'reactivated', 'already-subscribed', 'skipped'];
  for (let n = 0; n < 150; n++) {
    const sub = pick(['Yes', 'No']), rating = pick([1, 3, 5, '']);
    const showRow = [new Date(), pick(t), rating, pick(t), pick(t), pick(t), pick(t), pick(t), pick(t), pick(t), pick(['', 'a@b.co']), sub];
    const svcRow = [new Date(), pick(t), rating, pick(t), pick(t), pick(t), pick(['Yes', 'No']), pick(t), pick(t), pick(['', 'a@b.co']), sub];
    const r = pick(results), w = oldWorld();
    w.ctx.__rows = [showRow, svcRow, r];
    w.call('notifySubmission(__rows[0], __rows[2]); notifyServiceSubmission(__rows[1], __rows[2]);');
    const [oldShow, oldSvc] = w.mails;
    assert.deepEqual({ to: oldShow.to, ...buildNotifySubmission(showRow, r) }, { to: NOTIFY_EMAIL, subject: oldShow.subject, text: oldShow.text }, 'show #' + n);
    assert.deepEqual({ to: oldSvc.to, ...buildNotifyServiceSubmission(svcRow, r) }, { to: NOTIFY_EMAIL, subject: oldSvc.subject, text: oldSvc.text }, 'service #' + n);
  }
});

test('the e-mail frame, shop banner and preview banner are identical to the old ones', () => {
  const w = oldWorld();
  assert.equal(shopBannerHtml(), w.call('shopBannerHtml()')); assert.equal(previewBannerHtml(), w.call('previewBannerHtml()'));
  for (const opts of [{ bodyHtml: '<p>hi</p>', footerNote: 'foot' }, { eyebrow: 'A & B', bodyHtml: 'x', footerNote: 'y', unsubUrl: 'https://u', previewBanner: '<i>p</i>' }]) {
    w.ctx.__o = opts; assert.equal(emailShell(opts), w.call('emailShell(__o)'));
  }
});

// ---------------------------------------------------------------- unsubscribe links
test('unsubscribe tokens and links are identical to the old ones, so links already sent keep working', async () => {
  const w = oldWorld();
  for (const email of ['jo@example.com', ' Jo@Example.COM ', 'a+b@c.co', 'ünï@exämple.com', '', 'x']) {
    w.ctx.__e = email;
    assert.equal(await makeUnsubToken(email, SECRET), w.call('makeUnsubToken(__e)'), JSON.stringify(email));
    for (const kind of ['show', 'service', 'weird', undefined]) { w.ctx.__k = kind; assert.equal(await buildUnsubscribeUrl(email, kind, SECRET), w.call('buildUnsubscribeUrl(__e, __k)')); }
    const token = await makeUnsubToken(email, SECRET);
    assert.equal(await verifyUnsubToken(email, token, SECRET), true);
  }
});

test('a forged, mixed-up or wrong-secret unsubscribe token is refused', async () => {
  const t = await makeUnsubToken('jo@example.com', SECRET);
  assert.match(t, /^[0-9a-f]{24}$/);
  assert.equal(await verifyUnsubToken('JO@example.com ', t, SECRET), true);              // case and spaces do not matter, like before
  assert.equal(await verifyUnsubToken('other@example.com', t, SECRET), false);
  assert.equal(await verifyUnsubToken('jo@example.com', t, 'another-secret'), false);
  assert.equal(await verifyUnsubToken('jo@example.com', '', SECRET), false); assert.equal(await verifyUnsubToken('jo@example.com', undefined, SECRET), false);
  assert.equal(await verifyUnsubToken('jo@example.com', t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'), SECRET), false);
});

// ---------------------------------------------------------------- codes and dates
test('discount codes look like the old ones and use the first 8 characters of a random id', () => {
  const w = oldWorld();
  assert.equal(generateDiscountCode('4f91a2c7-0000-4000-8000-000000000000'), w.call('generateDiscountCode()'));
  assert.match(generateDiscountCode(), /^NR10-[0-9A-F]{8}$/); assert.notEqual(generateDiscountCode(), generateDiscountCode());
});

test('dates in the e-mail never read "Invalid Date" and use Nashville time', () => {
  assert.equal(formatShortDate('2026-03-04T18:00:00Z'), 'Mar 4, 2026');
  assert.equal(formatShortDate('2026-03-05T04:30:00Z'), 'Mar 4, 2026');          // 10:30 pm on the 4th in Nashville
  for (const bad of [null, undefined, '', 'garbage', new Date('x'), 0]) assert.equal(formatShortDate(bad), '');
});

// ---------------------------------------------------------------- sending through Resend
let sent, resendStatus;
beforeEach(() => {
  sent = []; resendStatus = 200;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) }); return new Response(resendStatus === 200 ? '{"id":"x"}' : 'rate limited', { status: resendStatus }); };
});
test('Resend: the e-mail is sent with the key, the right sender and reply-to, clean subject, and an HTML or text-only body', async () => {
  const env = { RESEND_API_KEY: ' re_test ' };
  await sendEmail({ to: 'jo@example.com', subject: 'Hi\r\nBcc: evil@example.com', html: '<p>x</p>' }, env);
  assert.equal(sent[0].url, 'https://api.resend.com/emails'); assert.equal(sent[0].headers.authorization, 'Bearer re_test');
  assert.deepEqual(sent[0].body, { from: 'NuRenaissance <survey@mail.nrnszn.com>', to: ['jo@example.com'], subject: 'Hi Bcc: evil@example.com', reply_to: NOTIFY_EMAIL, html: '<p>x</p>', text: 'Please view this email in an HTML-compatible client.' });
  await sendEmail({ to: NOTIFY_EMAIL, subject: 'New response', text: 'a\nb' }, { RESEND_API_KEY: 'k', SURVEY_FROM_EMAIL: 'Me <me@mail.nrnszn.com>' });
  assert.equal(sent[1].body.from, 'Me <me@mail.nrnszn.com>'); assert.equal(sent[1].body.text, 'a\nb'); assert.ok(!('html' in sent[1].body));
});
test('Resend: no key or a refusal is an error (so the caller can fall back), never silent', async () => {
  await assert.rejects(sendEmail({ to: 'a@b.co', subject: 's', text: 't' }, {}), /RESEND_API_KEY is not set/);
  assert.equal(sent.length, 0);
  resendStatus = 429; await assert.rejects(sendEmail({ to: 'a@b.co', subject: 's', text: 't' }, { RESEND_API_KEY: 'k' }), /Resend answered 429/);
});

// ---------------------------------------------------------------- the copies stay in step
test('the constants here equal the ones in the old script and the widget', () => {
  const get = (re) => (re.exec(GS_RAW) || [])[1];
  assert.equal(get(/const NOTIFY_EMAIL = '([^']+)'/), NOTIFY_EMAIL); assert.equal(get(/const SHOP_URL = '([^']+)'/), SHOP_URL);
  assert.equal(get(/const SHOP_BANNER_URL = '([^']+)'/), SHOP_BANNER_URL); assert.equal(get(/const MAILING_ADDRESS = '([^']+)'/), MAILING_ADDRESS);
  assert.equal(Number(get(/const SERVICE_DISCOUNT_PERCENT = (\d+)/)), SERVICE_DISCOUNT_PERCENT); assert.equal(Number(get(/const MIN_SUBMIT_MS = (\d+)/)), MIN_SUBMIT_MS);
  assert.equal((/var APPS_SCRIPT_URL = '([^']+)'/.exec(WIDGET) || [])[1], SURVEY_APPS_SCRIPT_URL);
  assert.equal(JSON.parse(readFileSync(new URL('../apps-script/survey/appsscript.json', import.meta.url), 'utf8')).timeZone, 'America/Chicago');
});
