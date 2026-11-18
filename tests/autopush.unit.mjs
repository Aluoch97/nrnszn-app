// Automatic phone notifications (src/edge/autopush.js): new events, YouTube videos, services, gallery photos and NuCinema titles. No network: a fake database,
// fake sources and a fake push service.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fakeD1 } from './_d1.mjs';
import * as P from '../src/edge/push.js';
import * as A from '../src/edge/autopush.js';
import { saveEvent } from '../src/edge/events.js';
import { adminPost, adminGet, makeToken, forgetTries } from '../src/edge/admin.js';

const TEN_AM = Date.UTC(2026, 10, 18, 16, 0), THREE_AM = Date.UTC(2026, 10, 18, 9, 0);   // Nashville is UTC-6 in November
let pushed, statusOf;
beforeEach(() => {
  forgetTries(); pushed = []; statusOf = {}; globalThis.__nrnAuto = null;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://push.test/')) { pushed.push({ url: u, headers: Object.fromEntries(new Headers(init.headers)), body: init.body }); return new Response(null, { status: statusOf[u] || 201 }); }
    return new Response('not found', { status: 404 });
  };
});
async function world({ phones = 1, keys = true } = {}) {
  const env = { DB: fakeD1(), ADMIN_PASSWORD: 'correct horse battery staple' };
  if (keys) {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    env.VAPID_PUBLIC_KEY = P.b64u.encode(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))); env.VAPID_PRIVATE_KEY = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)).d;
  }
  await A.ensureAuto(env.DB);
  const ecdh = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sub = { p256dh: P.b64u.encode(new Uint8Array(await webcrypto.subtle.exportKey('raw', ecdh.publicKey))), auth: P.b64u.encode(webcrypto.getRandomValues(new Uint8Array(16))) };
  for (let i = 0; i < phones; i++) await env.DB.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, at, ip_hash) VALUES (?,?,?,?,?)').bind('https://push.test/p' + i + '-abcdefghijkl', sub.p256dh, sub.auth, i, 'x').run();
  return env;
}
const set = (env, on, data = {}, now = TEN_AM) => A.setAutoSettings(env.DB, on, env, now, Object.fromEntries(A.KINDS.map((k) => [k, async () => (data[k] === undefined ? [] : data[k])])));
const run = (env, data, now = TEN_AM) => A.runAuto(env.DB, env, data, { now, fetchFn: globalThis.fetch });
const log = async (env) => (await env.DB.prepare('SELECT title, body, url FROM push_log ORDER BY id').all()).results;
const ev = (id, title, day = '2026-12-01', where = 'The Hive') => ({ key: id, title, day, where, slug: title.toLowerCase().replace(/\W+/g, '-') + '-' + id });

test('everything is off by default: nothing is sent and nothing remembered', async () => {
  const env = await world();
  assert.deepEqual(await A.getAutoSettings(env.DB), { events: false, videos: false, services: false, gallery: false, cinema: false });
  assert.equal((await run(env, { events: [ev('a', 'Show')] })).skipped, 'off'); assert.equal(pushed.length, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM push_auto_seen').first()).n, 0);
});
test('turning a kind ON records what exists WITHOUT sending; only newer things are announced, once', async () => {
  const env = await world();
  await set(env, { events: true }, { events: [ev('old', 'Old Show')] });
  assert.equal(pushed.length, 0);
  assert.deepEqual((await run(env, { events: [ev('old', 'Old Show')] })).sent, []);
  const r = await run(env, { events: [ev('old', 'Old Show'), ev('new1', 'Winter Showcase', '2026-12-20', 'The Basement')] });
  assert.deepEqual(r.sent.map((x) => [x.kinds, x.phones]), [[['events'], 1]]);
  assert.deepEqual((await log(env))[0], { title: 'New event', body: 'Winter Showcase · Dec 20 · The Basement', url: '/events/winter-showcase-new1/' });
  assert.deepEqual((await run(env, { events: [ev('old', 'Old Show'), ev('new1', 'Winter Showcase')] })).sent, [], 'never twice'); assert.equal(pushed.length, 1);
});
test('a kind that stays off stays silent even if its data changes', async () => {
  const env = await world(); await set(env, { events: true }, {});
  const r = await run(env, { events: [], services: [{ key: 'svc:1', title: 'Mixing' }] }); assert.deepEqual(r.sent, []); assert.equal(pushed.length, 0);
});
test('what each kind says, and where a tap goes', async () => {
  for (const [kind, items, want] of [
    ['videos', [{ key: 'v1', title: 'Raise the Bar S1E2', label: 'interview' }], { title: 'New on YouTube', body: 'Raise the Bar S1E2 (interview)', url: '/' }],
    ['services', [{ key: 'svc:9', title: 'Podcast editing' }], { title: 'New service', body: 'Podcast editing', url: '/services' }],
    ['gallery', [{ key: 'i1', title: 'a.jpg', door: 'Events · Rivergate' }, { key: 'i2', title: 'b.jpg', door: 'Events · Rivergate' }], { title: 'New in the gallery', body: '2 new photos in Events · Rivergate', url: '/gallery' }],
    ['gallery', [{ key: 'i1', title: 'a.jpg', door: 'Events · A' }, { key: 'i2', title: 'b.jpg', door: 'Events · B' }, { key: 'i3', title: 'c.jpg', door: 'Events · B' }], { title: 'New in the gallery', body: '3 new photos across 2 albums', url: '/gallery' }],
    ['cinema', [{ key: 'c1', title: 'Certified Lounge: S2E4' }], { title: 'New on NuCinema', body: 'Certified Lounge: S2E4', url: '/cinema' }],
    ['cinema', [{ key: 'c1', title: 'One' }, { key: 'c2', title: 'Two' }], { title: '2 new on NuCinema', body: 'One · Two', url: '/cinema' }],
    ['services', [{ key: 'svc:1', title: 'A' }, { key: 'svc:2', title: 'B' }], { title: '2 new services', body: 'A · B', url: '/services' }],
    ['events', [ev('a', 'A'), ev('b', 'B')], { title: '2 new events', body: 'A · B', url: '/events' }],
  ]) {
    const env = await world(); await set(env, { [kind]: true }, {});
    await run(env, { [kind]: items }); assert.deepEqual((await log(env))[0], want, kind + ' ' + items.length);
  }
});
test('several kinds with news at once become ONE digest, so the 3-a-day limit is not burned', async () => {
  const env = await world(); await set(env, { events: true, videos: true, gallery: true }, {});
  await run(env, { events: [ev('e1', 'Open Mic')], videos: [{ key: 'v9', title: 'Studio Tour', label: 'music video' }], gallery: [{ key: 'g1', title: 'x', door: 'Studios · Room A' }] });
  assert.equal(pushed.length, 1);
  assert.deepEqual((await log(env))[0], { title: 'New on NuRenaissance', body: 'New event: Open Mic · New music video: Studio Tour · 1 new photo in Studios · Room A', url: '/' });
});
test('only between 9 AM and 9 PM Central: at night nothing is sent AND nothing is used up', async () => {
  const env = await world(); await set(env, { services: true }, {});
  assert.equal((await run(env, { services: [{ key: 'svc:1', title: 'X' }] }, THREE_AM)).skipped, 'quiet hours');
  assert.equal(pushed.length, 0); assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_auto_seen WHERE key = 'svc:1'").first()).n, 0);
  assert.deepEqual((await run(env, { services: [{ key: 'svc:1', title: 'X' }] }, TEN_AM)).sent.map((x) => x.kinds), [['services']]);
  assert.equal(A.centralHour(Date.UTC(2026, 6, 18, 14, 0)), 9, 'summer time too');
});
test('it shares the 3-a-day limit; blocked items are kept and go out a day later', async () => {
  const env = await world(); await set(env, { services: true }, {});
  for (let i = 0; i < 3; i++) assert.equal((await P.pushSend(env.DB, env, { title: 'manual ' + i }, { fetchFn: globalThis.fetch, now: TEN_AM - 3600e3 })).sent, 1);
  assert.match((await run(env, { services: [{ key: 'svc:w', title: 'W' }] })).skipped, /already sent 3/);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_auto_seen WHERE key = 'svc:w'").first()).n, 0);
  assert.equal((await run(env, { services: [{ key: 'svc:w', title: 'W' }] }, TEN_AM + 25 * 3600e3)).sent.length, 1);
});
test('nobody subscribed: counted as announced; if no phone can be reached the item is kept for next time', async () => {
  const env = await world({ phones: 0 }); await set(env, { services: true }, {});
  assert.deepEqual((await run(env, { services: [{ key: 'svc:a', title: 'A' }] })).sent.map((x) => x.phones), [0]);
  const env2 = await world(); await set(env2, { services: true }, {}); statusOf['https://push.test/p0-abcdefghijkl'] = 500;
  await run(env2, { services: [{ key: 'svc:b', title: 'B' }] });
  assert.equal((await env2.DB.prepare('SELECT COUNT(*) AS n FROM push_auto_seen').first()).n, 0, 'unclaimed again');
  statusOf['https://push.test/p0-abcdefghijkl'] = 201; assert.equal((await run(env2, { services: [{ key: 'svc:b', title: 'B' }] })).sent[0].phones, 1);
});
test('two checks at the same moment announce it once', async () => {
  const env = await world(); await set(env, { cinema: true }, {});
  const data = { cinema: [{ key: 'c9', title: 'New Film' }] }; await Promise.all([run(env, data), run(env, data), run(env, data)]); assert.equal(pushed.length, 1);
});
test('a source that cannot be read: it is left OFF when switching on (no backlog later) and skipped (null) in a check', async () => {
  const env = await world();
  const r = await A.setAutoSettings(env.DB, { gallery: true, services: true }, env, TEN_AM, { gallery: async () => { throw new Error('Drive said no'); }, services: async () => [{ key: 'svc:1', title: 'A' }], events: async () => [], videos: async () => [], cinema: async () => [] });
  assert.deepEqual([r.gallery, r.services], [false, true]);
  await A.setAutoSettings(env.DB, { services: true, cinema: true }, env, TEN_AM, { services: async () => [], cinema: async () => [{ key: 'c1', title: 'Old' }], events: async () => [], videos: async () => [], gallery: async () => [] });
  assert.deepEqual((await run(env, { services: null, cinema: [{ key: 'c1', title: 'Old' }] })).sent, [], 'a null source is skipped and nothing else is announced');
});
test('maybeAuto: finds a newly published event in the real database; throttled to every 10 minutes unless forced; never throws', async () => {
  const env = await world(); const sources = { ...A.SOURCES };
  await A.setAutoSettings(env.DB, { events: true }, env, TEN_AM, sources);
  assert.deepEqual(await A.maybeAuto(env, { now: TEN_AM, sources, fetchFn: globalThis.fetch }), { sent: [], skipped: '' });
  const saved = await saveEvent(env.DB, { title: 'Winter Showcase', day: '2026-12-20', time: '7 PM', where: 'The Basement', published: true }, TEN_AM); assert.equal(saved.ok, true);
  assert.equal(await A.maybeAuto(env, { now: TEN_AM + 60e3, sources }), null, 'throttled');
  const r = await A.maybeAuto(env, { force: true, now: TEN_AM + 61e3, sources, fetchFn: globalThis.fetch });
  assert.deepEqual(r.sent.map((x) => x.kinds), [['events']]); assert.match((await log(env))[0].url, /^\/events\/winter-showcase-[a-z0-9]+\/$/);
  await saveEvent(env.DB, { title: 'Old Recap', day: '2026-01-05', published: true }, TEN_AM);
  await saveEvent(env.DB, { title: 'Draft', day: '2026-12-30', published: false }, TEN_AM);
  assert.deepEqual((await A.maybeAuto(env, { force: true, now: TEN_AM + 120e3, sources, fetchFn: globalThis.fetch })).sent, [], 'past events and unpublished drafts are never announced');
  assert.equal(await A.maybeAuto({}, { force: true }), null); assert.equal(await A.maybeAuto({ DB: env.DB }, { force: true }), null, 'no keys: nothing');
});
test('the admin switches: owner only, saved, shown in the status, and a kind whose source cannot be read stays off', async () => {
  const env = await world(); const token = await makeToken(env);
  const post = (auto, t = token) => adminPost({ request: new Request('https://www.nrnszn.com/api/admin', { method: 'POST', body: JSON.stringify({ action: 'push-auto', auto }), headers: t ? { authorization: 'Bearer ' + t } : {} }), env }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  assert.equal((await post({ events: true }, null)).status, 401); assert.equal((await post({ events: true }, 'bad.token')).status, 401);
  const r = await post({ events: true, services: true });   // events reads our own database; services needs Google, which this test cannot reach
  assert.deepEqual([r.status, r.auto.events, r.auto.services], [200, true, false]);
  const st = await (await adminGet({ request: new Request('https://www.nrnszn.com/api/admin?section=push', { headers: { authorization: 'Bearer ' + token } }), env })).json();
  assert.deepEqual(st.auto, { events: true, videos: false, services: false, gallery: false, cinema: false });
});
