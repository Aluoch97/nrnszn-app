// The one NuRenaissance account (src/edge/accounts.js): shared cookie, Google + e-mail sign-in, the soulnicolas.com ticket hop,
// who may read what (CORS), and client projects. Real SQLite (tests/_d1.mjs), fake Google keys and a fake Resend. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './_d1.mjs';
import {
  accountRequest, sessionCookie, sessionUserId, cookieDomain, safeReturn, saveProject, addPayment, allProjects, projectsFor, accountsDb,
  LINKS_PER_DAY, COOKIE,
} from '../src/edge/accounts.js';
import { adminGet, adminPost, makeToken, setupChecklist } from '../src/edge/admin.js';
import { SAVED_MAX } from '../src/edge/accounts.js';

const SECRET = 'a-long-shared-secret-for-tests-0123';
const CLIENT = 'test-client.apps.googleusercontent.com';
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');

async function googleKit() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const token = async (claims, { kid = 'k1', key = pair.privateKey } = {}) => {
    const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })), body = b64u(JSON.stringify(claims));
    return `${head}.${body}.${b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`))))}`;
  };
  return { certs: async () => ({ keys: [jwk] }), token };
}
const good = (over = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, email: 'Fan@Example.com', email_verified: true, name: 'Fan One', exp: Math.floor(Date.now() / 1000) + 600, ...over });

function setup(over = {}) {
  const mails = [];
  const env = {
    ACCOUNTS_DB: fakeD1(), NRN_ACCOUNT_SECRET: SECRET, GOOGLE_CLIENT_ID: CLIENT, RESEND_API_KEY: 're_test',
    __fetch: async (url, init) => { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); },
    ...over,
  };
  const call = (path, { method = 'GET', body, cookie, origin, host = 'www.nrnszn.com' } = {}) => {
    const headers = {}; if (cookie) headers.cookie = cookie; if (origin) headers.origin = origin; if (body !== undefined) headers['content-type'] = 'application/json';
    return accountRequest({ request: new Request(`https://${host}/api/account/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, params: { path: path.split('?')[0].split('/') } });
  };
  return { env, call, mails };
}
const cookieOf = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).find((c) => c && c.startsWith(`${COOKIE}=`) && !c.includes('Max-Age=0'));
const pair = (c) => c.split(';')[0];

test('switched off until the database AND a long secret exist; it says so plainly', async () => {
  for (const over of [{ ACCOUNTS_DB: undefined }, { NRN_ACCOUNT_SECRET: '' }, { NRN_ACCOUNT_SECRET: 'short' }]) {
    const { call } = setup(over);
    const me = await (await call('me')).json();
    assert.equal(me.on, false); assert.equal(me.user, null);
    assert.equal((await call('email', { method: 'POST', body: { email: 'a@b.co' } })).status, 503);
  }
});

test('the cookie covers every nrnszn.com site, is HttpOnly + Secure + Lax, and only on the real domain', async () => {
  assert.equal(cookieDomain('www.nrnszn.com'), 'nrnszn.com'); assert.equal(cookieDomain('nrnszn.com'), 'nrnszn.com'); assert.equal(cookieDomain('play.nrnszn.com:443'), 'nrnszn.com');
  for (const h of ['nrnszn-app.pages.dev', 'localhost', 'evilnrnszn.com', 'nrnszn.com.evil.io']) assert.equal(cookieDomain(h), '', h);
  const c = await sessionCookie({ NRN_ACCOUNT_SECRET: SECRET }, 'u1', 'www.nrnszn.com');
  assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/); assert.match(c, /Domain=nrnszn\.com/); assert.match(c, /Max-Age=15552000/);
  assert.doesNotMatch(await sessionCookie({ NRN_ACCOUNT_SECRET: SECRET }, 'u1', 'x.pages.dev'), /Domain=/);
});

test('a cookie is only believed with the right signature and before it expires', async () => {
  const env = { ACCOUNTS_DB: fakeD1(), NRN_ACCOUNT_SECRET: SECRET };
  const v = pair(await sessionCookie(env, 'user-1', 'www.nrnszn.com'));
  const req = (cookie) => new Request('https://www.nrnszn.com/', { headers: { cookie } });
  assert.equal(await sessionUserId(req(v), env), 'user-1');
  assert.equal(await sessionUserId(req(`other=1; ${v}`), env), 'user-1');
  assert.equal(await sessionUserId(req(v.replace('user-1', 'user-2')), env), null, 'someone else\'s id with my signature');
  assert.equal(await sessionUserId(req(v), { ...env, NRN_ACCOUNT_SECRET: SECRET + 'x' }), null, 'a changed secret signs everyone out');
  assert.equal(await sessionUserId(req(v), env, Date.now() + 181 * 86400_000), null, 'expired');
  assert.equal(await sessionUserId(req(`${COOKIE}=garbage`), env), null);
  assert.equal(await sessionUserId(req(`${COOKIE}=bad.1.x; ${v}`), env), 'user-1', 'a stale cookie next to a good one does not block it');
});

test('Google sign-in: a real token signs in (account made once, by e-mail); forged, wrong-audience, expired or unverified ones do not', async () => {
  const g = await googleKit(), { call, env } = setup({ __googleCerts: undefined });
  env.__googleCerts = g.certs;
  const res = await call('google', { method: 'POST', body: { credential: await g.token(good()), return: '/account' }, origin: 'https://www.nrnszn.com' });
  assert.equal(res.status, 200);
  const j = await res.json(); assert.equal(j.user.email, 'fan@example.com'); assert.equal(j.user.name, 'Fan One'); assert.equal(j.next, '/account');
  const c = cookieOf(res); assert.ok(c);
  const me = await (await call('me', { cookie: pair(c) })).json(); assert.equal(me.user.email, 'fan@example.com');
  await call('google', { method: 'POST', body: { credential: await g.token(good({ email: 'fan@example.com' })) } });
  assert.equal((await env.ACCOUNTS_DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 1, 'same person, one account');
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  for (const bad of [
    await g.token(good(), { key: other.privateKey }), await g.token(good({ aud: 'someone-else' })), await g.token(good({ exp: 1 })),
    await g.token(good({ email_verified: false })), await g.token(good({ iss: 'https://evil.example' })), await g.token(good(), { kid: 'nope' }), 'not.a.token', '',
  ]) assert.equal((await call('google', { method: 'POST', body: { credential: bad } })).status, 401);
});

test('sign-in requests from another site are refused (no signing people in from someone else\'s page)', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  assert.equal((await call('google', { method: 'POST', origin: 'https://evil.example', body: { credential: await g.token(good()) } })).status, 403);
  assert.equal((await call('email', { method: 'POST', origin: 'https://play.nrnszn.com', body: { email: 'a@b.co' } })).status, 403);
});

test('e-mail link: sent once, works once for 30 minutes, signs in and goes back where the person came from', async () => {
  const { call, mails, env } = setup();
  const r = await call('email', { method: 'POST', body: { email: ' New@Fan.com ', return: 'https://luoh.nrnszn.com/' } });
  assert.equal(r.status, 200); assert.equal(mails.length, 1); assert.equal(mails[0].to, 'new@fan.com');
  assert.match(mails[0].from, /mail\.nrnszn\.com/);
  const link = mails[0].text.match(/https:\/\/\S+/)[0], t = new URL(link).searchParams.get('t');
  assert.ok(!JSON.stringify(await env.ACCOUNTS_DB.prepare('SELECT * FROM login_links').all()).includes(t), 'only a hash of the link is stored');
  const v = await call(`verify?t=${t}`);
  assert.equal(v.status, 303); assert.equal(v.headers.get('location'), 'https://luoh.nrnszn.com/'); assert.ok(cookieOf(v));
  const again = await call(`verify?t=${t}`); assert.equal(again.headers.get('location'), '/account?expired=1'); assert.equal(cookieOf(again), undefined);
  assert.equal((await call('verify?t=made-up')).headers.get('location'), '/account?expired=1');
});

test('e-mail link limits: 3 per address per 10 minutes, and a daily total so the shared Resend allowance is kept', async () => {
  const { call, mails, env } = setup();
  for (let i = 0; i < 3; i++) assert.equal((await call('email', { method: 'POST', body: { email: 'x@y.co' } })).status, 200);
  assert.equal((await call('email', { method: 'POST', body: { email: 'x@y.co' } })).status, 429);
  const now = Date.now(), db = env.ACCOUNTS_DB;
  for (let i = 0; i < LINKS_PER_DAY; i++) await db.prepare('INSERT INTO login_links (token_hash, email, marketing, created_at, expires_at) VALUES (?, ?, 0, ?, ?)').bind(`h${i}`, `p${i}@q.co`, now - 1000, now).run();
  const r = await call('email', { method: 'POST', body: { email: 'fresh@person.co' } });
  assert.equal(r.status, 429); assert.match((await r.json()).message, /Google/);
  assert.equal(mails.length, 3);
  assert.equal((await call('email', { method: 'POST', body: { email: 'not an email' } })).status, 400);
});

test('where a sign-in may return: this site, the NuRenaissance sites and soulnicolas.com only', () => {
  for (const ok of ['/account', '/apps', 'https://play.nrnszn.com/', 'https://directory.nrnszn.com/#settings', 'https://luoh.nrnszn.com/x', 'https://soulnicolas.com/vault']) assert.equal(safeReturn(ok), ok);
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com/', 'http://play.nrnszn.com/', 'https://play.nrnszn.com.evil.com/', 'javascript:alert(1)', 'https://user:pw@play.nrnszn.com/', '', undefined]) assert.equal(safeReturn(bad), '/account', String(bad));
});

test('who is signed in can be read by the NuRenaissance sites only, and never the money', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  await saveProject(await accountsDb(env), { email: 'fan@example.com', title: 'Music video', total: '500' });
  const play = await call('me?projects=1', { cookie: c, origin: 'https://play.nrnszn.com' });
  assert.equal(play.headers.get('access-control-allow-origin'), 'https://play.nrnszn.com'); assert.equal(play.headers.get('access-control-allow-credentials'), 'true');
  const pj = await play.json(); assert.equal(pj.user.email, 'fan@example.com'); assert.equal(pj.projects, undefined, 'another site never gets the projects');
  const sv = await call('me', { origin: 'https://soulnicolas.com' });
  assert.equal(sv.headers.get('access-control-allow-origin'), 'https://soulnicolas.com'); assert.equal(sv.headers.get('access-control-allow-credentials'), null, 'soulnicolas.com reads on/off only');
  const evil = await call('me', { cookie: c, origin: 'https://evil.example' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const own = await (await call('me?projects=1', { cookie: c })).json();
  assert.equal(own.projects.length, 1); assert.equal(own.projects[0].balance, 50000);
});

test('soulnicolas.com hop: a one-time ticket for that site only, 2 minutes, traded once', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  const out = await call('connect?return=' + encodeURIComponent('https://soulnicolas.com/vault'), { cookie: c });
  const loc = new URL(out.headers.get('location')); assert.equal(loc.origin, 'https://soulnicolas.com'); assert.equal(loc.pathname, '/vault');
  const ticket = new URLSearchParams(loc.hash.slice(1)).get('nrn_ticket'); assert.ok(ticket && ticket.length > 30);
  assert.equal((await call('redeem', { method: 'POST', origin: 'https://evil.example', body: { ticket } })).status, 400, 'another site cannot use it');
  const r = await call('redeem', { method: 'POST', origin: 'https://soulnicolas.com', body: { ticket } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://soulnicolas.com');
  const rj = await r.json(); assert.deepEqual(Object.keys(rj.user).sort(), ['email', 'id', 'name', 'since']); assert.match(rj.token, /^a1\./, 'soulnicolas.com also gets an app token');
  assert.equal((await call('redeem', { method: 'POST', origin: 'https://soulnicolas.com', body: { ticket } })).status, 400, 'only once');
  const signedOut = await call('connect?return=' + encodeURIComponent('https://soulnicolas.com/'));
  assert.equal(signedOut.headers.get('location'), '/account?return=' + encodeURIComponent('https://soulnicolas.com/'));
  const nrn = await call('connect?return=' + encodeURIComponent('https://play.nrnszn.com/'), { cookie: c });
  assert.equal(nrn.headers.get('location'), 'https://play.nrnszn.com/', 'nrnszn sites need no ticket (the cookie is shared)');
  const late = new URL((await call('connect?return=' + encodeURIComponent('https://soulnicolas.com/'), { cookie: c })).headers.get('location')).hash.split('=')[1];
  await env.ACCOUNTS_DB.prepare('UPDATE account_tickets SET expires_at = 1').run();
  assert.equal((await call('redeem', { method: 'POST', origin: 'https://soulnicolas.com', body: { ticket: late } })).status, 400, 'expired');
});

test('sign out clears both the domain cookie and any old host-only one; delete needs the e-mail typed', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  const out = await call('logout', { method: 'POST', body: {} });
  const set = out.headers.getSetCookie(); assert.equal(set.length, 2); assert.ok(set.every((x) => /Max-Age=0/.test(x))); assert.ok(set.some((x) => /Domain=nrnszn\.com/.test(x)));
  assert.equal((await call('delete', { method: 'POST', cookie: c, body: { confirm: 'wrong@x.co' } })).status, 400);
  assert.equal((await call('delete', { method: 'POST', cookie: c, body: { confirm: 'FAN@example.com' } })).status, 200);
  assert.equal((await env.ACCOUNTS_DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 0);
  assert.equal((await (await call('me', { cookie: c })).json()).user, null);
});

test('client projects: totals, payments and balance; bad input is refused in plain words', async () => {
  const db = await accountsDb({ ACCOUNTS_DB: fakeD1() });
  assert.equal((await saveProject(db, { email: 'nope', title: 'x', total: 1 })).ok, false);
  assert.equal((await saveProject(db, { email: 'c@d.co', title: '', total: 1 })).ok, false);
  assert.equal((await saveProject(db, { email: 'c@d.co', title: 'x', total: 'lots' })).ok, false);
  assert.equal((await saveProject(db, { email: 'c@d.co', title: 'x', total: 1, link: 'javascript:alert(1)' })).ok, false);
  assert.equal((await saveProject(db, { email: 'c@d.co', title: 'x', total: 1, due: '2026-02-31x' })).ok, false);
  const a = await saveProject(db, { email: 'C@D.co', clientName: 'Client', title: 'EP mix', service: 'Mixing', status: 'in-progress', total: '$1,200.50', due: '2026-12-01' });
  assert.equal(a.ok, true);
  assert.equal((await addPayment(db, { projectId: a.id, amount: 200, method: 'cash-app', paidOn: '2026-11-01' })).ok, true);
  assert.equal((await addPayment(db, { projectId: a.id, amount: '100.25', method: 'made-up' })).ok, true);
  assert.equal((await addPayment(db, { projectId: 'missing', amount: 5 })).ok, false);
  assert.equal((await addPayment(db, { projectId: a.id, amount: 0 })).ok, false);
  const [p] = await projectsFor(db, 'c@d.co');
  assert.equal(p.total, 120050); assert.equal(p.paid, 30025); assert.equal(p.balance, 90025); assert.equal(p.statusLabel, 'In progress');
  assert.equal(p.payments.length, 2); assert.ok(p.payments.some((x) => x.method === 'other'));
  assert.equal(p.email, undefined, 'the client view does not repeat admin-only fields');
  await saveProject(db, { email: 'e@f.co', title: 'Done one', total: 50, status: 'done' });
  const all = await allProjects(db);
  assert.equal(all.totals.projects, 2); assert.equal(all.totals.open, 1); assert.equal(all.totals.owed, 90025 + 5000);
  assert.deepEqual(await projectsFor(db, 'someone@else.co'), []);
});

test('/admin: the Clients folder needs the owner sign-in, and the checklist lists the account settings', async () => {
  const env = { ADMIN_PASSWORD: 'correct horse battery staple', ACCOUNTS_DB: fakeD1(), NRN_ACCOUNT_SECRET: SECRET };
  const token = await makeToken(env);
  const req = (method, body, auth = token, q = '') => ({ request: new Request(`https://www.nrnszn.com/api/admin${q}`, { method, body: body ? JSON.stringify(body) : undefined, headers: auth ? { authorization: `Bearer ${auth}` } : {} }), env });
  assert.equal((await adminGet(req('GET', null, 'bad', '?section=clients'))).status, 401);
  const saved = await (await adminPost(req('POST', { action: 'client-save', project: { email: 'k@l.co', title: 'Shoot', total: 300 } }))).json();
  assert.equal(saved.ok, true);
  assert.equal((await (await adminPost(req('POST', { action: 'client-pay', payment: { projectId: saved.id, amount: 100, method: 'zelle' } }))).json()).ok, true);
  const list = await (await adminGet(req('GET', null, token, '?section=clients'))).json();
  assert.equal(list.projects[0].balance, 20000); assert.equal(list.projects[0].hasAccount, false);
  assert.equal((await (await adminPost(req('POST', { action: 'client-delete', id: saved.id }))).json()).ok, true);
  assert.equal((await (await adminGet(req('GET', null, token, '?section=clients'))).json()).projects.length, 0);
  const names = setupChecklist(env).flatMap((g) => g.items).filter((i) => ['ACCOUNTS_DB', 'NRN_ACCOUNT_SECRET', 'GOOGLE_CLIENT_ID'].includes(i.name)).map((i) => i.present);
  assert.deepEqual(names, [true, true, false]);
  assert.equal((await adminGet({ request: new Request('https://x/api/admin?section=clients', { headers: { authorization: `Bearer ${token}` } }), env: { ADMIN_PASSWORD: env.ADMIN_PASSWORD } })).status, 503);
});

test('/admin: forgot the password? An account on ADMIN_EMAILS gets in; anyone else, or a signed-out visitor, or another site, does not', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  Object.assign(env, { ADMIN_PASSWORD: 'correct horse battery staple', ADMIN_EMAILS: 'Owner@Example.com, other@x.co' });
  const signIn = async (email) => pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good({ email })) } })));
  const door = (cookie, origin) => adminPost({ request: new Request('https://www.nrnszn.com/api/admin', { method: 'POST', body: JSON.stringify({ action: 'account-login' }), headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }), env });
  assert.equal((await (await adminGet({ request: new Request('https://www.nrnszn.com/api/admin'), env })).json()).accountLogin, true);
  const owner = await signIn('owner@example.com');
  const ok = await (await door(owner)).json(); assert.equal(ok.ok, true);
  const dash = await adminGet({ request: new Request('https://www.nrnszn.com/api/admin', { headers: { authorization: `Bearer ${ok.token}` } }), env });
  assert.equal((await dash.json()).signedIn, true, 'the token works like a password sign-in');
  assert.equal((await door(await signIn('fan@example.com'))).status, 403, 'not on the list');
  assert.equal((await door(null)).status, 401, 'signed out');
  assert.equal((await door(owner, 'https://evil.example')).status, 403, 'another site');
  assert.equal((await door(owner.replace(/\.[\w-]+$/, '.forged'))).status, 401, 'forged cookie');
  const noList = await adminPost({ request: new Request('https://www.nrnszn.com/api/admin', { method: 'POST', body: JSON.stringify({ action: 'account-login' }), headers: { cookie: owner } }), env: { ...env, ADMIN_EMAILS: '' } });
  assert.equal(noList.status, 503, 'off until ADMIN_EMAILS exists');
  assert.equal((await (await adminGet({ request: new Request('https://www.nrnszn.com/api/admin'), env: { ...env, ADMIN_EMAILS: '' } })).json()).accountLogin, false);
});


test('tickets for our own sites\' backends: only from a NuRenaissance site with the cookie; the backend trades it once with that Origin and learns the account id', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  assert.equal((await call('ticket', { method: 'POST', body: {}, origin: 'https://play.nrnszn.com' })).status, 401, 'signed out');
  assert.equal((await call('ticket', { method: 'POST', body: {}, cookie: c, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('ticket', { method: 'POST', body: {}, cookie: c })).status, 403, 'no Origin: refused');
  const t = await call('ticket', { method: 'POST', body: {}, cookie: c, origin: 'https://play.nrnszn.com' });
  assert.equal(t.headers.get('access-control-allow-origin'), 'https://play.nrnszn.com');
  const { ticket } = await t.json();
  assert.equal((await call('redeem', { method: 'POST', origin: 'https://directory.nrnszn.com', body: { ticket } })).status, 400, 'bound to the site it was made for');
  const r = await (await call('redeem', { method: 'POST', origin: 'https://play.nrnszn.com', body: { ticket } })).json();
  assert.equal(r.user.email, 'fan@example.com'); assert.ok(r.user.id); assert.equal(r.token, undefined, 'our own sites get no app token');
  assert.equal((await call('redeem', { method: 'POST', origin: 'https://play.nrnszn.com', body: { ticket } })).status, 400, 'once');
});

test('saved items: the cookie on our sites, an app token on soulnicolas.com; each person sees only their own; bad items and floods refused', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const a = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  const b = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good({ email: 'other@x.co' })) } })));
  const save = (cookie, item, origin = 'https://directory.nrnszn.com', auth) => accountRequest({ request: new Request('https://www.nrnszn.com/api/account/saved', { method: 'POST', body: JSON.stringify(item), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(auth ? { authorization: auth } : {}) } }), env, params: { path: ['saved'] } });
  const list = async (cookie, app, origin = 'https://directory.nrnszn.com', auth) => (await accountRequest({ request: new Request(`https://www.nrnszn.com/api/account/saved?app=${app}`, { headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(auth ? { authorization: auth } : {}) } }), env, params: { path: ['saved'] } })).json();
  assert.equal((await save(a, { app: 'directory', kind: 'listing', id: 'shows:1b2c', title: 'Open mic', url: 'https://directory.nrnszn.com/#x', on: true })).status, 200);
  assert.equal((await list(a, 'directory')).items.length, 1);
  assert.equal((await list(b, 'directory')).items.length, 0, 'not shared between people');
  assert.equal((await save(a, { app: 'directory', kind: 'listing', id: 'shows:1b2c', on: false })).status, 200);
  assert.equal((await list(a, 'directory')).items.length, 0);
  for (const bad of [{ app: 'evil', kind: 'listing', id: 'x', on: true }, { app: 'directory', kind: 'song', id: 'x', on: true }, { app: 'directory', kind: 'listing', id: '<script>', on: true }, { app: 'directory', kind: 'listing', id: 'x', url: 'javascript:alert(1)', on: true }]) assert.equal((await save(a, bad)).status, 400, JSON.stringify(bad));
  assert.equal((await save(a, { app: 'directory', kind: 'listing', id: 'x', on: true }, 'https://evil.example')).status, 401, 'another site cannot use the cookie');
  assert.equal((await save(null, { app: 'vault', kind: 'song', id: 't1', on: true }, 'https://soulnicolas.com')).status, 401);
  // soulnicolas.com: sign in through the hop, get an app token, save a liked song with it
  const loc = new URL((await call('connect?return=' + encodeURIComponent('https://soulnicolas.com/'), { cookie: a })).headers.get('location'));
  const red = await (await call('redeem', { method: 'POST', origin: 'https://soulnicolas.com', body: { ticket: loc.hash.split('=')[1] } })).json();
  const bearer = 'Bearer ' + red.token;
  assert.equal((await save(null, { app: 'vault', kind: 'song', id: 'trk_12', title: 'SIN CITY', on: true }, 'https://soulnicolas.com', bearer)).status, 200);
  assert.equal((await list(null, 'vault', 'https://soulnicolas.com', bearer)).items[0].title, 'SIN CITY');
  assert.equal((await save(null, { app: 'vault', kind: 'song', id: 'trk_13', on: true }, 'https://evil.example', bearer)).status, 401, 'the token only works from soulnicolas.com');
  assert.equal((await save(null, { app: 'vault', kind: 'song', id: 'trk_13', on: true }, 'https://soulnicolas.com', bearer.slice(0, -2) + 'xx')).status, 401, 'forged token');
  const me = await (await accountRequest({ request: new Request('https://www.nrnszn.com/api/account/me', { headers: { origin: 'https://soulnicolas.com', authorization: bearer } }), env, params: { path: ['me'] } })).json();
  assert.equal(me.user.email, 'fan@example.com', 'the token also answers who is signed in');
  const db = env.ACCOUNTS_DB;
  for (let i = 0; i < SAVED_MAX; i++) await db.prepare("INSERT INTO account_saved (user_id, app, kind, item_id, created_at) SELECT id, 'directory', 'listing', ?, 1 FROM users WHERE email = 'other@x.co'").bind('i' + i).run();
  assert.equal((await save(b, { app: 'directory', kind: 'listing', id: 'one-more', on: true })).status, 400, 'capped');
  assert.equal((await call('delete', { method: 'POST', cookie: a, body: { confirm: 'fan@example.com' } })).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM account_saved WHERE item_id = 'trk_12'").first()).n, 0, 'deleting the account deletes what it saved');
});

test('a Services request sent while signed in shows in Your projects as Quote requested (once), under the account e-mail; signed out or from another site, nothing', async () => {
  const { recordRequest, projectsFor } = await import('../src/edge/accounts.js');
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  const req = (cookie, origin) => new Request('https://www.nrnszn.com/api/service-lead', { method: 'POST', headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } });
  const body = JSON.stringify({ action: 'lead', name: 'Someone', email: 'typed@else.co', role: 'Artist', summary: 'Music video + photos', total: 850 });
  assert.ok(await recordRequest(req(c), env, body));
  await recordRequest(req(c), env, body);   // a double tap
  assert.equal(await recordRequest(req(null), env, body), null);
  assert.equal(await recordRequest(req(c, 'https://evil.example'), env, body), null);
  const list = await projectsFor(await accountsDb(env), 'fan@example.com');
  assert.equal(list.length, 1); assert.equal(list[0].status, 'requested'); assert.equal(list[0].statusLabel, 'Quote requested'); assert.equal(list[0].total, 85000); assert.equal(list[0].title, 'Music video + photos');
});

test('the sign-in e-mail: branded, the link in the button and written out (escaped), a plain-text copy, and who sent it', async () => {
  const { signInEmail } = await import('../src/edge/accounts.js');
  const m = signInEmail('https://www.nrnszn.com/api/account/verify?t=abc&x=<b>"', 'https://www.nrnszn.com');
  assert.equal(m.subject, 'Sign in to NuRenaissance');
  assert.ok(m.html.includes('https://www.nrnszn.com/email/mascot.png'), 'the logo is a PNG on the site');
  assert.ok(!m.html.includes('<b>"'), 'the link is escaped'); assert.equal((m.html.match(/verify\?t=abc&amp;x=&lt;b&gt;&quot;/g) || []).length, 3, 'button href, written-out href and text');
  assert.match(m.text, /verify\?t=abc/); assert.match(m.text, /30 minutes/); assert.match(m.html, /NuRenaissance Media · Nashville/);
  assert.equal(signInEmail('x', 'javascript:alert(1)').html.includes('javascript:'), false, 'a strange origin is never used');
});


test('NuDirectory My listings goes through this server: cookie + the directory\'s Origin only; the call carries the public key and a fresh ticket the function can trade', async () => {
  const g = await googleKit(), seen = [], { call, env } = setup(); env.__googleCerts = g.certs;
  const mailFetch = env.__fetch;
  env.__fetch = async (url, init) => {
    if (String(url).includes('resend')) return mailFetch(url, init);
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, listings: [{ title: 'Jo: Open mic', status: 'Live' }] }), { status: 200 });
  };
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  assert.equal((await call('listings', { method: 'POST', body: { action: 'mine' }, origin: 'https://directory.nrnszn.com' })).status, 401, 'signed out');
  assert.equal((await call('listings', { method: 'POST', body: { action: 'mine' }, cookie: c, origin: 'https://play.nrnszn.com' })).status, 403, 'only the directory asks');
  const r = await call('listings', { method: 'POST', body: { action: 'mine' }, cookie: c, origin: 'https://directory.nrnszn.com' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://directory.nrnszn.com');
  assert.equal((await r.json()).listings[0].status, 'Live');
  assert.match(seen[0].url, /functions\/v1\/nu-account$/); assert.match(seen[0].headers.apikey, /^sb_publishable_/); assert.equal(seen[0].headers.origin, 'https://directory.nrnszn.com');
  const back = await (await call('redeem', { method: 'POST', origin: 'https://directory.nrnszn.com', body: { ticket: seen[0].body.ticket } })).json();
  assert.equal(back.user.email, 'fan@example.com', 'the ticket it sent is one the function can trade for the e-mail');
  await call('listings', { method: 'POST', body: { action: 'claim', table: 'shows', id: '00000000-0000-4000-8000-000000000001' }, cookie: c, origin: 'https://directory.nrnszn.com' });
  assert.deepEqual([seen[1].body.action, seen[1].body.table], ['claim', 'shows']);
  assert.equal((await call('listings', { method: 'POST', body: { action: 'drop' }, cookie: c, origin: 'https://directory.nrnszn.com' })).status, 400);
});

test('the dashboard: me?projects=1 adds saved items and luoh projects (names only); Passport and My listings are read from the Account page only', async () => {
  const g = await googleKit(), seen = [], { call, env } = setup(); env.__googleCerts = g.certs;
  const mailFetch = env.__fetch;
  env.__fetch = async (url, init) => {
    if (String(url).includes('resend')) return mailFetch(url, init);
    const body = JSON.parse(init.body); seen.push({ url: String(url), headers: init.headers, body });
    if (String(url).includes('/widget')) {
      // what Certified does: trade the ticket at /redeem as play.nrnszn.com, then answer with the stamps
      const r = await (await call('redeem', { method: 'POST', origin: 'https://play.nrnszn.com', body: { ticket: body.ticket } })).json();
      return new Response(JSON.stringify(r.ok ? { ok: true, linked: true, stamps: [{ day: '2025-11-08', method: 'game' }, { day: 'nope', method: 'x' }], today: { day: '2026-12-05', open: false } } : { ok: false, error: 'sign in again' }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, listings: [{ title: 'Jo: Open mic', status: 'Live' }] }), { status: 200 });
  };
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  await call('saved', { method: 'POST', cookie: c, origin: 'https://www.nrnszn.com', body: { app: 'vault', kind: 'song', id: 'trk_1', title: 'SIN CITY', url: '/vault/2024-x', on: true } });
  const db = await accountsDb(env), uid = (await db.prepare('SELECT id FROM users').first()).id;
  await db.prepare('INSERT INTO projects (user_id, id, name, updated_at, data) VALUES (?, ?, ?, ?, ?)').bind(uid, 'p1', 'Lounge recap', 5, '{"secret":"edit"}').run();
  const me = await (await call('me?projects=1', { cookie: c })).json();
  assert.equal(me.saved.vault[0].title, 'SIN CITY'); assert.deepEqual(me.saved.directory, []);
  assert.deepEqual(me.luoh, { count: 1, recent: [{ id: 'p1', name: 'Lounge recap', at: 5 }] });
  assert.equal(JSON.stringify(me).includes('secret'), false, 'the luoh edit itself is never sent');
  const other = await (await call('me?projects=1', { cookie: c, origin: 'https://play.nrnszn.com' })).json();
  assert.equal(other.saved, undefined, 'another site never gets the dashboard data');

  assert.equal((await call('passport', { method: 'POST', body: {}, origin: 'https://www.nrnszn.com' })).status, 401, 'signed out');
  assert.equal((await call('passport', { method: 'POST', body: {}, cookie: c, origin: 'https://play.nrnszn.com' })).status, 403, 'only the Account page asks');
  const p = await (await call('passport', { method: 'POST', body: {}, cookie: c, origin: 'https://www.nrnszn.com' })).json();
  assert.equal(p.ok, true); assert.deepEqual(p.stamps, [{ day: '2025-11-08', method: 'game' }], 'odd rows from Certified are dropped');
  const w = seen.find((x) => x.url.includes('/widget'));
  assert.equal(w.body.action, 'passport_account'); assert.match(w.headers.apikey, /^sb_publishable_/);

  const l = await call('listings', { method: 'POST', body: { action: 'mine' }, cookie: c, origin: 'https://www.nrnszn.com' });
  assert.equal(l.status, 200); assert.equal((await l.json()).listings[0].status, 'Live');
  assert.equal((await call('listings', { method: 'POST', body: { action: 'claim', table: 'shows', id: '00000000-0000-4000-8000-000000000001' }, cookie: c, origin: 'https://www.nrnszn.com' })).status, 403, 'the Account page may only read');
});

test('profile picture: real JPEG/PNG/WebP bytes only, a size cap, served back only to its owner, gone with the account', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  assert.equal((await call('avatar', { method: 'POST', body: { image: jpeg } })).status, 401, 'signed out');
  assert.equal((await call('avatar', { method: 'POST', body: { image: jpeg }, cookie: c, origin: 'https://play.nrnszn.com' })).status, 403, 'not from another site');
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + Buffer.from('<html>').toString('base64'), 'javascript:alert(1)', 'data:image/png;base64,' + Buffer.alloc(200_000, 1).toString('base64')])
    assert.equal((await call('avatar', { method: 'POST', body: { image: bad }, cookie: c })).status, 400, bad.slice(0, 30));
  const ok = await (await call('avatar', { method: 'POST', body: { image: jpeg }, cookie: c })).json();
  assert.equal(ok.ok, true); assert.equal(typeof ok.avatar, 'number');
  assert.equal((await (await call('me?projects=1', { cookie: c })).json()).avatar, ok.avatar);
  const pic = await call('avatar', { cookie: c });
  assert.equal(pic.headers.get('content-type'), 'image/jpeg'); assert.equal(pic.headers.get('x-content-type-options'), 'nosniff'); assert.match(pic.headers.get('cache-control'), /private/);
  assert.deepEqual([...new Uint8Array(await pic.arrayBuffer())], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  assert.equal((await call('avatar')).status, 404, 'nobody else gets it');
  assert.equal((await call('avatar', { cookie: c, origin: 'https://evil.example' })).status, 404);
  await call('avatar', { method: 'POST', body: { image: null }, cookie: c });
  assert.equal((await call('avatar', { cookie: c })).status, 404, 'removed');
  await call('avatar', { method: 'POST', body: { image: jpeg }, cookie: c });
  await call('delete', { method: 'POST', body: { confirm: 'fan@example.com' }, cookie: c });
  assert.equal((await (await accountsDb(env)).prepare('SELECT COUNT(*) AS n FROM account_avatars').first()).n, 0, 'deleting the account deletes the picture');
});

test('a saved luoh project can be removed from the Account page: only your own, only from this site', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const c = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  const db = await accountsDb(env), uid = (await db.prepare('SELECT id FROM users').first()).id;
  for (const [u, id] of [[uid, 'p1'], [uid, 'p2'], ['someone-else', 'p1']]) await db.prepare('INSERT INTO projects (user_id, id, name, updated_at, data) VALUES (?, ?, ?, ?, ?)').bind(u, id, id, 1, '{}').run();
  assert.equal((await call('luoh-delete', { method: 'POST', body: { id: 'p1' } })).status, 401, 'signed out');
  assert.equal((await call('luoh-delete', { method: 'POST', body: { id: 'p1' }, cookie: c, origin: 'https://evil.example' })).status, 403, 'not from another site');
  const r = await (await call('luoh-delete', { method: 'POST', body: { id: 'p1' }, cookie: c })).json();
  assert.equal(r.ok, true); assert.deepEqual(r.luoh.recent.map((x) => x.id), ['p2']);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = 'someone-else'").first()).n, 1, "someone else's project with the same id is untouched");
});

test('"Download my data": only the signed-in person, only from this site, only their own things, and no secrets', async () => {
  const g = await googleKit(), { call, env } = setup(); env.__googleCerts = g.certs;
  const a = pair(cookieOf(await call('google', { method: 'POST', body: { credential: await g.token(good()) } })));
  await call('google', { method: 'POST', body: { credential: await g.token(good({ email: 'other@x.co' })) } });
  const db = await accountsDb(env), me = await db.prepare("SELECT id, email FROM users WHERE email != 'other@x.co'").first();
  for (const [u, id, data] of [[me.id, 'p1', '{"shots":[1,2]}'], ['someone-else', 'p9', '{"secret":"theirs"}']]) await db.prepare('INSERT INTO projects (user_id, id, name, updated_at, data) VALUES (?, ?, ?, ?, ?)').bind(u, id, id, 1, data).run();
  await accountRequest({ request: new Request('https://www.nrnszn.com/api/account/saved', { method: 'POST', body: JSON.stringify({ app: 'vault', kind: 'song', id: 't1', title: 'A song', on: true }), headers: { cookie: a, origin: 'https://www.nrnszn.com', 'content-type': 'application/json' } }), env, params: { path: ['saved'] } });

  assert.equal((await call('export', { method: 'POST', body: {} })).status, 401, 'signed out');
  assert.equal((await call('export', { method: 'POST', body: {}, cookie: a, origin: 'https://evil.example' })).status, 403, 'not from another site');
  assert.equal((await call('export', { method: 'POST', body: {}, cookie: a, origin: 'https://play.nrnszn.com' })).status, 403, 'not even from our other sites: the page itself only');
  const res = await call('export', { method: 'POST', body: {}, cookie: a });
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
  const out = await res.json(), d = out.data;
  assert.equal(out.ok, true); assert.equal(d.account.email, me.email);
  assert.deepEqual(d.luohProjects.map((p) => p.id), ['p1']); assert.equal(d.luohProjects[0].edits, '{"shots":[1,2]}');
  assert.deepEqual(d.savedItems.vault.map((s) => s.id), ['t1']); assert.deepEqual(d.savedItems.directory, []);
  assert.ok(d.exportedAt && Array.isArray(d.payments) && Array.isArray(d.clientProjects) && Array.isArray(d.notes));
  const text = JSON.stringify(out);
  for (const secret of ['theirs', 'other@x.co', 'someone-else', 'NRN_ACCOUNT_SECRET']) assert.ok(!text.includes(secret), 'must not contain: ' + secret);
  assert.ok(!/token|password|secret/i.test(Object.keys(d.account).join(',')), 'the account block has no credential fields');
});
