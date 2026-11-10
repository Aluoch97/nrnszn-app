// Unit tests for the Cloudflare feed cache (src/edge/feeds.js), with Cloudflare's cache and Google faked.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { serveFeed, serveDrive, viaDrive, FRESH_SECS, KEEP_SECS } from '../src/edge/feeds.js';

let store, upstream, calls, waits;
beforeEach(() => {
  store = new Map(); calls = 0; waits = [];
  globalThis.caches = { default: {
    match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; },
    put: async (req, res) => { store.set(req.url, res.clone()); },
  } };
  globalThis.fetch = async (url) => { calls++; return upstream(String(url)); };
});
const ctx = () => ({ request: new Request('https://www.nrnszn.com/api/feed/x'), env: {}, waitUntil: (p) => waits.push(p) });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const gallery = { categories: [{ title: 'Events', doors: [{ images: [{ thumbUrl: 'https://drive.google.com/thumbnail?id=1bcUbtrzxElWNDzAbkW8KCBsbiiCas3-e&sz=w500', fullUrl: 'https://drive.google.com/thumbnail?id=1bcUbtrzxElWNDzAbkW8KCBsbiiCas3-e&sz=w1600' }] }] }] };

test('first visit fetches from Google and stores a copy; next visit is served from the copy', async () => {
  upstream = () => json({ services: [{ id: 'video' }] });
  const t0 = Date.now();
  const a = await serveFeed('services', ctx(), t0);
  assert.equal(a.headers.get('x-feed-cache'), 'MISS');
  const b = await serveFeed('services', ctx(), t0 + 1000);
  assert.equal(b.headers.get('x-feed-cache'), 'HIT');
  assert.deepEqual(await b.json(), { services: [{ id: 'video' }] });
  assert.equal(calls, 1);
});

test('an old copy is answered right away while a fresh one loads in the background', async () => {
  upstream = () => json({ services: [{ id: 'old' }] });
  const t0 = Date.now();
  await serveFeed('services', ctx(), t0);
  upstream = () => json({ services: [{ id: 'new' }] });
  const c = ctx();
  const res = await serveFeed('services', c, t0 + (FRESH_SECS + 5) * 1000);
  assert.equal(res.headers.get('x-feed-cache'), 'STALE');
  assert.deepEqual(await res.json(), { services: [{ id: 'old' }] });
  await Promise.all(waits);
  const after = await serveFeed('services', ctx(), t0 + (FRESH_SECS + 6) * 1000);
  assert.deepEqual(await after.json(), { services: [{ id: 'new' }] });
});

test('when Google fails, the last good copy keeps being served and the error is not stored', async () => {
  upstream = () => json({ films: [{ row: 'Films' }] });
  const t0 = Date.now();
  await serveFeed('cinema', ctx(), t0);
  upstream = () => new Response('<html>Service invoked too many times</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const res = await serveFeed('cinema', ctx(), t0 + 3600 * 1000);
  assert.equal(res.headers.get('x-feed-cache'), 'STALE');
  await Promise.all(waits.map((p) => p.catch(() => {})));
  assert.deepEqual(await (await serveFeed('cinema', ctx(), t0 + 3601 * 1000)).json(), { films: [{ row: 'Films' }] });
});

test('nothing cached and Google down: a clear 502, so the page falls back to Google directly', async () => {
  upstream = () => json({ error: 'boom' }, 500);
  const res = await serveFeed('gallery', ctx(), Date.now());
  assert.equal(res.status, 502);
  assert.equal(store.size, 0);
});

test('after a week without a successful refresh the copy is not used', async () => {
  upstream = () => json({ services: [{ id: 'video' }] });
  const t0 = Date.now();
  await serveFeed('services', ctx(), t0);
  upstream = () => json({}, 500);
  const res = await serveFeed('services', ctx(), t0 + (KEEP_SECS + 60) * 1000);
  assert.equal(res.status, 502);
});

test('gallery photo links are rewritten to the cached /api/drive route', async () => {
  upstream = () => json(structuredClone(gallery));
  const d = await (await serveFeed('gallery', ctx(), Date.now())).json();
  const im = d.categories[0].doors[0].images[0];
  assert.equal(im.thumbUrl, '/api/drive?id=1bcUbtrzxElWNDzAbkW8KCBsbiiCas3-e&sz=w500');
  assert.equal(im.fullUrl, '/api/drive?id=1bcUbtrzxElWNDzAbkW8KCBsbiiCas3-e&sz=w1600');
  assert.equal(viaDrive('https://www.instagram.com/x'), 'https://www.instagram.com/x');
});

test('unknown feeds and latest-videos without an API address are refused', async () => {
  assert.equal((await serveFeed('nope', ctx())).status, 404);
  upstream = () => json({ ok: true });
  assert.equal((await serveFeed('latest', ctx())).status, 502);
});

test('/api/drive only fetches Google Drive thumbnails, and only images', async () => {
  upstream = () => new Response('img', { headers: { 'content-type': 'image/jpeg' } });
  const ok = await serveDrive({ request: new Request('https://www.nrnszn.com/api/drive?id=1bcUbtrzxElWNDzAbkW8KCBsbiiCas3-e&sz=w500') });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('cache-control'), /max-age=2592000/);
  const bad = await serveDrive({ request: new Request('https://www.nrnszn.com/api/drive?id=../../etc&sz=w500') });
  assert.equal(bad.status, 400);
  upstream = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  const notImg = await serveDrive({ request: new Request('https://www.nrnszn.com/api/drive?id=1bcUbtrzxElWNDzAbkW8KCBsbiiCas3-e&sz=w500') });
  assert.equal(notImg.status, 404);
});

// ---------- YouTube playlist reader (src/edge/playlist.js) ----------
import { parsePlaylist, extractInitialData } from '../src/edge/playlist.js';

const lockup = (id, title, duration, parts) => ({ lockupViewModel: {
  contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
  contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: duration } }] } }] } },
  metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: parts.map((t) => ({ text: { content: t } })) }] } } } },
} });

test('playlist reader: current YouTube page format', () => {
  const data = { metadata: { playlistMetadataRenderer: { title: 'Certified Tour' } }, contents: { list: [
    lockup('akcFv16N6s8', 'SXSW - Live From Austin ', '15:02', ['NuRenaissance', '165', '1y ago']),
    lockup('x3V8pIsS-Jo', 'A Taste of Phoenix', '14:26', ['NuRenaissance', 'and Underground Music Collective', '133', '11mo ago']),
    { lockupViewModel: { contentId: 'PLabcdefghijk', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
  ] } };
  const r = parsePlaylist(data);
  assert.equal(r.title, 'Certified Tour');
  assert.deepEqual(r.videos, [
    { id: 'akcFv16N6s8', title: 'SXSW - Live From Austin', duration: '15:02', age: '1y ago' },
    { id: 'x3V8pIsS-Jo', title: 'A Taste of Phoenix', duration: '14:26', age: '11mo ago' },
  ]);
});

test('playlist reader: older format, and pages without data', () => {
  const r = parsePlaylist({ x: [{ playlistVideoRenderer: { videoId: 'KVPq322ZwwY', title: { runs: [{ text: 'Kansas City Blues' }] }, lengthText: { simpleText: '10:58' }, videoInfo: { runs: [{ text: '135 views' }, { text: ' • ' }, { text: '4 months ago' }] } } }] });
  assert.deepEqual(r.videos, [{ id: 'KVPq322ZwwY', title: 'Kansas City Blues', duration: '10:58', age: '4 months ago' }]);
  assert.throws(() => extractInitialData('<html>consent</html>'), /ytInitialData/);
  assert.equal(parsePlaylist({}).videos.length, 0);
});

// ---------- Playlist reader: YouTube Data API path ----------
import { loadPlaylist, loadPlaylistViaApi, formatDuration, timeAgo } from '../src/edge/playlist.js';
import { onRequestGet as playlistRoute } from '../functions/api/playlist.js';

const apiItem = (id, title, published, privacy = 'public') => ({
  snippet: { title, resourceId: { videoId: id } }, contentDetails: { videoId: id, videoPublishedAt: published }, status: { privacyStatus: privacy },
});
const fakeYoutube = (u) => {
  const url = new URL(u);
  if (url.hostname !== 'www.googleapis.com') throw new Error('unexpected ' + u);
  assert.equal(url.searchParams.get('key'), 'k123');
  if (url.pathname.endsWith('/playlists')) return json({ items: [{ snippet: { title: 'Certified Tour' } }] });
  if (url.pathname.endsWith('/playlistItems')) {
    return url.searchParams.get('pageToken') === 'P2'
      ? json({ items: [apiItem('x3V8pIsS-Jo', 'A Taste of Phoenix', '2025-12-01T00:00:00Z'), apiItem('dddddddddd1', 'Deleted video', '')] })
      : json({ items: [apiItem('akcFv16N6s8', 'SXSW - Live From Austin ', '2025-11-01T00:00:00Z'), apiItem('ppppppppppp', 'Secret', '2025-11-01T00:00:00Z', 'private')], nextPageToken: 'P2' });
  }
  if (url.pathname.endsWith('/videos')) {
    assert.equal(url.searchParams.get('id'), 'akcFv16N6s8,x3V8pIsS-Jo');
    return json({ items: [{ id: 'akcFv16N6s8', contentDetails: { duration: 'PT15M2S' } }, { id: 'x3V8pIsS-Jo', contentDetails: { duration: 'PT1H4M26S' } }] });
  }
  throw new Error('unexpected ' + u);
};

test('playlist API: same shape as the page reader, private and deleted videos left out', async () => {
  upstream = fakeYoutube;
  const r = await loadPlaylistViaApi('PLVprhlbgSo1vgKbKRq7c3tsY-Y1tl4D3X', 'k123', Date.parse('2026-11-10T00:00:00Z'));
  assert.equal(r.title, 'Certified Tour');
  assert.equal(r.source, 'api');
  assert.deepEqual(r.videos, [
    { id: 'akcFv16N6s8', title: 'SXSW - Live From Austin', duration: '15:02', age: '1 year ago' },
    { id: 'x3V8pIsS-Jo', title: 'A Taste of Phoenix', duration: '1:04:26', age: '11 months ago' },
  ]);
});

test('playlist: falls back to reading the page when the API fails, and without a key', async () => {
  const page = `<script>var ytInitialData = ${JSON.stringify({ metadata: { playlistMetadataRenderer: { title: 'From page' } }, x: [lockup('akcFv16N6s8', 'SXSW', '15:02', ['1y ago'])] })};</script>`;
  const hosts = [];
  upstream = (u) => {
    hosts.push(new URL(u).hostname);
    return new URL(u).hostname === 'www.googleapis.com' ? json({ error: { message: 'quota exceeded' } }, 403) : new Response(page);
  };
  const quiet = console.error; console.error = () => {};
  try {
    const fb = await loadPlaylist('PLVprhlbgSo1vgKbKRq7c3tsY-Y1tl4D3X', 'k123');
    assert.equal(fb.title, 'From page');
    assert.equal(fb.source, 'page');
    assert.ok(hosts.includes('www.googleapis.com') && hosts.includes('www.youtube.com'));
    hosts.length = 0;
    assert.equal((await loadPlaylist('PLVprhlbgSo1vgKbKRq7c3tsY-Y1tl4D3X', '')).title, 'From page');
    assert.deepEqual(hosts, ['www.youtube.com']);
  } finally { console.error = quiet; }
});

test('playlist route: uses the Cloudflare secret, keeps copies fresh for 30 minutes', async () => {
  upstream = fakeYoutube;
  const req = (t) => playlistRoute({ request: new Request('https://www.nrnszn.com/api/playlist?list=PLVprhlbgSo1vgKbKRq7c3tsY-Y1tl4D3X'), env: { YOUTUBE_API_KEY: 'k123' }, waitUntil: (p) => waits.push(p) });
  const a = await req();
  assert.equal(a.headers.get('x-feed-cache'), 'MISS');
  assert.equal(a.headers.get('access-control-allow-origin'), '*');
  assert.equal((await a.json()).videos.length, 2);
  const realNow = Date.now;
  Date.now = () => realNow() + 20 * 60 * 1000; // 20 minutes later: still fresh
  try { assert.equal((await req()).headers.get('x-feed-cache'), 'HIT'); } finally { Date.now = realNow; }
});

test('duration and age formatting', () => {
  assert.equal(formatDuration('PT45S'), '0:45');
  assert.equal(formatDuration('P0D'), '');
  assert.equal(timeAgo('2026-11-09T22:00:00Z', Date.parse('2026-11-10T00:00:00Z')), '2 hours ago');
  assert.equal(timeAgo('', 0), '');
});
