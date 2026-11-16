// The owner sign-in behind /admin (src/edge/admin.js): password, signed session, lockout, owner-only facts. No network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { adminGet, adminPost, adminReady, makeToken, verifyToken, setupChecklist, forgetTries, SESSION_MS, MAX_TRIES } from '../src/edge/admin.js';

const PASSWORD = 'correct horse battery staple';
const env = (over = {}) => ({ ADMIN_PASSWORD: PASSWORD, ...over });
const call = (fn, { method = 'POST', body, token, ip = '1.2.3.4', e = env() } = {}) => fn({
  request: new Request('https://www.nrnszn.com/api/admin', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'cf-connecting-ip': ip } }),
  env: e,
});
const login = (password, opts = {}) => call(adminPost, { body: { action: 'login', password }, ...opts });
beforeEach(() => forgetTries());

test('it is off until ADMIN_PASSWORD exists (and is long enough), and says so without showing anything', async () => {
  for (const e of [{}, { ADMIN_PASSWORD: '' }, { ADMIN_PASSWORD: 'short' }]) {
    assert.equal(adminReady(e), false);
    assert.equal((await (await call(adminGet, { method: 'GET', e })).json()).mode, 'not-set-up');
    assert.equal((await login('anything', { e })).status, 503);
  }
  assert.equal(adminReady(env()), true);
  assert.equal((await (await call(adminGet, { method: 'GET' })).json()).mode, 'ready');
});

test('the right password gives a signed 30-day session; the wrong one gives nothing', async () => {
  const ok = await (await login(PASSWORD)).json();
  assert.equal(ok.ok, true); assert.equal(ok.days, 30); assert.match(ok.token, /^[\w-]+\.[\w-]+$/);
  assert.equal(await verifyToken(env(), ok.token), true);
  let n = 0;   // (each wrong try from its own address, so this test is about the answer, not the lockout)
  for (const bad of ['wrong', PASSWORD + ' ', PASSWORD.toUpperCase(), '', 42, null]) {
    const res = await login(bad, { ip: `10.0.0.${++n}` }); assert.equal(res.status, 401, String(bad)); assert.equal((await res.json()).token, undefined);
  }
});

test('five wrong tries lock that address for 15 minutes, even for the right password; other addresses and later are fine', async () => {
  for (let i = 0; i < MAX_TRIES; i++) assert.equal((await login('nope', { ip: '9.9.9.9' })).status, 401);
  assert.equal((await login(PASSWORD, { ip: '9.9.9.9' })).status, 429, 'locked, even with the right password');
  assert.equal((await login(PASSWORD, { ip: '8.8.8.8' })).status, 200, 'another address is not affected');
  forgetTries();
  for (let i = 0; i < MAX_TRIES - 1; i++) await login('nope', { ip: '7.7.7.7' });
  assert.equal((await login(PASSWORD, { ip: '7.7.7.7' })).status, 200, 'a right password before the limit works and resets the count');
  for (let i = 0; i < MAX_TRIES - 1; i++) await login('nope', { ip: '7.7.7.7' });
  assert.equal((await login(PASSWORD, { ip: '7.7.7.7' })).status, 200, 'the count really was reset');
});

test('a session token cannot be forged, edited, reused after the password changes, or used after it expires', async () => {
  const good = await makeToken(env());
  assert.equal(await verifyToken(env(), good), true);
  const [payload, sig] = good.split('.');
  const longer = Buffer.from(JSON.stringify({ exp: Date.now() + 10 * SESSION_MS, v: 1 })).toString('base64url');
  for (const bad of ['', 'x', payload, `${payload}.`, `.${sig}`, `${longer}.${sig}`, `${payload}.${sig}x`, `${good}.more`, `${payload}.${'A'.repeat(sig.length)}`]) assert.equal(await verifyToken(env(), bad), false, bad.slice(0, 20));
  assert.equal(await verifyToken(env({ ADMIN_PASSWORD: 'a different long password' }), good), false, 'changing the password signs everyone out');
  const old = await makeToken(env(), Date.now() - SESSION_MS - 1000);
  assert.equal(await verifyToken(env(), old), false, 'expired');
  assert.equal(await verifyToken({}, good), false, 'no password set: nothing is valid');
});

test('the facts behind the page need a sign-in, and say yes/no for each secret without ever including a value', async () => {
  assert.equal((await call(adminGet, { method: 'GET', token: 'junk' })).status, 401);
  const e = env({ RESEND_API_KEY: 're_super_secret_value', SURVEY_SERVICE_ACCOUNT_JSON: '{"private_key":"PRIVATE-KEY-TEXT"}', BACKUPS: { put() {}, list: async () => ({ objects: [], truncated: false }) }, BACKUP_CRON_TOKEN: 'tok-value' });
  const token = await makeToken(e);
  const res = await call(adminGet, { method: 'GET', token, e }), text = await res.text(), out = JSON.parse(text);
  assert.equal(res.status, 200); assert.equal(out.signedIn, true);
  for (const secret of ['re_super_secret_value', 'PRIVATE-KEY-TEXT', 'tok-value', PASSWORD]) assert.ok(!text.includes(secret), 'a secret value leaked: ' + secret);
  const flat = Object.fromEntries(out.setup.flatMap((g) => g.items.map((i) => [i.name, i.present])));
  assert.equal(flat.RESEND_API_KEY, true); assert.equal(flat.SURVEY_SERVICE_ACCOUNT_JSON, true); assert.equal(flat.BACKUPS, true); assert.equal(flat.ADMIN_PASSWORD, true);
  assert.equal(flat.PAYMENTS_SERVICE_ACCOUNT_JSON, false); assert.equal(flat.YOUTUBE_API_KEY, false);
  assert.equal(out.backup.mode, 'r2');
});

test('"Back up now" needs a sign-in and a connected bucket', async () => {
  assert.equal((await call(adminPost, { body: { action: 'backup' } })).status, 401, 'no token');
  assert.equal((await call(adminPost, { body: { action: 'backup' }, token: 'junk' })).status, 401, 'bad token');
  const token = await makeToken(env());
  const noBucket = await call(adminPost, { body: { action: 'backup' }, token }); assert.equal(noBucket.status, 503); assert.equal((await noBucket.json()).result, 'not-set-up');
  const e = env({ BACKUPS: { put: async () => {}, list: async () => ({ objects: [], truncated: false }), delete: async () => {} } });
  const noKeys = await call(adminPost, { body: { action: 'backup' }, token, e }); assert.equal(noKeys.status, 502, 'no sheet keys on the site: nothing could be saved'); assert.equal((await noKeys.json()).result, 'nothing-saved');
  assert.equal((await call(adminPost, { body: { action: 'what' }, token })).status, 400);
  const bad = await adminPost({ request: new Request('https://x/api/admin', { method: 'POST', body: 'not json' }), env: env() }); assert.equal(bad.status, 400);
});

test('the checklist lists every secret the site uses, grouped, yes/no only', () => {
  const list = setupChecklist(env());
  assert.ok(list.length >= 4 && list.every((g) => g.group && g.items.every((i) => typeof i.present === 'boolean' && i.label && i.name)));
  const names = list.flatMap((g) => g.items.map((i) => i.name));
  for (const n of ['SURVEY_SERVICE_ACCOUNT_JSON', 'RESEND_API_KEY', 'SURVEY_UNSUB_SECRET', 'RECAP_CRON_TOKEN', 'PAYMENTS_SERVICE_ACCOUNT_JSON', 'SERVICES_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'YOUTUBE_API_KEY', 'BACKUPS', 'BACKUP_CRON_TOKEN', 'ADMIN_PASSWORD']) assert.ok(names.includes(n), n);
});

// ---- events and analytics inside /admin (they need the D1 database binding) ----
import { fakeD1 } from './_d1.mjs';
const getSection = (section, opts = {}) => adminGet({ request: new Request(`https://www.nrnszn.com/api/admin?section=${section}${opts.query || ''}`, { headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) } }), env: opts.e || env() });
const postAs = (token, body, e) => call(adminPost, { body, token, e });

test('events and analytics need a sign-in first, then the database; without the database they say how to connect it', async () => {
  for (const s of ['events', 'analytics']) {
    assert.equal((await getSection(s, { token: 'junk' })).status, 401);
    const token = await makeToken(env());
    const noDb = await getSection(s, { token }); assert.equal(noDb.status, 503); assert.equal((await noDb.json()).result, 'no-db');
  }
  const token = await makeToken(env());
  for (const body of [{ action: 'event-save', event: { title: 'x', day: '2027-01-01' } }, { action: 'event-delete', id: 'deadbeefdead' }]) {
    assert.equal((await postAs(null, body)).status, 401, 'no sign-in'); assert.equal((await postAs(token, body)).status, 503, 'no database');
  }
});

test('add, list, edit and delete an event through /admin; a bad event is refused with a plain message; the public list only has published ones', async () => {
  const e = env({ DB: fakeD1() }), token = await makeToken(e);
  const saved = await (await postAs(token, { action: 'event-save', event: { title: 'Winter Showcase', day: '2027-02-13', time: '7 PM', where: 'HOME Studios', details: 'Doors at 6.', tickets: 'https://www.nrnszn.com/support', published: true } }, e)).json();
  assert.equal(saved.ok, true); assert.match(saved.id, /^[a-f0-9]{12}$/);
  await postAs(token, { action: 'event-save', event: { title: 'Secret', day: '2027-03-01', published: false } }, e);
  const list = await (await getSection('events', { token, e })).json(); assert.deepEqual(list.events.map((x) => x.title), ['Secret', 'Winter Showcase']); assert.equal(list.events[0].published, false);
  const edited = await (await postAs(token, { action: 'event-save', event: { id: saved.id, title: 'Winter Showcase (moved)', day: '2027-02-20', published: true } }, e)).json(); assert.equal(edited.id, saved.id);
  const bad = await postAs(token, { action: 'event-save', event: { title: '', day: '2027-02-13' } }, e); assert.equal(bad.status, 400); assert.match((await bad.json()).error, /name/);
  const bad2 = await postAs(token, { action: 'event-save', event: { title: 'x', day: '2027-02-13', tickets: 'javascript:alert(1)' } }, e); assert.equal(bad2.status, 400);
  const { listPublic } = await import('../src/edge/events.js'); assert.deepEqual((await listPublic(e.DB)).map((x) => x.title), ['Winter Showcase (moved)']);
  assert.equal((await postAs(token, { action: 'event-delete', id: saved.id }, e)).status, 200); assert.equal((await postAs(token, { action: 'event-delete', id: saved.id }, e)).status, 400);
  assert.equal((await (await getSection('events', { token, e })).json()).events.length, 1);
});

test('the analytics section returns the numbers for 7, 30 or 90 days', async () => {
  const e = env({ DB: fakeD1() }), token = await makeToken(e);
  for (const days of [7, 30, 90]) { const out = await (await getSection('analytics', { token, e, query: `&days=${days}` })).json(); assert.equal(out.ok, true); assert.equal(out.days, days); assert.equal(out.daily.length, days); assert.equal(out.views, 0); }
  assert.equal((await (await getSection('analytics', { token, e, query: '&days=5' })).json()).days, 30);
});

test('the setup checklist also says whether the database is connected', () => {
  const flat = Object.fromEntries(setupChecklist(env({ DB: fakeD1() })).flatMap((g) => g.items.map((i) => [i.name, i.present])));
  assert.equal(flat.DB, true); assert.equal(setupChecklist(env()).flatMap((g) => g.items).find((i) => i.name === 'DB').present, false);
});
