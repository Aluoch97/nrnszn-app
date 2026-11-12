// Tests for the NuCinema catalog read from its Google Sheet at the edge (src/edge/cinema.js and the `cinema` feed in feeds.js).
// The main proof is a DIFFERENTIAL test: the real doGet() from apps-script/cinema/Code.gs is run in a sandbox (with a fake
// Sheet) next to the new code, on the same rows (a realistic sheet, then hundreds of random ones), and the JSON must match exactly.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildCatalog, readCatalogRows, loadCinema, HEADERS, CINEMA_SHEET_ID, SHEET_NAME } from '../src/edge/cinema.js';
import { getAccessToken, forgetToken, DRIVE_SCOPE, SHEETS_SCOPE } from '../src/edge/google.js';
import { serveFeed } from '../src/edge/feeds.js';

// ---------------------------------------------------------------- the old code, run as written
const GS = readFileSync(new URL('../apps-script/cinema/Code.gs', import.meta.url), 'utf8');
/** What the old web app answered for a sheet whose rows (below the header) are these. Apps Script gives full-width rows. */
function oldAnswer(dataRows) {
  const width = HEADERS.length;
  const values = [HEADERS.slice(0, 12), ...dataRows.map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined || r[i] === null ? '' : r[i])))];
  const ctx = vm.createContext({
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (text) => ({ setMimeType: () => ({ text }) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => values }) }) }) },
  });
  vm.runInContext(GS, ctx);
  return vm.runInContext('doGet({})', ctx).text;
}
const newAnswer = (rows) => JSON.stringify(buildCatalog(rows));
const trim = (r) => { const o = [...r]; while (o.length && (o[o.length - 1] === '' || o[o.length - 1] === undefined)) o.pop(); return o; }; // how Google sends a row

// A sheet shaped like the real one: header without ShowTitle, shows with and without episodes, a featured episode, "New" rows.
const row = (o) => HEADERS.map((h) => (o[h] === undefined ? '' : o[h]));
const SHEET = [
  row({ Title: 'Certified Tour', Type: 'playlist', SourceURL: 'https://www.youtube.com/playlist?list=PLx', Row: 'Shows', SubCategory: 'Vlogumentaries', Synopsis: 'On the road', Thumbnail: 'https://img/tour.png', IsFeature: 'FALSE', Status: 'Approved' }),
  row({ VideoID: 'aaa', Title: 'Carnelian Aura', Type: 'video', SourceURL: 'https://youtu.be/aaa', Row: 'Films', SubCategory: 'Documentaries', Synopsis: 'A live show', IMDb: 'https://imdb/tt1', Thumbnail: 'https://img/a.png', IsFeature: 'FALSE', Status: 'Approved' }),
  row({ VideoID: 'bbb', Title: 'BLUU', Type: 'video', SourceURL: 'https://youtu.be/bbb', Row: 'Films', SubCategory: 'Originals', IsFeature: 'FALSE', Status: 'Approved', Badge: 'NEW' }),
  row({ VideoID: 'ccc', Title: 'No Group', Type: 'video', SourceURL: 'https://youtu.be/ccc', Row: '', SubCategory: '', Status: 'Approved' }),
  row({ Title: 'Da Healerz Circle', Type: 'playlist', SourceURL: 'https://www.youtube.com/playlist?list=PLh', Row: 'Shows', SubCategory: 'Podcasts', Status: 'Approved' }),
  row({ Title: 'Lonely Show', Type: 'playlist', SourceURL: 'https://www.youtube.com/playlist?list=PLl', Row: 'Shows', Synopsis: 'No episodes yet', Thumbnail: 'https://img/l.png', Status: 'Approved' }),
  row({ VideoID: 'e1', Title: 'Episode 1', Type: 'episode', SourceURL: 'https://youtu.be/e1', Row: 'Shows', Thumbnail: 'https://img/e1.jpg', Status: 'Approved', ShowTitle: 'Da Healerz Circle' }),
  row({ VideoID: 'e2', Title: 'Episode 2', Type: 'episode', SourceURL: 'https://youtu.be/e2', Row: 'Shows', Status: 'Approved', ShowTitle: 'Da Healerz Circle' }),
  row({ VideoID: 'k1', Title: 'Kansas City Blues', Type: 'episode', SourceURL: 'https://youtu.be/k1', Row: 'Shows', IsFeature: 'TRUE', Status: 'Approved', ShowTitle: 'Certified Tour' }),
  row({ VideoID: 'k2', Title: 'SXSW', Type: 'episode', SourceURL: 'https://youtu.be/k2', Row: 'Shows', Status: 'Approved', ShowTitle: 'Certified Tour' }),
  row({ VideoID: 'o1', Title: 'Orphan episode', Type: 'episode', SourceURL: 'https://youtu.be/o1', Status: 'Approved' }),                 // no show: ignored
  row({ VideoID: 'n1', Title: 'Not yet', Type: 'video', SourceURL: 'https://youtu.be/n1', Status: 'New' }),                          // waiting to be sorted: not shown
  row({ VideoID: 'n2', Title: 'Hidden episode', Type: 'episode', Status: 'Rejected', ShowTitle: 'Da Healerz Circle' }),
  [],
];

test('the new code gives exactly what the old Apps Script gave, on a realistic sheet', () => {
  const old = oldAnswer(SHEET), now = newAnswer(SHEET.map(trim));
  assert.equal(now, old);
  const c = JSON.parse(now);
  assert.deepEqual(c.films.map((f) => [f.sub, f.items.map((i) => i.title)]), [['Documentaries', ['Carnelian Aura']], ['Originals', ['BLUU']], ['Misc', ['No Group']]]);
  assert.deepEqual(c.shows.map((s) => [s.title, s.episodes.length]), [['Certified Tour', 2], ['Da Healerz Circle', 2], ['Lonely Show', 1]]);
  assert.equal(c.shows[2].episodes[0].title, 'Watch Lonely Show');                                        // a show with no episodes yet shows its own link
  assert.equal(c.shows[2].sub, 'Shows');                                                                   // default group for a show
  assert.equal(c.feature.title, 'Kansas City Blues'); assert.equal(c.feature.episodes.length, 2);        // the featured episode carries its season
  assert.ok(!('showTitle' in c.feature));
  assert.ok(!JSON.stringify(c).includes('Not yet') && !JSON.stringify(c).includes('Orphan') && !JSON.stringify(c).includes('Hidden episode'));
});

test('an empty sheet, or one with nothing approved, gives an empty catalog the same way', () => {
  for (const rows of [[], [[]], [row({ Title: 'x', Status: 'New' })], [row({ Title: 'x', Type: 'video', Status: ' Approved' })]]) assert.equal(newAnswer(rows.map(trim)), oldAnswer(rows));
  assert.deepEqual(buildCatalog(undefined), { feature: null, films: [], shows: [] });
});

test('short rows (Google cuts empty cells at the end), numbers, true/false cells and odd spellings all match the old code', () => {
  const rows = [
    ['id', 1917, 'video', 'https://youtu.be/x', 'Films', 'War', 2020, '', '', true, 'approved'],                       // numbers, a real boolean, lower-case status
    ['id', 'Zero', 'VIDEO', '', 'films', 'war', 0, null, '', false, 'APPROVED'],
    ['id', 'Show A', 'Playlist', 'https://yt/p', 'Shows', '', '', '', '', 'false', 'Approved'],
    ['id', 'Ep', 'Episode', '', 'Shows', '', '', '', '', 'true', 'Approved', '', 'Show A'],                            // featured, 13th cell present
    ['id', 'Ep2', 'episode', '', '', '', '', '', '', '', 'Approved', '', 'Show A'],
    ['id', 'Later feature', 'video', '', 'Films', 'War', '', '', '', 'TrUe', 'Approved'],                              // the LAST feature wins
  ];
  assert.equal(newAnswer(rows.map(trim)), oldAnswer(rows));
  assert.equal(JSON.parse(newAnswer(rows)).feature.title, 'Later feature');
});

test('columns are read by position, so a header row without a "ShowTitle" label (like the live sheet) still works', () => {
  const rows = [row({ Title: 'S', Type: 'playlist', Row: 'Shows', Status: 'Approved' }), row({ Title: 'E', Type: 'episode', Status: 'Approved', ShowTitle: 'S' })];
  assert.equal(JSON.parse(newAnswer(rows)).shows[0].episodes[0].title, 'E');
  assert.equal(HEADERS.length, 13); assert.equal(HEADERS[12], 'ShowTitle');
});

test('300 random sheets: the old and new code never disagree', () => {
  let seed = 20261112;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pools = {
    VideoID: ['', 'v1', 'v2'], Title: ['Alpha', 'Beta', 'Gamma', 'Show A', 'Show B', 7, 0, '', 'Same'], Type: ['video', 'VIDEO', 'Episode', 'episode', 'playlist', '', 'other'],
    SourceURL: ['', 'https://youtu.be/x', 'https://www.youtube.com/playlist?list=PL1'], Row: ['Films', 'Shows', '', 'films', 'Extras'], SubCategory: ['', 'Docs', 'Originals', 'Podcasts', 'Docs'],
    Synopsis: ['', 'text', 2024], IMDb: ['', 'https://imdb/tt1'], Thumbnail: ['', 'https://img/1.png'], IsFeature: ['', 'TRUE', 'true', 'FALSE', true, false, 'yes', 1],
    Status: ['Approved', 'Approved', 'Approved', 'approved', 'New', ' Approved', '', 'Rejected'], Badge: ['', 'NEW', 5], ShowTitle: ['', 'Show A', 'Show B', 'Nope'],
  };
  for (let n = 0; n < 300; n++) {
    const rows = Array.from({ length: Math.floor(rnd() * 25) }, () => HEADERS.map((h) => pick(pools[h])));
    assert.equal(newAnswer(rows.map(trim)), oldAnswer(rows), 'sheet #' + n + ' ' + JSON.stringify(rows));
  }
});

// ---------------------------------------------------------------- reading the Sheet through Google
let account, publicKey, pem, calls, tokenScopes, sheetRows, store, appsScriptAnswer, sheetStatus;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = pair.publicKey;
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  account = { email: 'cinema@nrn.iam.gserviceaccount.com', key: pem };
});
beforeEach(() => {
  forgetToken(); calls = []; tokenScopes = []; store = new Map(); appsScriptAnswer = null; sheetStatus = 200;
  sheetRows = SHEET.map(trim);
  globalThis.caches = { default: { match: async (r) => { const x = store.get(r.url); return x ? x.clone() : undefined; }, put: async (r, res) => { store.set(r.url, res.clone()); } } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') {
      const [h, c, s] = new URLSearchParams(String(init.body)).get('assertion').split('.');
      assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64(s), new TextEncoder().encode(`${h}.${c}`)));
      tokenScopes.push(JSON.parse(b64(c).toString()).scope);
      return json({ access_token: 'tok-' + tokenScopes.length, expires_in: 3600 });
    }
    if (u.hostname === 'sheets.googleapis.com') {
      calls.push({ path: decodeURIComponent(u.pathname), query: Object.fromEntries(u.searchParams), auth: init.headers?.authorization });
      return sheetStatus === 200 ? json({ range: 'x', majorDimension: 'ROWS', ...(sheetRows.length ? { values: sheetRows } : {}) }) : json({ error: { message: 'no' } }, sheetStatus);
    }
    if (u.hostname === 'script.google.com') { calls.push('APPS-SCRIPT'); return appsScriptAnswer ? appsScriptAnswer() : json({ error: 'not available' }, 500); }
    throw new Error('unexpected fetch ' + u);
  };
});
const secret = () => JSON.stringify({ client_email: account.email, private_key: pem });

test('the Sheet is read with a read-only Sheets sign-in, below the header row, keeping numbers and true/false', async () => {
  const rows = await loadCinema(secret());
  assert.equal(JSON.stringify(rows), newAnswer(SHEET.map(trim)));
  assert.deepEqual(tokenScopes, ['https://www.googleapis.com/auth/spreadsheets.readonly']);                      // no write access, no Drive access
  assert.equal(calls[0].path, `/v4/spreadsheets/${CINEMA_SHEET_ID}/values/${SHEET_NAME}!A2:M`);
  assert.equal(calls[0].query.valueRenderOption, 'UNFORMATTED_VALUE'); assert.equal(calls[0].auth, 'Bearer tok-1');
});

test('the sheet id is checked, Google errors are errors, and an empty range is an empty list', async () => {
  await assert.rejects(readCatalogRows('t', "x/../y"), /bad cinema sheet id/); await assert.rejects(readCatalogRows('t', ''), /bad cinema sheet id/);
  sheetStatus = 403; await assert.rejects(readCatalogRows('t'), /Sheets answered 403/);
  sheetStatus = 200; sheetRows = [];
  assert.deepEqual(await readCatalogRows('t'), []);
});

test('Drive and Sheets sign-ins are separate tokens with their own read-only scopes', async () => {
  assert.equal(await getAccessToken(account, Date.now(), DRIVE_SCOPE), 'tok-1');
  assert.equal(await getAccessToken(account, Date.now(), SHEETS_SCOPE), 'tok-2');
  assert.equal(await getAccessToken(account, Date.now(), DRIVE_SCOPE), 'tok-1');                                // each kept separately
  assert.deepEqual(tokenScopes, [DRIVE_SCOPE, SHEETS_SCOPE]);
  assert.ok(DRIVE_SCOPE.endsWith('drive.readonly') && SHEETS_SCOPE.endsWith('spreadsheets.readonly'));
});

// ---------------------------------------------------------------- the feed
const ctx = (env) => ({ request: new Request('https://www.nrnszn.com/api/feed/cinema'), env, waitUntil: () => {} });
const oldBackend = { feature: null, films: [{ row: 'Films', sub: 'Old', items: [{ title: 'From the old backend' }] }], shows: [] };

test('feed: with the secret set the catalog comes from the Sheet, marked source "sheet", and the old backend is not called', async () => {
  const res = await serveFeed('cinema', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }));
  assert.equal(res.status, 200); assert.equal(res.headers.get('x-feed-cache'), 'MISS');
  const d = await res.json();
  assert.equal(d.source, 'sheet'); const { source, ...rest } = d;
  assert.equal(JSON.stringify(rest), oldAnswer(SHEET));                                                       // identical to what the old backend would say
  assert.ok(!calls.includes('APPS-SCRIPT'));
  assert.equal((await serveFeed('cinema', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).headers.get('x-feed-cache'), 'HIT');
});

test('feed: a different Sheet can be set with CINEMA_SHEET_ID', async () => {
  await serveFeed('cinema', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret(), CINEMA_SHEET_ID: 'otherSheetId1234567890' }));
  assert.ok(calls[0].path.includes('/spreadsheets/otherSheetId1234567890/'));
});

test('feed: with no secret the old Apps Script answers exactly as before', async () => {
  appsScriptAnswer = () => json(oldBackend);
  const d = await (await serveFeed('cinema', ctx({}))).json();
  assert.equal(d.films[0].items[0].title, 'From the old backend'); assert.equal(d.source, undefined); assert.equal(tokenScopes.length, 0);
});

test('feed: if the Sheet fails or is empty the old backend answers; if both fail nothing is cached', async () => {
  appsScriptAnswer = () => json(oldBackend);
  sheetRows = [];                                                                                             // an empty sheet
  assert.equal((await (await serveFeed('cinema', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).json()).films[0].sub, 'Old');
  store.clear(); sheetRows = SHEET.map(trim); sheetStatus = 403;                                              // Google refuses (sheet not shared yet)
  assert.equal((await (await serveFeed('cinema', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).json()).films[0].sub, 'Old');
  store.clear(); appsScriptAnswer = () => json({ error: 'quota' }, 500);
  const down = await serveFeed('cinema', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }));
  assert.equal(down.status, 502); assert.equal(store.size, 0);
  assert.equal((await serveFeed('cinema', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: 'not json' }))).status, 502);   // a mistyped secret never breaks the page
});
