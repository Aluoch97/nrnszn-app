// Unit tests for NuGallery read from Google Drive at the edge (src/edge/gallery.js and the `gallery` feed in feeds.js).
// Google is faked: a token endpoint that VERIFIES the service-account signature with the real public key, and a Drive that
// answers file queries from a small folder tree. The rules mirror apps-script/gallery/Code.gs.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseServiceAccount, signJwt, getAccessToken, forgetToken, buildGallery, loadGallery, cleanFolderName, seasonYearSortKey, toInstagramUrl,
  parseCredit, formatDate, pickCoverUrl, GALLERY_ROOT_FOLDER_ID, DEFAULT_CREDIT, DEFAULT_CREDIT_URL,
} from '../src/edge/gallery.js';
import { serveFeed } from '../src/edge/feeds.js';

let account, publicKey, pem;
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = pair.publicKey;
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  account = { email: 'gallery@nrn.iam.gserviceaccount.com', key: pem };
});

// ---------------------------------------------------------------- the fake Google
const T = (iso) => iso;
let files, calls, tokenCalls, pageSize, store, appsScriptAnswer;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4), 'base64');

async function fakeToken(init) {
  tokenCalls++;
  const form = new URLSearchParams(String(init.body));
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, c, s] = form.get('assertion').split('.');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64(s), new TextEncoder().encode(`${h}.${c}`));
  if (!ok) return json({ error: 'invalid_grant' }, 400);
  const claims = JSON.parse(b64(c).toString());
  assert.equal(JSON.parse(b64(h).toString()).alg, 'RS256');
  assert.equal(claims.iss, account.email); assert.equal(claims.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token'); assert.ok(claims.exp - claims.iat <= 3600);
  return json({ access_token: 'tok-' + tokenCalls, expires_in: 3600, token_type: 'Bearer' });
}

function fakeDrive(url, init) {
  calls.push(url.searchParams.get('q'));
  if (init.headers?.authorization !== `Bearer tok-${tokenCalls}`) return json({ error: 'unauthorized' }, 401);
  const q = url.searchParams.get('q');
  const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((m) => m[1]);
  let list = files.filter((f) => f.parents.some((p) => parents.includes(p)));
  if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) list = list.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  if (q.includes("mimeType contains 'image/'")) list = list.filter((f) => f.mimeType.startsWith('image/'));
  if (q.includes('trashed = false')) list = list.filter((f) => !f.trashed);
  if (url.searchParams.get('orderBy') === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const start = Number(url.searchParams.get('pageToken') || 0);
  const page = list.slice(start, start + pageSize);
  return json({ files: page, ...(start + pageSize < list.length ? { nextPageToken: String(start + pageSize) } : {}) });
}

beforeEach(() => {
  forgetToken(); calls = []; tokenCalls = 0; pageSize = 1000; store = new Map(); appsScriptAnswer = null;
  files = buildTree();
  globalThis.caches = { default: {
    match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; },
    put: async (req, res) => { store.set(req.url, res.clone()); },
  } };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') return fakeToken(init);
    if (u.hostname === 'www.googleapis.com' && u.pathname === '/drive/v3/files') return fakeDrive(u, init);
    if (u.hostname === 'script.google.com') { calls.push('APPS-SCRIPT'); return appsScriptAnswer ? appsScriptAnswer() : json({ error: 'not available' }, 500); }
    throw new Error('unexpected fetch ' + u);
  };
});

// ---------------------------------------------------------------- the fixture tree
const ROOT = GALLERY_ROOT_FOLDER_ID;
let n = 0;
const folder = (id, name, parent, description = '') => ({ id, name, description, mimeType: 'application/vnd.google-apps.folder', parents: [parent], trashed: false });
const photo = (parent, name, createdTime, extra = {}) => ({ id: `ph${String(++n).padStart(10, '0')}`, name, createdTime: T(createdTime), mimeType: 'image/jpeg', parents: [parent], trashed: false, ...extra });
function buildTree() {
  n = 0;
  return [
    folder('catEventsxxxx', 'Events', ROOT), folder('catInterviews', '2 Interviews', ROOT), folder('catCertified', 'Renaissance Certified', ROOT), folder('catEmptyxxxx', 'Empty Category', ROOT),
    folder('doorPlaylist1', 'The Playlist', 'catEventsxxxx'),
    folder('doorArtDark11', 'Art After Dark', 'catEventsxxxx', 'Shot by Jane Doe | @janedoe | https://youtu.be/xxxxxxxxxxx'),
    folder('doorFirstShot', '1 First Shoot', 'catEventsxxxx'),
    folder('doorNoPhotos1', 'No Photos', 'catEventsxxxx'),
    folder('doorStreets11', 'She 4 The Streets', 'catInterviews', 'Shot by Max | | https://youtu.be/yyyyyyyyyyy'),
    folder('doorCertSp24x', 'Spring 2024', 'catCertified'), folder('doorCertFa25x', 'Fall 2025', 'catCertified'), folder('doorCertFa24x', 'Fall 2024', 'catCertified', 'Shot by Sam | https://instagram.com/sam'),
    folder('doorCertSp25x', 'Spring 2025', 'catCertified'), folder('doorCertMisc', 'Misc', 'catCertified'),
    folder('doorEmptyCat1', 'Orphan', 'catEmptyxxxx'),
    // Events
    photo('doorPlaylist1', 'a.jpg', '2025-01-10T12:00:00Z'), photo('doorPlaylist1', 'b.jpg', '2025-03-01T03:30:00Z'), photo('doorPlaylist1', 'c.png', '2025-02-01T12:00:00Z', { mimeType: 'image/png' }),
    photo('doorPlaylist1', 'notes.pdf', '2025-04-01T12:00:00Z', { mimeType: 'application/pdf' }),                       // not an image
    photo('doorPlaylist1', 'deleted.jpg', '2025-05-01T12:00:00Z', { trashed: true }),                                   // in the bin
    photo('doorArtDark11', 'x1.jpg', '2024-06-01T12:00:00Z'), photo('doorArtDark11', 'cover_best.jpg', '2024-01-01T12:00:00Z'), photo('doorArtDark11', 'x3.jpg', '2024-07-01T12:00:00Z'),
    photo('doorFirstShot', 'f1.jpg', '2023-01-01T12:00:00Z'),
    photo('doorStreets11', 's1.jpg', '2024-02-02T12:00:00Z'),
    photo('doorCertSp24x', 'c1.jpg', '2024-03-01T12:00:00Z'), photo('doorCertFa25x', 'c2.jpg', '2025-09-01T12:00:00Z'), photo('doorCertFa24x', 'c3.jpg', '2024-09-01T12:00:00Z'),
    photo('doorCertSp25x', 'c4.jpg', '2025-03-01T12:00:00Z'), photo('doorCertMisc', 'c5.jpg', '2022-03-01T12:00:00Z'),
  ];                                                                                                                  // ("Empty Category" has a door with no photos: it must not show)
}
const byTitle = (cat, title) => cat.doors.find((d) => d.title === title);

// ---------------------------------------------------------------- signing in
test('the secret may be pasted as JSON, with real line breaks in the key, or with missing parts', () => {
  const asJson = JSON.stringify({ client_email: account.email, private_key: pem, type: 'service_account' });
  assert.deepEqual(parseServiceAccount(asJson), { email: account.email, key: pem.trim() });
  assert.deepEqual(parseServiceAccount('  ' + asJson + '\n'), { email: account.email, key: pem.trim() });
  const pasted = `{\n "type": "service_account",\n "private_key": "${pem}",\n "client_email": "${account.email}"\n}`;      // newlines pasted literally: not valid JSON
  assert.deepEqual(parseServiceAccount(pasted), { email: account.email, key: pem.trim() });
  assert.throws(() => parseServiceAccount(''), /missing client_email/);
  assert.throws(() => parseServiceAccount('{"client_email":"a@b.c"}'), /missing client_email or private_key/);
  assert.throws(() => parseServiceAccount('{"private_key":"-----BEGIN PRIVATE KEY-----\\nabc"}'), /missing client_email/);
  assert.throws(() => parseServiceAccount(undefined), /missing/);
});

test('the sign-in token is signed with the account key and holds only a read-only Drive scope', async () => {
  const jwt = await signJwt(account, 1_700_000_000);
  const [h, c, s] = jwt.split('.');
  assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64(s), new TextEncoder().encode(`${h}.${c}`)));
  assert.deepEqual(JSON.parse(b64(c).toString()), { iss: account.email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: 1_700_000_000, exp: 1_700_003_600 });
  assert.ok(!/[+/=]/.test(jwt));                                                                                         // url-safe, no padding
  await assert.rejects(signJwt({ email: 'x@y.z', key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }, 1));
});

test('the access token is kept for about 55 minutes, then renewed; failures are errors', async () => {
  const t0 = Date.now();
  assert.equal(await getAccessToken(account, t0), 'tok-1');
  assert.equal(await getAccessToken(account, t0 + 50 * 60e3), 'tok-1');
  assert.equal(tokenCalls, 1);
  assert.equal(await getAccessToken(account, t0 + 56 * 60e3), 'tok-2');
  forgetToken(); tokenCalls = 0;
  const other = { ...account, key: pem.replace(/A/g, 'B') };
  await assert.rejects(getAccessToken(other), Error);                                                                    // a damaged key never gets a token
  const orig = globalThis.fetch;
  globalThis.fetch = async () => json({ error: 'nope' }, 400);
  await assert.rejects(getAccessToken(account), /answered 400/);
  globalThis.fetch = async () => json({});
  await assert.rejects(getAccessToken(account), /no access token/);
  globalThis.fetch = orig;
});

// ---------------------------------------------------------------- the small rules
test('folder names, season order, Instagram links and credits follow the old rules', () => {
  assert.equal(cleanFolderName('1 The Playlist'), 'The Playlist'); assert.equal(cleanFolderName('01 - Art After Dark'), 'Art After Dark'); assert.equal(cleanFolderName('2024 Wrap'), 'Wrap');                                                                  // any leading number goes, as in the old script
  assert.equal(cleanFolderName('Events'), 'Events');
  assert.ok(seasonYearSortKey('Fall 2025') > seasonYearSortKey('Summer 2025') && seasonYearSortKey('Summer 2025') > seasonYearSortKey('Spring 2025') && seasonYearSortKey('Spring 2025') > seasonYearSortKey('Winter 2025'));
  assert.ok(seasonYearSortKey('Winter 2026') > seasonYearSortKey('Fall 2025')); assert.equal(seasonYearSortKey('Misc'), 0); assert.ok(seasonYearSortKey('spring 2024') > 0);
  assert.equal(toInstagramUrl('@janedoe'), 'https://instagram.com/janedoe'); assert.equal(toInstagramUrl('jane'), 'https://instagram.com/jane');
  assert.equal(toInstagramUrl('https://instagram.com/x'), 'https://instagram.com/x'); assert.equal(toInstagramUrl(''), '');
  assert.deepEqual(parseCredit('', false), { credit: DEFAULT_CREDIT, igUrl: DEFAULT_CREDIT_URL, videoUrl: '' });
  assert.deepEqual(parseCredit(undefined, false), { credit: DEFAULT_CREDIT, igUrl: DEFAULT_CREDIT_URL, videoUrl: '' });
  assert.deepEqual(parseCredit('   ', true), { credit: '', igUrl: '', videoUrl: '' });                                    // Certified: blank stays blank
  assert.deepEqual(parseCredit('Shot by Jane Doe', false), { credit: 'Shot by Jane Doe', igUrl: '', videoUrl: '' });
  assert.deepEqual(parseCredit('Shot by Jane | @jane', false), { credit: 'Shot by Jane', igUrl: 'https://instagram.com/jane', videoUrl: '' });
  assert.deepEqual(parseCredit('Shot by Jane | | https://youtu.be/xxxxxxxxxxx', false), { credit: 'Shot by Jane', igUrl: '', videoUrl: 'https://youtu.be/xxxxxxxxxxx' });
  assert.deepEqual(parseCredit(' | @jane | https://youtu.be/xxxxxxxxxxx', false), { credit: DEFAULT_CREDIT, igUrl: 'https://instagram.com/jane', videoUrl: 'https://youtu.be/xxxxxxxxxxx' });
  assert.deepEqual(parseCredit(DEFAULT_CREDIT, false), { credit: DEFAULT_CREDIT, igUrl: DEFAULT_CREDIT_URL, videoUrl: '' });   // the default credit always links home
  assert.deepEqual(parseCredit(' | @jane', true), { credit: '', igUrl: 'https://instagram.com/jane', videoUrl: '' });
});

test('dates are shown in Nashville time and a cover file wins over the newest photo', () => {
  assert.equal(formatDate(Date.parse('2025-03-01T03:30:00Z')), '02/28/2025');                                           // 9:30 pm on the 28th in Nashville
  assert.equal(formatDate(Date.parse('2025-07-04T03:30:00Z')), '07/03/2025');                                           // daylight time
  assert.equal(formatDate(Date.parse('2025-03-01T12:00:00Z')), '03/01/2025');
  assert.equal(pickCoverUrl([{ name: 'new.jpg', thumbUrl: 'N' }, { name: 'Cover-best.jpg', thumbUrl: 'C' }]), 'C');
  assert.equal(pickCoverUrl([{ name: 'cover_x.jpg', thumbUrl: 'A' }, { name: 'cover_y.jpg', thumbUrl: 'B' }]), 'A');
  assert.equal(pickCoverUrl([{ name: 'recover.jpg', thumbUrl: 'N' }, { name: 'o.jpg', thumbUrl: 'O' }]), 'N');          // "cover" must be a prefix
  assert.equal(pickCoverUrl([]), null);
});

// ---------------------------------------------------------------- the whole gallery
test('categories, doors and photos come out in the same order and shape as the Apps Script', async () => {
  const g = await buildGallery('tok-x'.length ? await getAccessToken(account) : '');
  assert.deepEqual(g.categories.map((c) => [c.title, c.certified]), [['Interviews', false], ['Events', false], ['Renaissance Certified', true]]);   // sorted by real name ("2 Interviews" first); empty category dropped
  const events = g.categories[1];
  assert.deepEqual(events.doors.map((d) => d.title), ['First Shoot', 'Art After Dark', 'The Playlist']);                 // by folder name; "No Photos" dropped
  const cert = g.categories[2];
  assert.deepEqual(cert.doors.map((d) => d.title), ['Fall 2025', 'Spring 2025', 'Fall 2024', 'Spring 2024', 'Misc']);   // newest season first, no season last
  for (const c of g.categories) for (const d of c.doors) assert.deepEqual(Object.keys(d).sort(), ['cover', 'images', 'title', 'videoUrl']);   // no sort helpers leak
});

test('photos: newest first, images only, bin excluded, exact fields', async () => {
  const g = await buildGallery(await getAccessToken(account));
  const pl = byTitle(g.categories[1], 'The Playlist');
  assert.deepEqual(pl.images.map((i) => i.name), ['b.jpg', 'c.png', 'a.jpg']);                                           // pdf and trashed photo left out
  const b = pl.images[0];
  assert.deepEqual(b, { id: b.id, name: 'b.jpg', dateSort: Date.parse('2025-03-01T03:30:00Z'), date: '02/28/2025', credit: DEFAULT_CREDIT, igUrl: DEFAULT_CREDIT_URL,
    thumbUrl: `https://drive.google.com/thumbnail?id=${b.id}&sz=w500`, fullUrl: `https://drive.google.com/thumbnail?id=${b.id}&sz=w1600`, downloadUrl: `https://drive.google.com/uc?export=download&id=${b.id}` });
  assert.equal(pl.cover, b.thumbUrl);                                                                                    // no cover_ file: the newest photo
  const art = byTitle(g.categories[1], 'Art After Dark');
  assert.equal(art.cover, art.images.find((i) => i.name === 'cover_best.jpg').thumbUrl);                                 // the cover_ file, though it is the oldest
  assert.deepEqual(art.images.map((i) => i.name), ['x3.jpg', 'x1.jpg', 'cover_best.jpg']);                               // ...and still sits in its normal place in the room
});

test('credits, Instagram and recap video come from each door folder\'s description', async () => {
  const g = await buildGallery(await getAccessToken(account));
  const art = byTitle(g.categories[1], 'Art After Dark');
  assert.equal(art.videoUrl, 'https://youtu.be/xxxxxxxxxxx'); assert.ok(art.images.every((i) => i.credit === 'Shot by Jane Doe' && i.igUrl === 'https://instagram.com/janedoe'));
  assert.equal(byTitle(g.categories[0], 'She 4 The Streets').videoUrl, 'https://youtu.be/yyyyyyyyyyy');
  assert.equal(byTitle(g.categories[1], 'The Playlist').videoUrl, '');
  const cert = g.categories[2];
  assert.equal(byTitle(cert, 'Fall 2024').images[0].credit, 'Shot by Sam'); assert.equal(byTitle(cert, 'Fall 2024').images[0].igUrl, 'https://instagram.com/sam');
  assert.equal(byTitle(cert, 'Fall 2025').images[0].credit, '');                                                         // blank stays blank in Certified
});

test('many photos across Drive pages and many doors across several requests', async () => {
  pageSize = 3;
  for (let i = 0; i < 10; i++) files.push(photo('doorFirstShot', `p${i}.jpg`, `2023-02-0${(i % 9) + 1}T12:00:00Z`));
  for (let i = 0; i < 60; i++) { files.push(folder(`doorBulk${String(i).padStart(4, '0')}x`, `Bulk ${String(i).padStart(2, '0')}`, 'catEventsxxxx')); files.push(photo(`doorBulk${String(i).padStart(4, '0')}x`, 'one.jpg', '2021-01-01T12:00:00Z')); }
  const g = await buildGallery(await getAccessToken(account));
  assert.equal(byTitle(g.categories[1], 'First Shoot').images.length, 11);                                              // read across several pages
  assert.equal(g.categories[1].doors.length, 3 + 60);
  const photoQueries = calls.filter((q) => /mimeType contains 'image\//.test(q));
  assert.ok(photoQueries.every((q) => (q.match(/in parents/g) || []).length <= 25));                                    // never more than 25 doors per request
  const doorsInEvents = photoQueries.filter((q) => q.includes("'doorPlaylist1'") || q.includes("'doorBulk0000x'"));
  assert.ok(doorsInEvents.length >= 3);
});

test('an unusable gallery folder id is refused before anything is sent to Drive', async () => {
  await assert.rejects(buildGallery('tok', "x' or 'a' in parents"), /bad gallery root/);
  await assert.rejects(buildGallery('tok', ''), /bad gallery root/);
  assert.equal(calls.length, 0);
});

test('a Drive error is an error (so the old copy keeps being served), not an empty gallery', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('/drive/v3/files') ? json({ error: { message: 'rate limit' } }, 403) : orig(url, init));
  await assert.rejects(loadGallery(JSON.stringify({ client_email: account.email, private_key: pem })), /Drive answered 403/);
  globalThis.fetch = orig;
});

// ---------------------------------------------------------------- the feed
const ctx = (env) => ({ request: new Request('https://www.nrnszn.com/api/feed/gallery'), env, waitUntil: () => {} });
const secret = () => JSON.stringify({ client_email: account.email, private_key: pem });
const appsScriptGallery = { categories: [{ title: 'Old', certified: false, doors: [{ title: 'D', cover: null, videoUrl: '', images: [{ id: 'abcdefghij1', thumbUrl: 'https://drive.google.com/thumbnail?id=abcdefghij1&sz=w500', fullUrl: 'https://drive.google.com/thumbnail?id=abcdefghij1&sz=w1600' }] }] }] };

test('feed: with the secret set, the gallery comes from Drive, photo links go through /api/drive, and the old backend is not used', async () => {
  const res = await serveFeed('gallery', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }));
  assert.equal(res.status, 200); assert.equal(res.headers.get('x-feed-cache'), 'MISS');
  const d = await res.json();
  assert.equal(d.source, 'drive');
  assert.deepEqual(d.categories.map((c) => c.title), ['Interviews', 'Events', 'Renaissance Certified']);
  const im = d.categories[1].doors[0].images[0];
  assert.match(im.thumbUrl, /^\/api\/drive\?id=ph\d{10}&sz=w500$/); assert.match(im.fullUrl, /^\/api\/drive\?id=ph\d{10}&sz=w1600$/);
  assert.match(im.downloadUrl, /^https:\/\/drive\.google\.com\/uc\?export=download/);                                      // downloads still go straight to Drive
  assert.ok(!calls.includes('APPS-SCRIPT'));
  assert.equal((await serveFeed('gallery', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).headers.get('x-feed-cache'), 'HIT');
});

test('feed: a different root folder can be set with GALLERY_ROOT_FOLDER_ID', async () => {
  files.push(folder('catOtherrrrrr', 'Other Wing', 'otherRoot12345'), folder('doorOtherrrrr', 'Other Door', 'catOtherrrrrr'), photo('doorOtherrrrr', 'z.jpg', '2025-01-01T12:00:00Z'));
  const d = await (await serveFeed('gallery', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret(), GALLERY_ROOT_FOLDER_ID: 'otherRoot12345' }))).json();
  assert.deepEqual(d.categories.map((c) => c.title), ['Other Wing']);
});

test('feed: with no secret, the old Apps Script answers exactly as before', async () => {
  appsScriptAnswer = () => json(appsScriptGallery);
  const d = await (await serveFeed('gallery', ctx({}))).json();
  assert.equal(d.source, undefined); assert.equal(d.categories[0].title, 'Old'); assert.match(d.categories[0].doors[0].images[0].thumbUrl, /^\/api\/drive\?id=abcdefghij1/);
  assert.equal(tokenCalls, 0);
});

test('feed: if Drive fails or is empty, the old backend still answers; if both fail nothing is cached', async () => {
  appsScriptAnswer = () => json(appsScriptGallery);
  files = files.filter((f) => f.parents[0] !== ROOT);                                                                    // Drive shows an empty gallery
  assert.equal((await (await serveFeed('gallery', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).json()).categories[0].title, 'Old');
  store.clear(); forgetToken();
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('oauth2.googleapis.com') ? json({ error: 'bad' }, 400) : orig(url, init));    // sign-in refused
  assert.equal((await (await serveFeed('gallery', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }))).json()).categories[0].title, 'Old');
  store.clear();
  appsScriptAnswer = () => json({ error: 'quota' }, 500);
  const down = await serveFeed('gallery', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: secret() }));
  assert.equal(down.status, 502); assert.equal(store.size, 0);
  const junk = await serveFeed('gallery', ctx({ GOOGLE_SERVICE_ACCOUNT_JSON: 'not json at all' }));                         // a mistyped secret falls back instead of breaking the page
  assert.equal(junk.status, 502);
  globalThis.fetch = orig;
});
