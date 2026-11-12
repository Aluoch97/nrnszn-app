// Unit tests for the "latest videos" feed read from YouTube at the edge (src/edge/latest.js and the `latest` feed in feeds.js),
// with Cloudflare's cache and YouTube/Google faked. Mirrors the rules of the old Apps Script API (apps-script/Code.gs).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pickNewest, newestInPlaylist, loadLatestVideos, cleanKey } from '../src/edge/latest.js';
import { serveFeed, FRESH_SECS } from '../src/edge/feeds.js';
import { playlists } from '../src/data/portal.js';

const INTERVIEW = playlists.interview.id, MUSIC = playlists.music.id;
const item = (id, at, over = {}) => ({ snippet: { title: 'Title ' + id }, contentDetails: { videoId: id, videoPublishedAt: at }, status: { privacyStatus: 'public' }, ...over });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

let store, calls, upstream, waits;
beforeEach(() => {
  store = new Map(); calls = []; waits = [];
  globalThis.caches = { default: {
    match: async (req) => { const r = store.get(req.url); return r ? r.clone() : undefined; },
    put: async (req, res) => { store.set(req.url, res.clone()); },
  } };
  globalThis.fetch = async (url) => { calls.push(String(url)); return upstream(new URL(String(url))); };
});
const ctx = (env) => ({ request: new Request('https://www.nrnszn.com/api/feed/latest'), env, waitUntil: (p) => waits.push(p) });
const youtube = (byList) => (u) => {
  if (u.hostname === 'www.googleapis.com') {
    const pages = byList[u.searchParams.get('playlistId')];
    if (!pages) return json({ error: 'no such playlist' }, 404);
    return json(pages[Number(u.searchParams.get('pageToken') || 0)] ?? { items: [] });
  }
  throw new Error('unexpected fetch: ' + u);
};

test('the newest PUBLIC video by publish date wins, wherever it sits in the playlist', () => {
  const items = [
    item('aaaaaaaaaaa', '2024-01-01T00:00:00Z'),
    item('bbbbbbbbbbb', '2025-06-01T00:00:00Z'),
    item('ccccccccccc', '2025-07-01T00:00:00Z', { status: { privacyStatus: 'private' } }),       // newer but private
    item('ddddddddddd', '2025-08-01T00:00:00Z', { status: { privacyStatus: 'unlisted' } }),
    { snippet: { title: 'Deleted video' }, contentDetails: { videoId: 'eeeeeeeeeee' }, status: { privacyStatus: 'public' } },   // no publish date: deleted or unavailable
    item('fffffffffff', '2023-12-31T00:00:00Z'),
  ];
  assert.deepEqual(pickNewest(items), { id: 'bbbbbbbbbbb', title: 'Title bbbbbbbbbbb', publishedAt: '2025-06-01T00:00:00Z' });
});

test('an empty, all-private or malformed playlist gives null, never a crash', () => {
  assert.equal(pickNewest([]), null);
  assert.equal(pickNewest(undefined), null);
  assert.equal(pickNewest([item('aaaaaaaaaaa', '2024-01-01T00:00:00Z', { status: { privacyStatus: 'private' } })]), null);
  assert.equal(pickNewest([{}, null, { contentDetails: {} }].filter(Boolean)), null);
  assert.equal(pickNewest([{ contentDetails: { videoId: 'aaaaaaaaaaa', videoPublishedAt: '2024-01-01T00:00:00Z' } }]), null);         // no status: not shown
  assert.equal(pickNewest([{ contentDetails: { videoId: 'aaaaaaaaaaa', videoPublishedAt: '2024-01-01T00:00:00Z' }, status: { privacyStatus: 'public' } }]).title, '');
});

test('it follows YouTube\'s pages and asks for the right parts', async () => {
  upstream = youtube({ [INTERVIEW]: { 0: { items: [item('aaaaaaaaaaa', '2024-01-01T00:00:00Z')], nextPageToken: '1' }, 1: { items: [item('bbbbbbbbbbb', '2025-01-01T00:00:00Z')] } } });
  const v = await newestInPlaylist(INTERVIEW, 'KEY');
  assert.equal(v.id, 'bbbbbbbbbbb');                                                           // found on the second page
  assert.equal(calls.length, 2);
  const u = new URL(calls[0]);
  assert.equal(u.searchParams.get('part'), 'snippet,contentDetails,status'); assert.equal(u.searchParams.get('maxResults'), '50');
  assert.equal(u.searchParams.get('key'), 'KEY'); assert.equal(u.searchParams.get('pageToken'), null);
  assert.equal(new URL(calls[1]).searchParams.get('pageToken'), '1');
});

test('it stops after about 500 items instead of paging forever', async () => {
  const page = (n) => ({ items: Array.from({ length: 50 }, (_, i) => item('v' + String(n * 50 + i).padStart(10, '0'), '2024-01-01T00:00:00Z')), nextPageToken: String(n + 1) });
  upstream = (u) => json(page(Number(u.searchParams.get('pageToken') || 0)));
  await newestInPlaylist(INTERVIEW, 'KEY');
  assert.equal(calls.length, 10);                                                              // 10 pages x 50 = 500
});

test('a YouTube error is an error (so nothing is cached), not an empty answer', async () => {
  upstream = () => json({ error: { message: 'quota' } }, 403);
  await assert.rejects(newestInPlaylist(INTERVIEW, 'KEY'), /YouTube answered 403/);
  await assert.rejects(loadLatestVideos('KEY'), /YouTube answered 403/);
});

test('loadLatestVideos gives the same shape the old API did, and tolerates one empty playlist', async () => {
  upstream = youtube({ [INTERVIEW]: { 0: { items: [item('aaaaaaaaaaa', '2025-02-02T00:00:00Z')] } }, [MUSIC]: { 0: { items: [] } } });
  assert.deepEqual(await loadLatestVideos('KEY'), { ok: true, interview: { id: 'aaaaaaaaaaa', title: 'Title aaaaaaaaaaa', publishedAt: '2025-02-02T00:00:00Z' }, music: null });
  upstream = youtube({ [INTERVIEW]: { 0: { items: [] } }, [MUSIC]: { 0: { items: [] } } });
  await assert.rejects(loadLatestVideos('KEY'), /without any public videos/);                  // both empty: not an answer worth keeping
});

test('pasted keys are cleaned of spaces, line breaks and quotes', () => {
  assert.equal(cleanKey('  "abc123"\n'), 'abc123'); assert.equal(cleanKey("'abc'"), 'abc'); assert.equal(cleanKey(undefined), ''); assert.equal(cleanKey(null), '');
});

const both = { [INTERVIEW]: { 0: { items: [item('aaaaaaaaaaa', '2025-02-02T00:00:00Z')] } }, [MUSIC]: { 0: { items: [item('bbbbbbbbbbb', '2025-03-03T00:00:00Z')] } } };

test('feed: with the YouTube key set, the answer comes from YouTube and the old API is never called', async () => {
  upstream = (u) => { if (u.hostname === 'script.google.com') throw new Error('the old API must not be called'); return youtube(both)(u); };
  const res = await serveFeed('latest', ctx({ YOUTUBE_API_KEY: ' "KEY" ', PUBLIC_API_URL: 'https://script.google.com/macros/s/X/exec' }));
  assert.equal(res.status, 200); assert.equal(res.headers.get('x-feed-cache'), 'MISS');
  const d = await res.json();
  assert.equal(d.ok, true); assert.equal(d.interview.id, 'aaaaaaaaaaa'); assert.equal(d.music.id, 'bbbbbbbbbbb');
  assert.ok(calls.every((c) => c.startsWith('https://www.googleapis.com/')));
  assert.equal(new URL(calls[0]).searchParams.get('key'), 'KEY');
});

test('feed: a second visit is served from the copy without asking YouTube again, and refreshes quietly when old', async () => {
  upstream = youtube(both);
  const env = { YOUTUBE_API_KEY: 'KEY' }, t0 = Date.now();
  await serveFeed('latest', ctx(env), t0);
  const n = calls.length;
  assert.equal((await serveFeed('latest', ctx(env), t0 + 1000)).headers.get('x-feed-cache'), 'HIT');
  assert.equal(calls.length, n);
  const c = ctx(env);
  assert.equal((await serveFeed('latest', c, t0 + (FRESH_SECS + 5) * 1000)).headers.get('x-feed-cache'), 'STALE');
  await Promise.all(waits);
  assert.ok(calls.length > n);
});

test('feed: with no key it keeps using the old Apps Script API, exactly as before', async () => {
  upstream = (u) => { assert.equal(u.hostname, 'script.google.com'); assert.equal(u.searchParams.get('action'), 'latestVideos'); return json({ ok: true, interview: { id: 'old' }, music: null }); };
  const res = await serveFeed('latest', ctx({ PUBLIC_API_URL: 'https://script.google.com/macros/s/X/exec' }));
  assert.equal((await res.json()).interview.id, 'old'); assert.equal(calls.length, 1);
});

test('feed: if YouTube fails, the old API still answers; if that is not set either, the feed reports unavailable and caches nothing', async () => {
  upstream = (u) => (u.hostname === 'script.google.com' ? json({ ok: true, interview: { id: 'old' }, music: null }) : json({ error: 'quota' }, 403));
  const a = await serveFeed('latest', ctx({ YOUTUBE_API_KEY: 'KEY', PUBLIC_API_URL: 'https://script.google.com/macros/s/X/exec' }));
  assert.equal((await a.json()).interview.id, 'old');
  store.clear();
  upstream = () => json({ error: 'quota' }, 403);
  const b = await serveFeed('latest', ctx({ YOUTUBE_API_KEY: 'KEY' }));
  assert.equal(b.status, 502); assert.equal(store.size, 0);
  const c = await serveFeed('latest', ctx({}));                                                // nothing configured at all
  assert.equal(c.status, 502); assert.equal(store.size, 0);
});

test('feed: the old API answering with an error page is never cached', async () => {
  upstream = () => json({ ok: false, error: 'Server error' });
  const res = await serveFeed('latest', ctx({ PUBLIC_API_URL: 'https://script.google.com/macros/s/X/exec' }));
  assert.equal(res.status, 502); assert.equal(store.size, 0);
});
