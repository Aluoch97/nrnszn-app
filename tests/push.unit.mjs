// Phone notifications (src/edge/push.js, functions/api/push.js, the admin send): the message encryption (a pretend phone decrypts it), the signed token,
// who may subscribe, who may send, the daily limit, and phones that left. No network: a fake database and a fake push service.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fakeD1 } from './_d1.mjs';
import * as P from '../src/edge/push.js';
import { adminGet, adminPost, makeToken, forgetTries } from '../src/edge/admin.js';
import { onRequestGet as pushGet, onRequestPost as pushPost } from '../functions/api/push.js';

const { b64u } = P, te = new TextEncoder();
async function phone() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = webcrypto.getRandomValues(new Uint8Array(16)), pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey));
  const hk = async (salt, ikm, info, n) => new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
  return {
    sub: { p256dh: b64u.encode(pub), auth: b64u.encode(auth) },
    async decrypt(body) {
      body = new Uint8Array(body); const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
      assert.equal(rs, 4096); assert.equal(idlen, 65);
      const asPub = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
      const server = await webcrypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const ecdh = new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'ECDH', public: server }, keys.privateKey, 256));
      const prk = await hk(auth, ecdh, cat(te.encode('WebPush: info\0'), pub, asPub), 32);
      const cek = await hk(salt, prk, te.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(salt, prk, te.encode('Content-Encoding: nonce\0'), 12);
      const plain = new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await webcrypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
      assert.equal(plain[plain.length - 1], 2); return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}
async function vapidKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  return { VAPID_PUBLIC_KEY: b64u.encode(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))), VAPID_PRIVATE_KEY: (await webcrypto.subtle.exportKey('jwk', pair.privateKey)).d };
}
const A = 'A'.repeat(87), B = 'B'.repeat(22), PASSWORD = 'correct horse battery staple';
let pushed, statusOf, realFetch;
beforeEach(() => {
  forgetTries(); pushed = []; statusOf = {}; realFetch = realFetch || globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://push.test/')) { pushed.push({ url: u, headers: Object.fromEntries(new Headers(init.headers)), body: init.body }); return new Response(null, { status: statusOf[u] || 201 }); }
    return new Response('not found', { status: 404 });
  };
});
const world = async (keys = true) => ({ DB: fakeD1(), ADMIN_PASSWORD: PASSWORD, ...(keys ? await vapidKeys() : {}) });
const sub = (e, n, ip = '203.0.113.7', s = {}) => pushPost({ request: new Request('https://www.nrnszn.com/api/push', { method: 'POST', body: JSON.stringify({ action: 'subscribe', subscription: { endpoint: 'https://push.test/' + n + '-abcdefghijkl', p256dh: A, auth: B, ...s } }), headers: { 'cf-connecting-ip': ip } }), env: e }).then(async r => ({ status: r.status, ...(await r.json()) }));
const admin = async (e, action, extra = {}, token) => adminPost({ request: new Request('https://www.nrnszn.com/api/admin', { method: 'POST', body: JSON.stringify({ action, ...extra }), headers: token === null ? {} : { authorization: 'Bearer ' + (token || await makeToken(e)) } }), env: e }).then(async r => ({ status: r.status, ...(await r.json()) }));
const status = async (e, token) => (await adminGet({ request: new Request('https://www.nrnszn.com/api/admin?section=push', { headers: token === null ? {} : { authorization: 'Bearer ' + (token || await makeToken(e)) } }), env: e })).json();

test('the message is encrypted so only the phone can read it (accents and all); another phone cannot', async () => {
  const p = await phone(), body = await P.encryptPayload('{"title":"New show — Café ✓"}', p.sub);
  assert.equal(await p.decrypt(body), '{"title":"New show — Café ✓"}');
  assert.ok(!new TextDecoder().decode(body).includes('New show'));
  await assert.rejects((await phone()).decrypt(body));
  await assert.rejects(P.encryptPayload('x', { p256dh: 'AAAA', auth: p.sub.auth }), /bad p256dh/);
  await assert.rejects(P.encryptPayload('x', { p256dh: p.sub.p256dh, auth: 'AAAA' }), /bad auth/);
  await assert.rejects(P.encryptPayload('x'.repeat(4000), p.sub), /too long/);
});
test('the signed token (VAPID): right claims, a web-address subject (not an email), and a signature that verifies', async () => {
  const k = await vapidKeys(), now = Date.UTC(2026, 10, 17, 12);
  const h = await P.vapidHeader('https://fcm.googleapis.com/fcm/send/abc', 'https://www.nrnszn.com', k.VAPID_PUBLIC_KEY, k.VAPID_PRIVATE_KEY, now);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h); assert.ok(m, h);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64u.decode(m[2]))), { aud: 'https://fcm.googleapis.com', exp: Math.floor(now / 1000) + 43200, sub: 'https://www.nrnszn.com' });
  const pub = await webcrypto.subtle.importKey('raw', b64u.decode(k.VAPID_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u.decode(m[3]), te.encode(m[1] + '.' + m[2])));
});
test('GET /api/push: says off until both keys exist, then gives the PUBLIC key only', async () => {
  assert.deepEqual(await (await pushGet({ env: await world(false) })).json(), { ok: true, on: false });
  const e = await world(), j = await (await pushGet({ env: e })).json();
  assert.equal(j.on, true); assert.equal(j.key, e.VAPID_PUBLIC_KEY); assert.ok(!JSON.stringify(j).includes(e.VAPID_PRIVATE_KEY));
});
test('subscribing: valid ones saved once per address; bad ones, no keys and no database refused; a flood stopped', async () => {
  assert.equal((await sub(await world(false), 'x')).status, 503);
  const e = await world(); assert.equal((await sub({ ...e, DB: undefined }, 'x')).status, 503);
  assert.equal((await sub(e, 'one')).ok, true); assert.equal((await sub(e, 'one')).ok, true);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first()).n, 1);
  for (const bad of [{ endpoint: 'http://push.test/aaaaaaaaaa' }, { endpoint: 'javascript:alert(1)aaaa' }, { endpoint: 'https://push.test/a b' }, { endpoint: 'https://push.test/' + 'a'.repeat(700) }, { p256dh: 'short' }, { auth: 'x' }]) {
    const r = await sub(e, 'bad', '203.0.113.9', bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.match(r.message, /does not look like/);
  }
  for (let i = 0; i < 10; i++) assert.equal((await sub(e, 'f' + i, '198.51.100.9')).ok, true);
  assert.match((await sub(e, 'f10', '198.51.100.9')).message, /Too many/); assert.equal((await sub(e, 'f10', '198.51.100.10')).ok, true);
});
test('unsubscribing deletes the phone', async () => {
  const e = await world(); await sub(e, 'one');
  const r = await pushPost({ request: new Request('https://www.nrnszn.com/api/push', { method: 'POST', body: JSON.stringify({ action: 'unsubscribe', endpoint: 'https://push.test/one-abcdefghijkl' }) }), env: e });
  assert.equal((await r.json()).ok, true); assert.equal((await e.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first()).n, 0);
});
test('only the signed-in owner can see the numbers or send', async () => {
  const e = await world(); await sub(e, 'one');
  assert.equal((await admin(e, 'push-send', { push: { title: 'Hi' } }, null)).status, 401);
  assert.equal((await admin(e, 'push-send', { push: { title: 'Hi' } }, 'not.valid')).status, 401);
  assert.equal(pushed.length, 0);
  const s = await status(e, null); assert.ok(s.subscribers === undefined && s.mode === 'ready', 'without sign-in there is no data');
  const bad = await adminGet({ request: new Request('https://www.nrnszn.com/api/admin?section=push', { headers: { authorization: 'Bearer not.valid' } }), env: e }); assert.equal(bad.status, 401);
  const ok = await status(e); assert.deepEqual([ok.ok, ok.on, ok.subscribers, ok.sentToday, ok.cap], [true, true, 1, 0, 3]);
});
test('sending: every phone gets the encrypted message with what Nick wrote; an outside link becomes "/"; the log records it', async () => {
  const e = await world(), ph = await phone(); await P.ensurePush(e.DB);
  for (let i = 0; i < 3; i++) await e.DB.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, at, ip_hash) VALUES (?,?,?,?,?)').bind('https://push.test/p' + i + '-abcdefghijkl', ph.sub.p256dh, ph.sub.auth, i, 'x').run();
  const r = await admin(e, 'push-send', { push: { title: 'New\nshow <b>out</b>', body: 'x'.repeat(400), url: 'https://evil.example/' } });
  assert.deepEqual([r.status, r.sent, r.failed, r.removed], [200, 3, 0, 0]); assert.equal(pushed.length, 3); assert.ok(pushed[0].headers.authorization.startsWith('vapid t='));
  const msg = JSON.parse(await ph.decrypt(pushed[0].body)); assert.deepEqual([msg.title, msg.body.length, msg.url], ['New show <b>out</b>', 140, '/']);
  const ok = await admin(e, 'push-send', { push: { title: 'Events', body: 'x', url: '/events' } }); assert.equal(ok.ok, true);
  assert.equal(JSON.parse(await ph.decrypt(pushed[3].body)).url, '/events');
  const st = await status(e); assert.deepEqual([st.sentToday, st.last.length], [2, 2]);
});
test('sending needs a title, a subscriber and the keys, and says so plainly; nothing is sent', async () => {
  const e = await world(false); assert.match((await admin(e, 'push-send', { push: { title: 'Hi' } })).message, /not switched on/);
  const k = await world(); assert.match((await admin(k, 'push-send', { push: { title: 'Hi' } })).message, /Nobody has turned on/);
  await sub(k, 'one'); assert.match((await admin(k, 'push-send', { push: { title: '  ' } })).message, /Write a title/);
  assert.equal((await admin({ ...k, DB: undefined }, 'push-send', { push: { title: 'Hi' } })).status, 503);
  assert.equal(pushed.length, 0);
});
test('phones that left are removed, other failures kept and counted, and a send that reached nobody does not use up the day', async () => {
  const e = await world(), ph = await phone(); await P.ensurePush(e.DB);
  for (const n of ['ok', 'gone', 'bad']) await e.DB.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, at, ip_hash) VALUES (?,?,?,?,?)').bind('https://push.test/' + n + '-abcdefghijkl', ph.sub.p256dh, ph.sub.auth, 1, 'x').run();
  statusOf['https://push.test/gone-abcdefghijkl'] = 410; statusOf['https://push.test/bad-abcdefghijkl'] = 500;
  const r = await admin(e, 'push-send', { push: { title: 'Hi' } }); assert.deepEqual([r.sent, r.failed, r.removed], [1, 1, 1]);
  assert.deepEqual((await e.DB.prepare('SELECT endpoint FROM push_subs ORDER BY endpoint').all()).results.map(x => x.endpoint.split('/').pop().split('-')[0]), ['bad', 'ok']);
  statusOf['https://push.test/ok-abcdefghijkl'] = 500; const before = (await status(e)).sentToday;
  const r2 = await admin(e, 'push-send', { push: { title: 'Again' } }); assert.deepEqual([r2.sent, r2.failed], [0, 2]);
  assert.equal((await status(e)).sentToday, before);
});
test('at most 3 a day, then a plain message; the 24 hours roll', async () => {
  const e = await world(), ph = await phone(); await P.ensurePush(e.DB);
  await e.DB.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, at, ip_hash) VALUES (?,?,?,?,?)').bind('https://push.test/a-abcdefghijkl', ph.sub.p256dh, ph.sub.auth, 1, 'x').run();
  for (let i = 0; i < 3; i++) assert.equal((await admin(e, 'push-send', { push: { title: 'n' + i } })).sent, 1);
  assert.match((await admin(e, 'push-send', { push: { title: 'n4' } })).message, /already sent 3 notifications/);
  await e.DB.prepare('UPDATE push_log SET at = at - ?').bind(25 * 3600e3).run();
  assert.equal((await admin(e, 'push-send', { push: { title: 'tomorrow' } })).sent, 1);
});
test('the setup checklist lists the two notification keys (yes/no only, never the value)', async () => {
  const e = await world(); const j = await (await adminGet({ request: new Request('https://www.nrnszn.com/api/admin', { headers: { authorization: 'Bearer ' + await makeToken(e) } }), env: e })).json();
  const g = j.setup.find(x => x.group === 'Phone notifications'); assert.deepEqual(g.items.map(i => [i.name, i.present]), [['VAPID_PUBLIC_KEY', true], ['VAPID_PRIVATE_KEY', true]]);
  assert.ok(!JSON.stringify(j).includes(e.VAPID_PRIVATE_KEY));
});
