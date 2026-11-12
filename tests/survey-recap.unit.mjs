// Tests for survey stage 5 (src/edge/survey-recap.js, survey-recap-api.js, functions/api/survey-recap.js): the daily recap newsletter.
// DIFFERENTIAL: the real checkForRecapVideo() from apps-script/survey/Code.gs runs in a sandbox (in-memory spreadsheet, fake YouTube, fake
// MailApp with a quota) next to the new code on a fake Google Sheets / YouTube / Resend, over the same sheets, the same video and the same clock.
// The e-mails sent (to, subject, every character of the HTML, with the unsubscribe link base mapped), the recap log, which video counts as
// handled and your notification e-mails must match, including across two consecutive days when a daily cap splits the list.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestPost } from '../functions/api/survey-recap.js';
import {
  checkForRecapVideo, findShowForVideo, unsentSubscribers, buildRecapEmail, extractYoutubeVideoId, latestFromFeed, getLatestReadyRecapVideo,
  STATE_TAB, LAST_VIDEO_KEY, YOUTUBE_CHANNEL_ID, RECAP_SHOW_WINDOW_DAYS, SITE_SURVEY_URL, DEFAULT_RECAP_DAILY_CAP,
} from '../src/edge/survey-recap.js';
import { sameToken } from '../src/edge/survey-recap-api.js';
import { SurveySheet, dateToSerial, TABS, HEADERS } from '../src/edge/survey-sheets.js';
import { SURVEY_APPS_SCRIPT_URL, NOTIFY_EMAIL } from '../src/edge/survey.js';
import { forgetToken } from '../src/edge/google.js';

const SECRET = 'test-unsub-secret';
const GS = readFileSync(new URL('../apps-script/survey/Code.gs', import.meta.url), 'utf8').replace(/const UNSUB_SECRET = '[^']*';/, `const UNSUB_SECRET = '${SECRET}';`).replace(/const YOUTUBE_API_KEY = '[^']*';/, "const YOUTUBE_API_KEY = 'test-key';");
const WORKFLOW = readFileSync(new URL('../.github/workflows/recap-daily.yml', import.meta.url), 'utf8');
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const NOW = Date.parse('2026-11-12T20:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000);
const VIDEO = { id: 'vid12345678', publishedAt: new Date(NOW - 3600000).toISOString() };

// ---------------------------------------------------------------- a scenario = the sheet + what YouTube says
const S = (ts, show, email, name, subscribed) => [ts, show, 5, '', '', '', '', '', '', name, email, subscribed];
function baseSheet() {
  return {
    [TABS.show]: [HEADERS.show,
      S(hoursAgo(30), 'Solberg - Oct 17', 'ana@example.com', 'Ana', 'Yes'), S(hoursAgo(29), 'Solberg - Oct 17', 'ANA@example.com', 'Ana again', 'Yes'),
      S(hoursAgo(28), 'Solberg - Oct 17', 'gone@example.com', 'Gone', 'Yes'), S(hoursAgo(27), 'Solberg - Oct 17', 'sent@example.com', 'Sent', 'Yes'),
      S(hoursAgo(26), 'Solberg - Oct 17', '', 'Blank', 'Yes'), S(hoursAgo(25), 'Solberg - Oct 17', 'no@example.com', 'No', 'No'),
      S(hoursAgo(24), 'Solberg - Oct 17', 'jo@example.com', '<b>Jo</b> & co', 'yes'), S(hoursAgo(20), 'Other Show', 'o@example.com', 'O', 'Yes'),
      S(hoursAgo(400), 'Solberg - Oct 17', 'old@example.com', 'Old', 'Yes'), ['not a date', 'Solberg - Oct 17', 4, '', '', '', '', '', '', 'Text', 'text@example.com', 'Yes']],
    [TABS.subscribers]: [HEADERS.subscribers, [hoursAgo(30), '', 'gone@example.com', 'Unsubscribed', hoursAgo(5)], [hoursAgo(30), '', 'ana@example.com', 'Active', '']],
    [TABS.recapLog]: [['Email', 'Show', 'Sent_At', 'Video_URL'], ['sent@example.com', 'Solberg - Oct 17', hoursAgo(1000), 'https://old']],
  };
}
const scenario = (over = {}) => ({ sheet: baseSheet(), video: VIDEO, state: '', cap: 50, search: 'ok', ...over });

// ---------------------------------------------------------------- the old code in a sandbox
function oldWorld(sc) {
  const sheets = new Map(), mails = [], clock = { now: NOW };
  let SD = Date; // the sandbox's own Date class (set below): the old code checks `instanceof Date`, so real dates must be converted
  const inSandbox = (v) => (isDate(v) && !(v instanceof SD) ? new SD(v.getTime()) : v);
  const mk = (name, rows) => { const s = { name, rows: rows.map((r) => [...r]) };
    Object.assign(s, { getDataRange: () => ({ getValues: () => { const w = Math.max(0, ...s.rows.map((x) => x.length)); return s.rows.map((x) => Array.from({ length: w }, (_, j) => inSandbox(x[j] ?? ''))); } }),
      getRange: () => ({ setValues(v) { v.forEach((r, i) => { s.rows[i] = r; }); return this; }, setFontWeight() { return this; } }), appendRow: (r) => { s.rows.push(r); }, setFrozenRows() {} });
    sheets.set(name, s); return s; };
  for (const [n, rows] of Object.entries(sc.sheet)) mk(n, rows);
  const props = { LAST_RECAP_VIDEO_ID: sc.state || null };
  let sentCount = 0;
  const ctx = vm.createContext({
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => mk(n, []) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    UrlFetchApp: { fetch: (url) => { const u = new URL(url);
      const body = u.pathname.endsWith('/search') ? (sc.search === 'none' ? { items: [] } : sc.search === 'error' ? { error: { code: 403 } } : { items: [{ id: { videoId: sc.video.id }, snippet: { publishedAt: sc.video.publishedAt } }] }) : { items: [] };
      return { getContentText: () => JSON.stringify(body) }; } },
    MailApp: { getRemainingDailyQuota: () => sc.cap - sentCount, sendEmail: (a, b, c) => { const isRecap = typeof a === 'object'; if (isRecap) sentCount++; mails.push(isRecap ? { to: a.to, subject: a.subject, html: a.htmlBody } : { to: a, subject: b, text: c }); } },
    ScriptApp: { getService: () => ({ getUrl: () => SURVEY_APPS_SCRIPT_URL }) },
    Utilities: { computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map((b) => (b > 127 ? b - 256 : b)) },
    Logger: { log: (m) => { if (process.env.DBG) console.log('OLDLOG', m); } }, XmlService: {}, ContentService: {},
  });
  vm.runInContext('globalThis.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(__clock.now); } static now() { return __clock.now; } };', Object.assign(ctx, { __clock: clock }));
  SD = vm.runInContext('Date', ctx);
  vm.runInContext(GS, ctx);
  return { sheets, mails, props, day: () => { sentCount = 0; }, run: () => vm.runInContext('checkForRecapVideo()', ctx) };
}

// ---------------------------------------------------------------- the new code against fake Google / YouTube / Resend
let tabs, mailsNew, requests, behaviour, sc2;
function fakeWorld(sc) {
  tabs = new Map(); let nextId = 100; mailsNew = []; requests = []; behaviour = {};
  const fix = (v) => (isDate(v) ? dateToSerial(v) : v);
  const add = (title, rows = []) => { const t = { id: nextId++, title, rows: rows.map((r) => r.map(fix)), formats: [] }; tabs.set(title, t); return t; };
  for (const [n, rows] of Object.entries(sc.sheet)) add(n, rows);
  if (sc.state) add(STATE_TAB, [['Key', 'Value'], [LAST_VIDEO_KEY, sc.state]]);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const trim = (rows) => rows.map((r) => { const x = [...r]; while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
  const cellOf = (a1) => { const m = /^([A-Z]+)(\d+)$/.exec(a1); return [Number(m[2]), [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)]; };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.resend.com') {
      if (behaviour.resend === 'refuse') return new Response('no', { status: 429 });
      const b = JSON.parse(init.body);
      if (u.pathname === '/emails/batch') { requests.push('batch ' + b.length); b.forEach((m) => mailsNew.push({ to: m.to[0], subject: m.subject, html: m.html })); return json({ data: b.map(() => ({ id: 'x' })) }); }
      requests.push('single'); mailsNew.push({ to: b.to[0], subject: b.subject, ...(b.html ? { html: b.html } : { text: b.text }) }); return json({ id: 'x' });
    }
    if (u.hostname === 'www.googleapis.com') {
      if (u.pathname.endsWith('/search')) return json(sc2.search === 'none' ? { items: [] } : sc2.search === 'error' ? { error: { code: 403 } } : { items: [{ id: { videoId: sc2.video.id }, snippet: { publishedAt: sc2.video.publishedAt } }] });
      return json({ items: [] });
    }
    if (u.hostname === 'www.youtube.com') return behaviour.feed ? new Response(behaviour.feed, { status: 200 }) : new Response('no', { status: 404 });
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(u.pathname); if (!m) throw new Error('unexpected fetch ' + u);
    const rest = decodeURIComponent(m[2]), body = init.body ? JSON.parse(init.body) : null; requests.push((init.method || 'GET') + ' ' + rest);
    if (rest === '') return json({ sheets: [...tabs.values()].map((t) => ({ properties: { sheetId: t.id, title: t.title } })) });
    if (rest === ':batchUpdate') { const replies = body.requests.map((r) => { if (r.addSheet) { const t = add(r.addSheet.properties.title); return { addSheet: { properties: { sheetId: t.id, title: t.title } } }; } const t = [...tabs.values()].find((x) => x.id === r.repeatCell?.range.sheetId); if (t) t.formats.push(r.repeatCell.range); return {}; }); return json({ replies }); }
    let mm;
    if ((mm = /^\/values\/([^!]+)$/.exec(rest)) && !init.method) { const t = tabs.get(mm[1]); return t ? json({ values: trim(t.rows) }) : json({ error: 'Unable to parse range' }, 400); }
    if ((mm = /^\/values\/([^!]+)!A:A:append$/.exec(rest))) {
      const t = tabs.get(mm[1]); let last = trim(t.rows).length; const first = last + 1;
      for (const r of body.values) { t.rows[last++] = r.map(fix); }
      return json({ updates: { updatedRange: `${mm[1]}!A${first}:D${last}` } });
    }
    if ((mm = /^\/values\/([^!]+)!A1$/.exec(rest)) && init.method === 'PUT') { const t = tabs.get(mm[1]); body.values.forEach((r, i) => r.forEach((v, j) => { t.rows[i] = t.rows[i] || []; t.rows[i][j] = fix(v); })); return json({}); }
    if (rest === '/values:batchUpdate') { for (const d of body.data) { const [tab, a1] = d.range.split('!'); const [r, c] = cellOf(a1); const t = tabs.get(tab); t.rows[r - 1] = t.rows[r - 1] || []; t.rows[r - 1][c - 1] = fix(d.values[0][0]); } return json({}); }
    throw new Error('unexpected sheets call ' + (init.method || 'GET') + ' ' + rest);
  };
}
const ENV = (over = {}) => ({ SURVEY_UNSUB_SECRET: SECRET, RESEND_API_KEY: 'rk', YOUTUBE_API_KEY: 'test-key', ...over });
const normMail = (m) => ({ ...m, ...(m.html ? { html: m.html.split(SITE_SURVEY_URL).join(SURVEY_APPS_SCRIPT_URL) } : {}) });
const tsOfRows = (rows) => rows.map((r) => r.map((v, c) => (isDate(v) || (typeof v === 'number' && v > 20000 && c === 2) ? '<ts>' : v))).map((r) => { const x = [...r]; while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
const lastIdNew = () => { const t = tabs.get(STATE_TAB); const r = t && t.rows.find((x) => x[0] === LAST_VIDEO_KEY); return r ? String(r[1]) : null; };

/** Runs the same scenario through both worlds for `days` consecutive days and compares everything. */
async function both(sc, days = 1) {
  const old = oldWorld(sc); fakeWorld(sc); sc2 = sc;
  const sheets = new SurveySheet('tok');
  for (let d = 0; d < days; d++) {
    old.day(); old.mails.length = 0; mailsNew.length = 0;
    old.run(); const out = await checkForRecapVideo(ENV({ RECAP_DAILY_CAP: sc.cap }), { sheets, now: new Date(NOW), log: () => {} });
    assert.deepEqual(mailsNew.map(normMail), old.mails, 'e-mails, day ' + (d + 1));
    for (const tab of [TABS.recapLog]) assert.deepEqual(tsOfRows(tabs.get(tab)?.rows || []), tsOfRows(old.sheets.get(tab)?.rows || []).map((r) => r), 'recap log, day ' + (d + 1));
    assert.equal(lastIdNew(), old.props.LAST_RECAP_VIDEO_ID, 'handled video, day ' + (d + 1));
    if (d === days - 1) return out;
  }
}

test('a normal recap: same e-mails, same log, same handled video as the old Apps Script (dedupe, unsubscribed, blank, "No", HTML in names, old and text dates)', async () => {
  const out = await both(scenario());
  assert.deepEqual([out.result, out.show, out.sent], ['sent', 'Solberg - Oct 17', 4]);   // ana, jo, and the two whose dates are old or text (recipients do not depend on the date)
  assert.deepEqual(mailsNew.filter((m) => m.html).map((m) => m.to).sort(), ['ana@example.com', 'jo@example.com', 'old@example.com', 'text@example.com']);
  assert.ok(mailsNew.find((m) => m.to === 'jo@example.com').html.includes('&lt;b&gt;Jo&lt;/b&gt; &amp; co'));
  assert.equal(mailsNew.at(-1).to, NOTIFY_EMAIL); assert.match(mailsNew.at(-1).subject, /^Recap sent for Solberg/);
});

test('nothing ready, already handled, no matching show, nobody to send to: all behave like the old script', async () => {
  assert.equal((await both(scenario({ search: 'none' }))).result, 'nothing-ready');
  assert.equal((await both(scenario({ state: VIDEO.id }))).result, 'already-handled');
  const old = baseSheet(); old[TABS.show] = [HEADERS.show, S(hoursAgo(500), 'Far Show', 'a@b.co', 'A', 'Yes')];
  const noShow = await both(scenario({ sheet: old })); assert.equal(noShow.result, 'no-show'); assert.match(mailsNew[0].text, /Couldn't match this video/);
  const none = baseSheet(); for (const e of ['ana', 'jo', 'old', 'text']) none[TABS.recapLog].push([e + '@example.com', 'Solberg - Oct 17', hoursAgo(5), 'u']);
  assert.equal((await both(scenario({ sheet: none }))).result, 'no-recipients');
  const noTabs = { [TABS.show]: baseSheet()[TABS.show] };                                                    // no Subscribers tab and no recap log yet
  assert.equal((await both(scenario({ sheet: noTabs }))).result, 'sent');
  assert.equal((await both(scenario({ sheet: {} }))).result, 'no-show');
});

test('a daily cap splits a big list over days exactly like the old quota did; the video counts as handled only when the list is finished', async () => {
  const bigSheet = () => { const sh = baseSheet(); for (let i = 0; i < 7; i++) sh[TABS.show].push(S(hoursAgo(23 - i), 'Solberg - Oct 17', `fan${i}@example.com`, `Fan ${i}`, 'Yes')); return sh; };
  const sheet = bigSheet();
  const out = await both(scenario({ sheet, cap: 4 }), 1); assert.equal(out.result, 'partial');
  assert.match(mailsNew.at(-1).text, /Sent 4 of 11 recap emails/); assert.equal(lastIdNew(), null);
  assert.equal((await both(scenario({ sheet: bigSheet(), cap: 4 }), 3)).result, 'sent');   // three days: 4 + 4 + 3
});

test('150 random sheets and caps give identical e-mails, logs and handled video', async () => {
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pick = (a) => a[rnd(a.length)];
  for (let n = 0; n < 150; n++) {
    const sheet = { [TABS.show]: [HEADERS.show], [TABS.subscribers]: [HEADERS.subscribers], [TABS.recapLog]: [['Email', 'Show', 'Sent_At', 'Video_URL']] };
    const emails = ['a@x.co', 'A@x.co', 'b@x.co', 'c@x.co', '', ' d@x.co ', 'e@x.co'];
    for (let i = rnd(14); i > 0; i--) sheet[TABS.show].push(S(pick([hoursAgo(10), hoursAgo(60), hoursAgo(95), hoursAgo(97), hoursAgo(300), 'text', '']), pick(['Show A', 'Show B', 'show a', '', 'Show A ']), pick(emails), pick(['', 'N', 'N <b>']), pick(['Yes', 'yes', 'No', '', true])));
    for (let i = rnd(4); i > 0; i--) sheet[TABS.subscribers].push([hoursAgo(10), '', pick(emails), pick(['Unsubscribed', 'Active', '', 'unsubscribed']), '']);
    for (let i = rnd(3); i > 0; i--) sheet[TABS.recapLog].push([pick(emails), pick(['Show A', 'Show B']), hoursAgo(9), 'u']);
    if (rnd(5) === 0) delete sheet[TABS.subscribers]; if (rnd(5) === 0) delete sheet[TABS.recapLog];
    await both(scenario({ sheet, cap: 1 + rnd(5), state: pick(['', '', 'other']) }), 1 + rnd(2));
  }
});

test('the e-mail template and links: identical to sendRecapEmail, with the unsubscribe link pointing at this site; thumbnails and video ids', async () => {
  const m = await buildRecapEmail('a+b@x.co', 'Ana', 'Show\nInject: x', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', SECRET);
  assert.ok(!m.subject.includes('\n')); assert.match(m.html, /href="https:\/\/www\.nrnszn\.com\/api\/survey\?unsub=1&kind=show&email=a%2Bb%40x\.co&t=[0-9a-f]{24}"/);
  assert.ok(m.html.includes('img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'));
  assert.equal(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=1'), 'dQw4w9WgXcQ'); assert.equal(extractYoutubeVideoId('https://x/y'), null);
  assert.equal((await buildRecapEmail('a@x.co', '', 'S', 'https://x/y', SECRET, { preview: true })).subject.startsWith('[PREVIEW] '), true);
  assert.equal((/const YOUTUBE_CHANNEL_ID = '([^']+)'/.exec(GS) || [])[1], YOUTUBE_CHANNEL_ID);
  assert.equal(Number((/const RECAP_SHOW_WINDOW_DAYS = (\d+)/.exec(GS) || [])[1]), RECAP_SHOW_WINDOW_DAYS);
});

test('without a key, or when the API errors, the channel feed is used; a video that is still live or scheduled is not sent yet', async () => {
  const feed = `<feed><entry><yt:videoId>feedvid0001</yt:videoId><published>2026-11-12T18:00:00+00:00</published></entry><entry><yt:videoId>older</yt:videoId><published>2026-11-01T18:00:00+00:00</published></entry></feed>`;
  fakeWorld(scenario()); sc2 = scenario(); behaviour.feed = feed;
  assert.deepEqual(await latestFromFeed(), { videoId: 'feedvid0001', url: 'https://www.youtube.com/watch?v=feedvid0001', published: new Date('2026-11-12T18:00:00Z') });
  assert.equal((await getLatestReadyRecapVideo({}, () => {})).videoId, 'feedvid0001');                    // no key: the feed
  sc2 = scenario({ search: 'error' }); assert.equal((await getLatestReadyRecapVideo({ YOUTUBE_API_KEY: 'k' }, () => {})).videoId, 'feedvid0001');
  sc2 = scenario({ search: 'none' }); assert.equal(await getLatestReadyRecapVideo({ YOUTUBE_API_KEY: 'k' }, () => {}), null);                // a clean "nothing yet": no fallback
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('/youtube/v3/videos') ? new Response(JSON.stringify({ items: [{ snippet: { liveBroadcastContent: 'live' } }] })) : real(url, init));
  assert.equal(await getLatestReadyRecapVideo({ YOUTUBE_API_KEY: 'k' }, () => {}) === null, true, 'API search not used when it errors? (feed + live check)');
  sc2 = scenario({ search: 'error' }); assert.equal(await getLatestReadyRecapVideo({ YOUTUBE_API_KEY: 'k' }, () => {}), null);               // live: wait for tomorrow
  behaviour.feed = '<feed></feed>'; assert.equal(await latestFromFeed(), null);
});

test('a failing step is e-mailed to Nick and never throws; a failed send is not logged, so the next run tries again', async () => {
  const sc = scenario(); fakeWorld(sc); sc2 = sc; behaviour.resend = 'refuse';
  const out = await checkForRecapVideo(ENV(), { sheets: new SurveySheet('tok'), now: new Date(NOW), log: () => {} });
  assert.equal(out.result, 'failed'); assert.equal(tabs.get(TABS.recapLog).rows.length, 2); assert.equal(lastIdNew(), null);   // only the header and the original log row
  behaviour.resend = null;
  const again = await checkForRecapVideo(ENV(), { sheets: new SurveySheet('tok'), now: new Date(NOW), log: () => {} });
  assert.equal(again.result, 'sent'); assert.equal(again.sent, 4);
});

test('50 e-mails go out in one Resend request, and the sent rows are logged in one request, so a big list stays within Cloudflare\'s request limit', async () => {
  const sheet = baseSheet(); for (let i = 0; i < 120; i++) sheet[TABS.show].push(S(hoursAgo(22), 'Solberg - Oct 17', `bulk${i}@example.com`, 'B', 'Yes'));
  const sc = scenario({ sheet }); fakeWorld(sc); sc2 = sc;
  const out = await checkForRecapVideo(ENV({ RECAP_DAILY_CAP: 200 }), { sheets: new SurveySheet('tok'), now: new Date(NOW), log: () => {} });
  assert.equal(out.sent, 124); assert.deepEqual(requests.filter((r) => r.startsWith('batch')), ['batch 50', 'batch 50', 'batch 24']);
  assert.ok(requests.length < 40, 'requests: ' + requests.length);
  assert.equal(tabs.get(TABS.recapLog).formats.length, 3);                                                   // one date format per batch
  assert.equal(DEFAULT_RECAP_DAILY_CAP, 50);
});

// ---------------------------------------------------------------- the pure rules
test('findShowForVideo and unsentSubscribers match their old versions on edge cases (window edges, ties, first-seen order)', () => {
  const t = (h) => dateToSerial(hoursAgo(h));
  const rows = [HEADERS.show, S(t(95), 'A', 'a@x', '', 'Yes'), S(t(97), 'B', 'b@x', '', 'Yes'), S(t(2), 'B', 'c@x', '', 'Yes'), S(t(1), 'A', 'd@x', '', 'Yes'), S(t(-5), 'B', 'e@x', '', 'Yes'), S(t(-6), 'B', 'f@x', '', 'Yes'), S(t(-7), 'B', 'g@x', '', 'Yes')];
  assert.equal(findShowForVideo(rows, hoursAgo(0)), 'A');                                                    // A: 2 inside the window (95h, 1h), B: 1 inside plus 3 answers that came AFTER the video went up, which do not count
  assert.equal(findShowForVideo([HEADERS.show], hoursAgo(0)), null); assert.equal(findShowForVideo(undefined, hoursAgo(0)), null);
  assert.deepEqual(unsentSubscribers(rows, [], [], 'A').map((r) => r.email), ['a@x', 'd@x']);
});

// ---------------------------------------------------------------- the endpoint
let pem;
const post = (token, query = '', env = ENV({ SURVEY_SERVICE_ACCOUNT_JSON: account(), RECAP_CRON_TOKEN: 'cron-secret' })) =>
  onRequestPost({ request: new Request('https://www.nrnszn.com/api/survey-recap' + query, { method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {} }), env });
let keyPair; const account = () => JSON.stringify({ client_email: 'svc@x.iam.gserviceaccount.com', private_key: pem });
beforeEach(async () => {
  forgetToken();
  if (!pem) { keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`; }
});
const withToken = () => { const real = globalThis.fetch; globalThis.fetch = async (url, init) => (String(url) === 'https://oauth2.googleapis.com/token' ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })) : real(url, init)); };

test('the endpoint needs the secret token, stays off until every secret is set, and runs the check when called correctly', async () => {
  fakeWorld(scenario()); sc2 = scenario(); withToken();
  assert.equal((await post('wrong')).status, 401); assert.equal((await post('')).status, 401); assert.equal(mailsNew.length, 0);
  const off = await post('cron-secret', '', ENV({ SURVEY_SERVICE_ACCOUNT_JSON: account() })); assert.equal(off.status, 503); assert.equal((await off.json()).mode, 'apps-script');
  const res = await post('cron-secret'); const d = await res.json();
  assert.equal(res.status, 200); assert.deepEqual([d.ok, d.result, d.sent], [true, 'sent', 4]);
  const again = await (await post('cron-secret')).json(); assert.equal(again.result, 'already-handled'); assert.equal(mailsNew.filter((m) => m.html).length, 4);   // calling twice never e-mails twice
  assert.ok(sameToken('abc', 'abc') && !sameToken('abc', 'abd') && !sameToken('abc', 'abcd') && !sameToken('', 'x'));
});

test('?preview=1 sends the sample recap to Nick only; GET reports which side is in charge', async () => {
  fakeWorld(scenario()); sc2 = scenario(); withToken();
  const d = await (await post('cron-secret', '?preview=1')).json(); assert.equal(d.result, 'preview-sent');
  assert.equal(mailsNew.length, 1); assert.equal(mailsNew[0].to, NOTIFY_EMAIL); assert.match(mailsNew[0].subject, /^\[PREVIEW\]/);
  const on = await (await onRequestGet({ env: ENV({ SURVEY_SERVICE_ACCOUNT_JSON: account(), RECAP_CRON_TOKEN: 'x' }) })).json(); assert.deepEqual([on.status, on.mode], ['ok', 'edge']);
  assert.equal((await (await onRequestGet({ env: {} })).json()).mode, 'apps-script');
});

test('the daily GitHub job skips quietly until its secret exists, calls the endpoint with the token, and can send a preview', () => {
  assert.match(WORKFLOW, /cron: '17 15 \* \* \*'/); assert.match(WORKFLOW, /workflow_dispatch/);
  assert.match(WORKFLOW, /secrets\.RECAP_CRON_TOKEN/); assert.match(WORKFLOW, /-z "\$RECAP_CRON_TOKEN".*exit 0/);
  assert.match(WORKFLOW, /https:\/\/www\.nrnszn\.com\/api\/survey-recap/); assert.match(WORKFLOW, /\?preview=1/); assert.match(WORKFLOW, /"503".*exit 0/);
});
