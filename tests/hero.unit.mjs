// Page videos (src/edge/hero.js): who may upload, what is accepted, the list pages read, and serving with Range (iPhones need it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroRequest } from '../src/edge/hero.js';
import { makeToken } from '../src/edge/admin.js';

function bucket() {
  const m = new Map();
  return {
    m,
    async put(k, v) { m.set(k, v instanceof Uint8Array ? v : new TextEncoder().encode(typeof v === 'string' ? v : String(v))); },
    async head(k) { return m.has(k) ? { size: m.get(k).length, httpEtag: '"e"' } : null; },
    async get(k, o) {
      if (!m.has(k)) return null;
      let b = m.get(k); if (o && o.range) b = b.slice(o.range.offset, o.range.offset + o.range.length);
      return { body: b, text: async () => new TextDecoder().decode(b) };
    },
    async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
    async delete(keys) { for (const k of [].concat(keys)) m.delete(k); },
  };
}
const ENV = () => ({ ADMIN_PASSWORD: 'a-long-admin-password', MEDIA: bucket() });
const mp4 = (n = 64) => { const b = new Uint8Array(n); b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0); for (let i = 8; i < n; i++) b[i] = i % 251; return b; };
const jpg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const call = (env, path, { method = 'GET', body, token, origin, headers = {} } = {}) => {
  const h = { ...headers }; if (token) h.authorization = `Bearer ${token}`; if (origin) h.origin = origin;
  if (body && !(body instanceof Uint8Array)) { h['content-type'] = 'application/json'; body = JSON.stringify(body); }
  return heroRequest({ request: new Request(`https://www.nrnszn.com${path}`, { method, headers: h, body }), env });
};

test('not set up: the pages get "off" and keep their pictures; uploads say how to set it up', async () => {
  const env = { ADMIN_PASSWORD: 'a-long-admin-password' }, t = await makeToken(env);
  assert.deepEqual(await (await call(env, '/api/hero')).json(), { on: false, videos: {} });
  assert.equal((await call(env, '/api/hero?page=home&v=abcdef12&part=large.mp4', { method: 'PUT', body: mp4(), token: t })).status, 503);
});

test('uploads need the admin token and this site; only real MP4 / JPEG files, known pages and parts, a size cap', async () => {
  const env = ENV(), t = await makeToken(env);
  assert.equal((await call(env, '/api/hero?page=home&v=abcdef12&part=large.mp4', { method: 'PUT', body: mp4() })).status, 401);
  assert.equal((await call(env, '/api/hero?page=home&v=abcdef12&part=large.mp4', { method: 'PUT', body: mp4(), token: 'nope' })).status, 401);
  assert.equal((await call(env, '/api/hero?page=home&v=abcdef12&part=large.mp4', { method: 'PUT', body: mp4(), token: t, origin: 'https://evil.example' })).status, 403);
  for (const q of ['page=nope&v=abcdef12&part=large.mp4', 'page=home&v=../x&part=large.mp4', 'page=home&v=abcdef12&part=x.html'])
    assert.equal((await call(env, `/api/hero?${q}`, { method: 'PUT', body: mp4(), token: t })).status, 400, q);
  assert.equal((await call(env, '/api/hero?page=home&v=abcdef12&part=large.mp4', { method: 'PUT', body: new TextEncoder().encode('<html>hello there</html>'), token: t })).status, 400, 'not an mp4');
  assert.equal((await call(env, '/api/hero?page=home&v=abcdef12&part=poster.jpg', { method: 'PUT', body: mp4(), token: t })).status, 400, 'not a jpeg');
  assert.equal((await call(env, '/api/hero?page=home&v=abcdef12&part=poster.jpg', { method: 'PUT', body: new Uint8Array(1_600_000).fill(0xff), token: t })).status, 413);
  assert.equal(env.MEDIA.m.size, 0, 'nothing was stored');
});

test('a full upload shows on its page; "set" refuses an incomplete one; changing deletes the old files; remove goes back to pictures', async () => {
  const env = ENV(), t = await makeToken(env);
  const up = (page, v) => Promise.all([['large.mp4', mp4(200)], ['small.mp4', mp4(100)], ['poster.jpg', jpg()]].map(([p, b]) => call(env, `/api/hero?page=${page}&v=${v}&part=${p}`, { method: 'PUT', body: b, token: t })));
  await call(env, '/api/hero?page=services&v=aaaaaa11&part=large.mp4', { method: 'PUT', body: mp4(), token: t });
  assert.equal((await call(env, '/api/hero', { method: 'POST', body: { action: 'set', page: 'services', v: 'aaaaaa11' }, token: t })).status, 400, 'small and poster missing');
  await up('services', 'aaaaaa11');
  assert.equal((await (await call(env, '/api/hero', { method: 'POST', body: { action: 'set', page: 'services', v: 'aaaaaa11' }, token: t })).json()).ok, true);
  const pub = await call(env, '/api/hero');
  assert.deepEqual((await pub.json()).videos, { services: 'aaaaaa11' }); assert.match(pub.headers.get('cache-control'), /max-age=60/);
  await up('services', 'bbbbbb22');
  await call(env, '/api/hero', { method: 'POST', body: { action: 'set', page: 'services', v: 'bbbbbb22' }, token: t });
  assert.equal([...env.MEDIA.m.keys()].some((k) => k.includes('aaaaaa11')), false, 'the old upload is deleted');
  assert.deepEqual(Object.keys((await (await call(env, '/api/hero', { method: 'POST', body: { action: 'list' }, token: t })).json()).videos), ['services']);
  await call(env, '/api/hero', { method: 'POST', body: { action: 'remove', page: 'services' }, token: t });
  assert.deepEqual((await (await call(env, '/api/hero')).json()).videos, {});
  assert.equal([...env.MEDIA.m.keys()].filter((k) => k.startsWith('hero/services/')).length, 0);
});

test('files are served to anyone, with Range for phones, and only real paths', async () => {
  const env = ENV(), t = await makeToken(env);
  await call(env, '/api/hero?page=media&v=cccccc33&part=large.mp4', { method: 'PUT', body: mp4(200), token: t });
  const f = '/api/hero?file=' + encodeURIComponent('media/cccccc33/large.mp4');
  const all = await call(env, f);
  assert.equal(all.status, 200); assert.equal(all.headers.get('content-type'), 'video/mp4'); assert.equal(all.headers.get('accept-ranges'), 'bytes'); assert.match(all.headers.get('cache-control'), /immutable/);
  assert.equal((await all.arrayBuffer()).byteLength, 200);
  const part = await call(env, f, { headers: { range: 'bytes=0-1' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 0-1/200'); assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [0, 0]);
  const tail = await call(env, f, { headers: { range: 'bytes=-10' } });
  assert.equal(tail.headers.get('content-range'), 'bytes 190-199/200');
  assert.equal((await call(env, f, { headers: { range: 'bytes=500-' } })).status, 416);
  for (const bad of ['media/cccccc33/../../manifest.json', 'hero/manifest.json', 'nope/cccccc33/large.mp4', 'media/cccccc33/large.html'])
    assert.equal((await call(env, '/api/hero?file=' + encodeURIComponent(bad))).status, 404, bad);
});
