// The cookieless page-view counter and the numbers behind /admin (src/edge/analytics.js) against a real SQLite database. No network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordHit, summary, cleanPath, refHost, deviceOf, chicagoDay, FLOOD_PER_HOUR, KEEP_DAYS } from '../src/edge/analytics.js';
import { fakeD1 } from './_d1.mjs';
import { ensureDb } from '../src/edge/db.js';

let db, env;
const DAY = 86400000, T0 = Date.UTC(2026, 10, 16, 18, 0, 0);   // Nov 16, 2026, noon in Nashville
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
beforeEach(() => { db = fakeD1(); env = { DB: db, ADMIN_PASSWORD: 'a long admin password' }; });

function hit(body = { p: '/events', w: 390 }, { ip = '203.0.113.7', ua = UA, headers = {}, cf = { country: 'US', region: 'Tennessee', city: 'Nashville' }, e = env, now = T0 } = {}) {
  const request = new Request('https://www.nrnszn.com/api/hit', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'user-agent': ua, 'cf-connecting-ip': ip, ...headers } });
  request.cf = cf;
  return recordHit({ request, env: e }, now);
}
const rows = async () => (await db.prepare('SELECT * FROM page_views ORDER BY ts, path').all()).results;

test('helpers: addresses are cleaned, referrers reduced to a host, devices sorted by width, days in Nashville time', () => {
  assert.equal(cleanPath('/events?x=1#top'), '/events'); assert.equal(cleanPath('/events/'), '/events'); assert.equal(cleanPath('/'), '/');
  for (const bad of ['', 'events', '//evil.com', '/admin', '/admin/', '/api/hit', '/_astro/x.js', '/widgets/a.html', '/a b', '/<x>', 'x'.repeat(300), null, 42]) assert.equal(cleanPath(bad), '', String(bad));
  assert.equal(refHost('https://www.instagram.com/p/abc?x=1', 'www.nrnszn.com'), 'instagram.com'); assert.equal(refHost('https://www.nrnszn.com/about', 'www.nrnszn.com'), '', 'our own pages are not a referrer');
  for (const bad of ['', 'javascript:alert(1)', 'not a url', null]) assert.equal(refHost(bad, 'x.com'), '');
  assert.deepEqual([deviceOf(320), deviceOf(390), deviceOf(768), deviceOf(1280), deviceOf(undefined)], ['phone', 'phone', 'tablet', 'computer', 'computer']);
  assert.equal(chicagoDay(Date.UTC(2026, 10, 16, 3, 0)), '2026-11-15', 'just after midnight UTC is still the evening before in Nashville');
});

test('a page view is saved with the day, page, device, referrer and place, and always answers 204', async () => {
  const res = await hit({ p: '/events?utm=x#a', r: 'https://l.instagram.com/?u=1', w: 390 });
  assert.equal(res.status, 204); assert.equal(await res.text(), '');
  const [r] = await rows();
  assert.deepEqual({ day: r.day, path: r.path, device: r.device, ref: r.ref, country: r.country, region: r.region, city: r.city }, { day: '2026-11-16', path: '/events', device: 'phone', ref: 'l.instagram.com', country: 'US', region: 'Tennessee', city: 'Nashville' });
  assert.match(r.visitor, /^[a-f0-9]{16}$/);
});

test('the IP address and the browser name are never stored, anywhere', async () => {
  await hit({ p: '/', w: 1280 }, { ip: '198.51.100.77', ua: 'Mozilla/5.0 UniqueBrowserNameXYZ Chrome/120' });
  const dump = JSON.stringify(await rows()) + JSON.stringify((await db.prepare("SELECT sql FROM sqlite_master").all()).results);
  assert.ok(!dump.includes('198.51.100.77') && !dump.includes('UniqueBrowserNameXYZ'), 'the IP or browser name was stored');
});

test('the visitor code is stable within a day, differs per person, and changes every day (so nobody can be followed across days)', async () => {
  await hit({ p: '/a' }, { ip: '1.1.1.1' }); await hit({ p: '/b' }, { ip: '1.1.1.1' }); await hit({ p: '/c' }, { ip: '2.2.2.2' });
  await hit({ p: '/d' }, { ip: '1.1.1.1', now: T0 + DAY });
  const [a, b, c, d] = (await rows()).sort((x, y) => x.path.localeCompare(y.path));
  assert.equal(a.visitor, b.visitor, 'same person, same day'); assert.notEqual(a.visitor, c.visitor, 'different person'); assert.notEqual(a.visitor, d.visitor, 'same person, next day: a different code');
  const other = { ...env, ADMIN_PASSWORD: 'a different admin password' }; await hit({ p: '/e' }, { ip: '1.1.1.1', e: other });
  assert.notEqual((await rows()).find((r) => r.path === '/e').visitor, a.visitor, 'the secret key is part of the code, so it cannot be recomputed from an IP without it');
});

test('with no secret key at all, page views are still counted but visitors are not', async () => {
  await hit({ p: '/x' }, { e: { DB: db } });
  const [r] = await rows(); assert.equal(r.visitor, ''); assert.equal((await summary(db, 7, T0)).visitors, 0); assert.equal((await summary(db, 7, T0)).views, 1);
});

test('Do Not Track, robots, bad pages, /admin, junk bodies and a missing database are all quietly ignored (still 204)', async () => {
  const skips = [
    hit({ p: '/' }, { headers: { dnt: '1' } }), hit({ p: '/' }, { headers: { 'sec-gpc': '1' } }),
    hit({ p: '/' }, { ua: 'Googlebot/2.1' }), hit({ p: '/' }, { ua: 'Mozilla/5.0 (compatible; AhrefsBot/7.0)' }), hit({ p: '/' }, { ua: '' }), hit({ p: '/' }, { ua: 'curl/8.0' }),
    hit({ p: '/admin' }), hit({ p: '/api/x' }), hit({ p: 'no-slash' }), hit('not json'), hit('null'), hit({}), hit({ p: '/' }, { e: {} }), hit({ p: '/' }, { e: { DB: null } }),
  ];
  for (const r of await Promise.all(skips)) assert.equal((await r).status, 204);
  await ensureDb(db); assert.equal((await rows()).length, 0);
});

test('one visitor cannot flood the counts: over 300 an hour is dropped', async () => {
  for (let i = 0; i < FLOOD_PER_HOUR + 20; i++) await hit({ p: '/spam' });
  assert.equal((await rows()).length, FLOOD_PER_HOUR);
  await hit({ p: '/spam' }, { now: T0 + 2 * 3600000 }); assert.equal((await rows()).length, FLOOD_PER_HOUR + 1, 'an hour later it counts again');
});

test('old rows are deleted now and then (rows older than the keep time)', async () => {
  const old = T0 - (KEEP_DAYS + 5) * DAY; db.raw.exec('SELECT 1');
  await hit({ p: '/old' }, { now: old });
  const orig = Math.random; Math.random = () => 0;
  try { await hit({ p: '/new' }, { ip: '9.9.9.9' }); } finally { Math.random = orig; }
  assert.deepEqual((await rows()).map((r) => r.path), ['/new']);
});

test('the summary adds up views and visitors, fills empty days, compares with the period before, and ranks pages, sources, devices and places', async () => {
  const plan = [  // [days ago, ip, path, width, referrer, city]
    [0, '1.1.1.1', '/', 390, 'https://l.instagram.com/', 'Nashville'], [0, '1.1.1.1', '/events', 390, '', 'Nashville'], [0, '2.2.2.2', '/', 1280, 'https://www.google.com/', 'Atlanta'],
    [2, '3.3.3.3', '/events', 768, 'https://l.instagram.com/', 'Nashville'], [3, '1.1.1.1', '/', 390, '', 'Nashville'],
    [10, '4.4.4.4', '/about', 390, '', 'Memphis'],   // only inside the 30-day window
    [40, '5.5.5.5', '/', 390, '', 'Nashville'],      // the period before a 30-day window
  ];
  for (const [ago, ip, p, w, r, city] of plan) await hit({ p, w, r }, { ip, now: T0 - ago * DAY, cf: { country: 'US', region: 'Tennessee', city } });
  const s7 = await summary(db, 7, T0);
  assert.equal(s7.days, 7); assert.equal(s7.daily.length, 7); assert.equal(s7.views, 5); assert.equal(s7.visitors, 4, 'visitors are counted per day: two on day 0, one on day 2, one on day 3');
  assert.deepEqual(s7.daily.map((d) => d.views), [0, 0, 0, 1, 1, 0, 3]); assert.equal(s7.daily.at(-1).day, '2026-11-16'); assert.equal(s7.daily.at(-1).visitors, 2);
  assert.equal(s7.viewsPerVisitor, 1.3);
  assert.deepEqual(s7.pages[0], { name: '/', views: 3 }); assert.deepEqual(s7.referrers.map((r) => r.name), ['l.instagram.com', 'google.com']);
  assert.deepEqual(s7.devices.map((d) => [d.name, d.views]), [['phone', 3], ['computer', 1], ['tablet', 1]]); assert.equal(s7.cities[0].name, 'Nashville, Tennessee'); assert.equal(s7.countries[0].name, 'US');
  const s30 = await summary(db, 30, T0); assert.equal(s30.views, 6); assert.equal(s30.previous.views, 1);
  assert.equal((await summary(db, 999, T0)).days, 30, 'an odd range falls back to 30 days');
});

test('the summary of an empty database is all zeros, not an error', async () => {
  const s = await summary(db, 30, T0); assert.equal(s.views, 0); assert.equal(s.visitors, 0); assert.equal(s.viewsPerVisitor, null); assert.equal(s.daily.length, 30); assert.deepEqual(s.pages, []);
});
