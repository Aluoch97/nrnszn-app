import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITES, checkSite, checkAll } from '../scripts/check-sites.mjs';

const page = '<!doctype html><html><body>' + 'x'.repeat(600) + '</body></html>';
const reply = (body, { status = 200, type = 'text/html' } = {}) => async () => new Response(body, { status, headers: { 'content-type': type } });
const fast = { waitMs: 0, tries: 3 };
const home = SITES[0];

test('a healthy page passes', async () => assert.equal((await checkSite(home, { ...fast, fetchImpl: reply(page) })).pass, true));
test('an error status fails after the retries and says why', async () => {
  let n = 0; const r = await checkSite(home, { ...fast, fetchImpl: async () => { n++; return new Response('no', { status: 503 }); } });
  assert.equal(r.pass, false); assert.equal(r.why, 'HTTP 503'); assert.equal(n, 3);
});
test('a blip that clears on the second try is not reported', async () => {
  let n = 0; const r = await checkSite(home, { ...fast, fetchImpl: async () => (++n === 1 ? new Response('x', { status: 502 }) : reply(page)()) });
  assert.equal(r.pass, true); assert.equal(n, 2);
});
test('a network error and a wrong kind of page both fail', async () => {
  assert.match((await checkSite(home, { ...fast, fetchImpl: async () => { throw new Error('connection refused'); } })).why, /connection refused/);
  assert.equal((await checkSite(home, { ...fast, fetchImpl: reply('{}', { type: 'application/json' }) })).pass, false);   // an error page that is not HTML
  assert.equal((await checkSite(home, { ...fast, fetchImpl: reply('<html>tiny</html>') })).pass, false);
});
test('version files need a version, and the sitemap needs a urlset', async () => {
  const v = SITES.find((s) => s.url.endsWith('play.nrnszn.com/version.json'));
  assert.equal((await checkSite(v, { ...fast, fetchImpl: reply('{"version":"2.22"}', { type: 'application/json' }) })).pass, true);
  assert.equal((await checkSite(v, { ...fast, fetchImpl: reply('{}', { type: 'application/json' }) })).pass, false);
  const s = SITES.find((x) => x.url.endsWith('sitemap.xml'));
  assert.equal((await checkSite(s, { ...fast, fetchImpl: reply('<urlset></urlset>', { type: 'application/xml' }) })).pass, true);
});
test('checkAll reports each site on its own', async () => {
  const out = await checkAll(SITES, { ...fast, fetchImpl: async (u) => { u = String(u); if (u.includes('luoh.nrnszn.com')) return new Response('', { status: 500 }); if (u.endsWith('version.json')) return reply('{"version":"1.0"}', { type: 'application/json' })(); if (u.includes('/auth/v1/health')) return reply('{"name":"GoTrue"}', { type: 'application/json' })(); if (u.includes('action=ping')) return reply('{"ok":true}', { type: 'application/json' })(); if (u.endsWith('/api')) return reply('{"result":{"db":true}}', { type: 'application/json' })(); if (u.endsWith('sitemap.xml')) return reply('<urlset/>', { type: 'application/xml' })(); return reply(page)(); } });
  assert.ok(out.filter((r) => !r.pass).every((r) => /^luoh \(luoh/.test(r.name)));
  assert.equal(out.length, SITES.length);
});

test('the data-service checks send what they need (method, body, keys) and read the answer', async () => {
  const seen = {};
  const f = async (u, o) => { seen[String(u)] = o; u = String(u); if (u.endsWith('/api')) return reply('{"result":{"db":true}}', { type: 'application/json' })(); if (u.includes('action=ping')) return reply('{"ok":true}', { type: 'application/json' })(); return reply('{"name":"GoTrue"}', { type: 'application/json' })(); };
  const svc = SITES.filter((s) => s.soft);
  assert.equal(svc.length, 3);
  const out = await checkAll(svc, { ...fast, fetchImpl: f });
  assert.ok(out.every((r) => r.pass));
  const api = seen['https://soulnicolas.com/api']; assert.equal(api.method, 'POST'); assert.deepEqual(JSON.parse(api.body), { fn: 'edgeStatus', args: [] });
  const ping = Object.entries(seen).find(([u]) => u.includes('action=ping'))[1]; assert.ok(ping.headers.apikey && ping.headers.authorization.startsWith('Bearer '));
});

test('a failing soft check is reported but a failing normal check still fails the run (exit-code rule)', async () => {
  const out = await checkAll(SITES.filter((s) => s.soft), { ...fast, fetchImpl: async () => new Response('{}', { status: 500 }) });
  assert.ok(out.every((r) => !r.pass && r.soft));
});
