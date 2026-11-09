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
