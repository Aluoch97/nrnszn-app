// public/feed-cache.js (the copy of a feed kept on the visitor's device) against a fake network and a fake Cache Storage: no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../public/feed-cache.js', import.meta.url), 'utf8');
let kept, net, calls, win;

function load() {
  win = {
    caches: {
      open: async () => ({
        match: async (p) => { const e = kept.get(p); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
        put: async (p, res) => { kept.set(p, { body: await res.text(), headers: Object.fromEntries(res.headers.entries()) }); },
      }),
    },
  };
  const sandbox = { window: win, caches: win.caches, fetch: async (url) => { calls.push(String(url)); return net(String(url)); }, Response, Date, JSON, Promise, Error, Number, String };
  vm.runInNewContext(code, sandbox);
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const keep = (path, data, ageMs) => kept.set(path, { body: JSON.stringify(data), headers: { 'content-type': 'application/json', 'x-kept-at': String(Date.now() - ageMs) } });
const settle = () => new Promise((r) => setTimeout(r, 20));
const valid = (d) => !!d && !d.error && Array.isArray(d.items) && d.items.length > 0;

beforeEach(() => { kept = new Map(); calls = []; net = () => json({ items: [1, 2, 3] }); load(); });

test('no copy yet: waits for the live feed, then keeps it for next time', async () => {
  const data = await win.nrnFeed('/api/feed/x', '', { valid });
  assert.deepEqual(data, { items: [1, 2, 3] }); await settle();
  assert.deepEqual(JSON.parse(kept.get('/api/feed/x').body), { items: [1, 2, 3] });
  assert.ok(Number(kept.get('/api/feed/x').headers['x-kept-at']) > 0, 'it remembers when it was kept');
});

test('a recent copy is returned AT ONCE (even if the network never answers), and the fresh one is saved in the background', async () => {
  keep('/api/feed/x', { items: ['old'] }, 5 * 60 * 1000);
  let release; net = () => new Promise((res) => { release = () => res(json({ items: ['new'] })); });
  const data = await win.nrnFeed('/api/feed/x', '', { valid });
  assert.deepEqual(data, { items: ['old'] }, 'the kept copy is on screen without waiting');
  release(); await settle();
  assert.deepEqual(JSON.parse(kept.get('/api/feed/x').body), { items: ['new'] }, 'the fresh copy replaces it for next time');
});

test('a copy older than the limit is not used: it waits for the live feed', async () => {
  keep('/api/feed/x', { items: ['old'] }, 2 * 3600 * 1000);
  assert.deepEqual(await win.nrnFeed('/api/feed/x', '', { valid }), { items: [1, 2, 3] });
  keep('/api/feed/y', { items: ['old'] }, 10 * 60 * 1000);
  assert.deepEqual(await win.nrnFeed('/api/feed/y', '', { valid, maxAge: 60 * 1000 }), { items: [1, 2, 3] }, 'the limit can be shorter per feed');
});

test('if the live feed fails, an older copy beats nothing; with no copy the error is passed on', async () => {
  net = () => { throw new Error('offline'); };
  keep('/api/feed/x', { items: ['old'] }, 5 * 3600 * 1000);
  assert.deepEqual(await win.nrnFeed('/api/feed/x', '', { valid }), { items: ['old'] });
  await assert.rejects(win.nrnFeed('/api/feed/none', '', { valid }));
});

test('an answer that is not a real one (an error page, an empty list) is never saved, and a bad kept copy is never shown', async () => {
  net = () => json({ error: 'Google is having a moment' });
  await win.nrnFeed('/api/feed/x', '', { valid }); await settle();
  assert.equal(kept.has('/api/feed/x'), false, 'an error answer is not kept');
  net = () => json({ items: [] }); await win.nrnFeed('/api/feed/e', '', { valid }); await settle();
  assert.equal(kept.has('/api/feed/e'), false, 'an empty list is not kept');
  keep('/api/feed/bad', { error: 'old error' }, 1000); net = () => json({ items: [9] });
  assert.deepEqual(await win.nrnFeed('/api/feed/bad', '', { valid }), { items: [9] }, 'a bad kept copy is ignored');
});

test('when the site feed fails, the direct address is used, as before', async () => {
  net = (url) => (url.startsWith('/api/') ? new Response('nope', { status: 502 }) : json({ items: ['direct'] }));
  assert.deepEqual(await win.nrnFeed('/api/feed/x', 'https://script.example/exec', { valid }), { items: ['direct'] });
  assert.deepEqual(calls, ['/api/feed/x', 'https://script.example/exec']);
});

test('no Cache Storage (private windows, old browsers): it simply loads live', async () => {
  win.caches = undefined; const sandbox = { window: win, fetch: async () => json({ items: [7] }), Response, Date, JSON, Promise, Error, Number, String };
  win.caches = undefined; vm.runInNewContext(code, sandbox);
  assert.deepEqual(await win.nrnFeed('/api/feed/x', '', { valid }), { items: [7] });
});
