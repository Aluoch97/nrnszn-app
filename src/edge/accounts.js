// One NuRenaissance account for every app (Nov 2026, Nick: "sign in to all the apps").
//
// Where the accounts live: luoh's existing accounts database (Cloudflare D1), bound to THIS project too as `ACCOUNTS_DB`.
// So everyone who already has a luoh account already has a NuRenaissance account (matched by e-mail), nothing is copied.
// The tables `users` and `login_links` are luoh's own (same columns, made here only if they do not exist yet); this file adds
// `client_projects` / `client_payments` (Nick's client work, managed in /admin) and `account_tickets` (the sign-in hop for
// soulnicolas.com, which cannot share a cookie with nrnszn.com).
//
// How "signed in everywhere" works:
//   * nrnszn.com and its sub-sites (play., directory., luoh., podi.) share ONE cookie `nrn_session` set on the whole domain
//     (`Domain=nrnszn.com`, HttpOnly, Secure, SameSite=Lax). It holds `<account id>.<expiry>.<signature>`, signed with the Cloudflare
//     secret NRN_ACCOUNT_SECRET, which must be the same value in the nrnszn and luoh projects (luoh reads the same cookie).
//   * Static apps on the domain (Certified, NuDirectory) ask `GET https://www.nrnszn.com/api/account/me` with credentials; the answer
//     carries CORS headers ONLY for the NuRenaissance sites in ORIGINS.
//   * soulnicolas.com is a different site, so it goes through a hop: /api/account/connect?return=<soulnicolas address> sends the
//     visitor back with `#nrn_ticket=<one-time ticket>` (2 minutes), and the page trades it once at POST /api/account/redeem.
//
// Sign-in ways: Google (the ID token is checked here: signature against Google's keys, audience = GOOGLE_CLIENT_ID, issuer, expiry,
// verified e-mail) and a one-time e-mail link (30 minutes, stored hashed, through Resend). E-mail is capped so the shared Resend
// free tier (100 a day, also used by NuDirectory and the newsletters) is never used up by sign-ins: 3 links per address per 10 minutes,
// LINKS_PER_DAY in total per 24 hours (luoh's links count too, they are in the same table).

export const COOKIE = 'nrn_session';
export const DAYS = 180;
export const LINK_MINUTES = 30;
export const LINKS_PER_DAY = 40;
export const TICKET_MS = 2 * 60 * 1000;

// Sites that may read who is signed in (CORS) and that a sign-in may return to. Exact https origins only.
export const ORIGINS = [
  'https://www.nrnszn.com', 'https://nrnszn.com', 'https://app.nrnszn.com', 'https://play.nrnszn.com', 'https://directory.nrnszn.com',
  'https://luoh.nrnszn.com', 'https://podi.nrnszn.com',
];
// Other sites: they get a one-time ticket instead of the cookie.
export const TICKET_ORIGINS = ['https://soulnicolas.com', 'https://www.soulnicolas.com', 'https://app.soulnicolas.com'];

export const STATUSES = ['quote', 'booked', 'in-progress', 'review', 'done', 'paused', 'cancelled'];
export const STATUS_LABEL = { quote: 'Quote sent', booked: 'Booked', 'in-progress': 'In progress', review: 'Ready for review', done: 'Done', paused: 'Paused', cancelled: 'Cancelled' };
export const METHODS = ['stripe', 'apple-pay', 'paypal', 'cash-app', 'venmo', 'zelle', 'cash', 'check', 'other'];

const SCHEMA = [
  // luoh's tables, exactly as luoh makes them (functions/_shared/db.js in the luoh repo), so either side can start first.
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, provider TEXT, created_at INTEGER NOT NULL, last_seen INTEGER, marketing INTEGER NOT NULL DEFAULT 0, marketing_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS login_links (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, marketing INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS login_links_email ON login_links (email, created_at)`,
  `CREATE TABLE IF NOT EXISTS projects (user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT, updated_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, id))`,
  // NuRenaissance's own.
  `CREATE TABLE IF NOT EXISTS link_returns (token_hash TEXT PRIMARY KEY, return_to TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS account_tickets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, origin TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS client_projects (id TEXT PRIMARY KEY, email TEXT NOT NULL, client_name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, service TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'booked', total_cents INTEGER NOT NULL DEFAULT 0, due TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS client_projects_email ON client_projects (email)`,
  `CREATE TABLE IF NOT EXISTS client_payments (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, method TEXT NOT NULL DEFAULT 'other', paid_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS client_payments_project ON client_payments (project_id)`,
];

const ready = new WeakSet();
export const hasAccountsDb = (env) => !!(env && env.ACCOUNTS_DB && typeof env.ACCOUNTS_DB.prepare === 'function');
export const accountsOn = (env) => hasAccountsDb(env) && String((env && env.NRN_ACCOUNT_SECRET) || '').length >= 16;
export async function accountsDb(env) {
  if (!hasAccountsDb(env)) return null;
  const db = env.ACCOUNTS_DB;
  if (!ready.has(db)) { await db.batch(SCHEMA.map((s) => db.prepare(s))); ready.add(db); }
  return db;
}

// ---- small helpers --------------------------------------------------------------------------------------------------------------------
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
export async function sha256(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const randomToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s))))));
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0;
}
export const cleanEmail = (v) => { const e = String(v || '').trim().toLowerCase(); return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e) && e.length <= 200 ? e : ''; };
const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const cents = (v) => { const n = Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) * 100); return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? n : null; };
const dayOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const httpsOk = (v) => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };
const id12 = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const reply = (obj, status = 200, headers = {}) => {
  const h = new Headers({ 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' });
  for (const [k, v] of Object.entries(headers)) { if (Array.isArray(v)) v.forEach((x) => h.append(k, x)); else if (v != null) h.set(k, v); }
  return new Response(JSON.stringify(obj), { status, headers: h });
};

// ---- the shared cookie ----------------------------------------------------------------------------------------------------------------
/** `Domain=nrnszn.com` on the real site (so every sub-site gets it); host-only on previews (pages.dev, localhost). */
export const cookieDomain = (host) => { const h = String(host || '').toLowerCase().split(':')[0]; return h === 'nrnszn.com' || h.endsWith('.nrnszn.com') ? 'nrnszn.com' : ''; };
const attrs = (host, maxAge) => `Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax${cookieDomain(host) ? `; Domain=${cookieDomain(host)}` : ''}`;

export async function sessionCookie(env, userId, host, now = Date.now()) {
  const exp = String(now + DAYS * 86400_000);
  return `${COOKIE}=${userId}.${exp}.${await hmac(env.NRN_ACCOUNT_SECRET, `${userId}.${exp}`)}; ${attrs(host, DAYS * 86400)}`;
}
export const clearCookie = (host) => `${COOKIE}=; ${attrs(host, 0)}`;

/** The account id in a request's cookie, if the signature and expiry are good (no database needed). */
export async function sessionUserId(request, env, now = Date.now()) {
  if (!accountsOn(env)) return null;
  const raw = (request.headers.get('cookie') || '').split(/;\s*/).filter((c) => c.startsWith(`${COOKIE}=`)).map((c) => c.slice(COOKIE.length + 1));
  for (const v of raw) {   // a stale host-only cookie may sit next to the domain one: any good one wins
    const [id, exp, sig, extra] = v.split('.');
    if (!id || !exp || !sig || extra !== undefined || !/^\d+$/.test(exp) || Number(exp) < now || id.length > 64) continue;
    if (await same(sig, await hmac(env.NRN_ACCOUNT_SECRET, `${id}.${exp}`))) return id;
  }
  return null;
}
export async function currentAccount(request, env, now = Date.now()) {
  const id = await sessionUserId(request, env, now);
  if (!id) return null;
  const db = await accountsDb(env);
  return db ? db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first() : null;
}

/** Adds or updates an account by e-mail (same rules as luoh's upsertUser: never turns marketing e-mail OFF here). */
export async function upsertAccount(db, { email, name, provider }, now = Date.now()) {
  const old = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (old) {
    await db.prepare('UPDATE users SET last_seen = ?, name = COALESCE(?, name) WHERE id = ?').bind(now, name || null, old.id).run();
    return { ...old, name: name || old.name };
  }
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO users (id, email, name, provider, created_at, last_seen, marketing) VALUES (?, ?, ?, ?, ?, ?, 0)').bind(id, email, name || null, provider, now, now).run();
  return { id, email, name: name || null, provider, created_at: now, marketing: 0 };
}
export const publicAccount = (u) => ({ email: u.email, name: u.name || null, since: u.created_at || null });

// ---- where a sign-in may go back to ------------------------------------------------------------------------------------------------
/** A safe place to return to: a path on this site, or a page on one of the NuRenaissance sites. Anything else = '/account'. */
export function safeReturn(v) {
  const s = String(v || '');
  if (/^\/(?![/\\])[^\s]*$/.test(s) && s.length <= 500) return s;
  try { const u = new URL(s); if ([...ORIGINS, ...TICKET_ORIGINS].includes(u.origin) && s.length <= 500 && !u.username && !u.password) return u.href; } catch { /* not a URL */ }
  return '/account';
}
// NuRenaissance sites may read who is signed in (credentials). soulnicolas.com may read the public on/off only: no credentials allowed, and its
// requests never carry the nrnszn.com cookie anyway (SameSite=Lax), so it always sees user: null.
const corsFor = (request) => {
  const o = request.headers.get('origin');
  if (o && ORIGINS.includes(o)) return { 'access-control-allow-origin': o, 'access-control-allow-credentials': 'true', vary: 'Origin' };
  if (o && TICKET_ORIGINS.includes(o)) return { 'access-control-allow-origin': o, vary: 'Origin' };
  return { vary: 'Origin' };
};

// ---- Google ------------------------------------------------------------------------------------------------------------------------
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let certCache = null;
async function googleCerts(env) {
  if (env.__googleCerts) return env.__googleCerts();
  if (certCache && certCache.until > Date.now()) return certCache.keys;
  const keys = await (await fetch(CERTS)).json();
  certCache = { keys, until: Date.now() + 3600_000 };
  return keys;
}
/** The checked claims of a Google ID token, or null (same checks as luoh's verifyGoogleToken). */
export async function verifyGoogle(token, env, now = Date.now()) {
  const clientId = env.GOOGLE_CLIENT_ID, parts = String(token || '').split('.');
  if (parts.length !== 3 || !clientId) return null;
  let header, claims;
  try { header = JSON.parse(new TextDecoder().decode(fromB64u(parts[0]))); claims = JSON.parse(new TextDecoder().decode(fromB64u(parts[1]))); } catch { return null; }
  if (!header || header.alg !== 'RS256') return null;
  const jwk = ((await googleCerts(env)).keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64u(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`)))) return null;
  if (claims.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || !(Number(claims.exp) > now / 1000)) return null;
  if (!claims.email || claims.email_verified === false || claims.email_verified === 'false') return null;
  return claims;
}

// ---- e-mail link -----------------------------------------------------------------------------------------------------------------
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function sendLink(db, env, { email, returnTo, origin }, now = Date.now()) {
  if (!env.RESEND_API_KEY) return { ok: false, status: 503, message: 'E-mail sign-in is not set up yet. Use Google for now.' };
  const to = cleanEmail(email);
  if (!to) return { ok: false, status: 400, message: 'That does not look like an e-mail address.' };
  const mine = await db.prepare('SELECT COUNT(*) AS n FROM login_links WHERE email = ? AND created_at > ?').bind(to, now - 10 * 60_000).first();
  if (Number(mine && mine.n) >= 3) return { ok: false, status: 429, message: 'We sent a few links already. Check your inbox (and spam), or try again in a few minutes.' };
  const all = await db.prepare('SELECT COUNT(*) AS n FROM login_links WHERE created_at > ?').bind(now - 86400_000).first();
  if (Number(all && all.n) >= LINKS_PER_DAY) return { ok: false, status: 429, message: 'E-mail sign-in is busy today. Please use Google, or try again tomorrow.' };
  const token = randomToken(), hash = await sha256(token);
  await db.batch([
    db.prepare('INSERT INTO login_links (token_hash, email, marketing, created_at, expires_at) VALUES (?, ?, 0, ?, ?)').bind(hash, to, now, now + LINK_MINUTES * 60_000),
    db.prepare('INSERT OR REPLACE INTO link_returns (token_hash, return_to) VALUES (?, ?)').bind(hash, safeReturn(returnTo)),
  ]);
  const link = `${origin}/api/account/verify?t=${token}`;
  const r = await (env.__fetch || fetch)('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.ACCOUNTS_FROM_EMAIL || 'NuRenaissance <account@mail.nrnszn.com>', to,
      subject: 'Your NuRenaissance sign-in link',
      text: `Tap to sign in to NuRenaissance:\n\n${link}\n\nThe link works once, for ${LINK_MINUTES} minutes, and signs you in to every NuRenaissance app. If you did not ask for it, ignore this e-mail.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5"><p>Tap to sign in to NuRenaissance:</p><p><a href="${escHtml(link)}" style="display:inline-block;background:#c8175f;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Sign in</a></p><p style="color:#666;font-size:13px">The link works once, for ${LINK_MINUTES} minutes, and signs you in to every NuRenaissance app. If you did not ask for it, ignore this e-mail.</p></div>`,
    }),
  });
  if (!r.ok) { console.error('resend', r.status); return { ok: false, status: 502, message: 'The e-mail could not be sent. Try again, or use Google.' }; }
  return { ok: true, sent: true };
}
export async function useLink(db, token, now = Date.now()) {
  const hash = await sha256(String(token || ''));
  const row = await db.prepare('SELECT * FROM login_links WHERE token_hash = ?').bind(hash).first();
  if (!row || row.used_at || Number(row.expires_at) < now) return null;
  const done = await db.prepare('UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(now, hash).run();
  if (!done.meta || !done.meta.changes) return null;   // tapped twice at the same moment: only the first one counts
  const ret = await db.prepare('SELECT return_to FROM link_returns WHERE token_hash = ?').bind(hash).first();
  return { email: row.email, returnTo: ret ? safeReturn(ret.return_to) : '/account' };
}

// ---- the soulnicolas.com hop ----------------------------------------------------------------------------------------------------
/** Where to send a signed-in visitor next: an nrnszn address as it is; a ticket site with a one-time ticket in the #fragment. */
export async function continueTo(db, userId, returnTo, now = Date.now()) {
  const target = safeReturn(returnTo);
  if (target.startsWith('/')) return target;
  const u = new URL(target);
  if (!TICKET_ORIGINS.includes(u.origin)) return target;
  const t = randomToken();
  await db.prepare('INSERT INTO account_tickets (token_hash, user_id, origin, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await sha256(t), userId, u.origin, now, now + TICKET_MS).run();
  await db.prepare('DELETE FROM account_tickets WHERE expires_at < ?').bind(now - 86400_000).run();
  u.hash = `nrn_ticket=${t}`;
  return u.href;
}
export async function redeemTicket(db, ticket, origin, now = Date.now()) {
  if (!TICKET_ORIGINS.includes(origin)) return null;
  const hash = await sha256(String(ticket || ''));
  const row = await db.prepare('SELECT * FROM account_tickets WHERE token_hash = ?').bind(hash).first();
  if (!row || row.used_at || Number(row.expires_at) < now || row.origin !== origin) return null;
  const done = await db.prepare('UPDATE account_tickets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(now, hash).run();
  if (!done.meta || !done.meta.changes) return null;
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
  return u ? publicAccount(u) : null;
}

// ---- client projects ------------------------------------------------------------------------------------------------------------
function shapeProjects(rows, pays, { admin = false } = {}) {
  const by = new Map(rows.map((p) => [p.id, []]));
  for (const x of pays) if (by.has(x.project_id)) by.get(x.project_id).push({ id: x.id, amount: x.amount_cents, method: x.method, paidOn: x.paid_on, note: x.note });
  return rows.map((p) => {
    const payments = by.get(p.id).sort((a, b) => (a.paidOn < b.paidOn ? 1 : -1)), paid = payments.reduce((s, x) => s + x.amount, 0);
    return {
      id: p.id, title: p.title, service: p.service, status: p.status, statusLabel: STATUS_LABEL[p.status] || p.status, total: p.total_cents, paid,
      balance: Math.max(0, p.total_cents - paid), due: p.due, note: p.note, link: p.link, updatedAt: p.updated_at, payments,
      ...(admin ? { email: p.email, clientName: p.client_name, createdAt: p.created_at } : {}),
    };
  });
}
const ORDER = `CASE status WHEN 'in-progress' THEN 0 WHEN 'review' THEN 1 WHEN 'booked' THEN 2 WHEN 'quote' THEN 3 WHEN 'paused' THEN 4 WHEN 'done' THEN 5 ELSE 6 END, updated_at DESC`;
export async function projectsFor(db, email) {
  const rows = (await db.prepare(`SELECT * FROM client_projects WHERE email = ? ORDER BY ${ORDER}`).bind(email).all()).results || [];
  if (!rows.length) return [];
  const pays = (await db.prepare(`SELECT * FROM client_payments WHERE project_id IN (${rows.map(() => '?').join(',')})`).bind(...rows.map((r) => r.id)).all()).results || [];
  return shapeProjects(rows, pays);
}
export async function allProjects(db) {
  const rows = (await db.prepare(`SELECT * FROM client_projects ORDER BY ${ORDER}`).all()).results || [];
  const pays = (await db.prepare('SELECT * FROM client_payments').all()).results || [];
  const list = shapeProjects(rows, pays, { admin: true });
  const accounts = new Set(((await db.prepare(`SELECT email FROM users WHERE email IN (SELECT email FROM client_projects)`).all()).results || []).map((r) => r.email));
  const open = list.filter((p) => p.status !== 'done' && p.status !== 'cancelled');
  const users = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  return {
    projects: list.map((p) => ({ ...p, hasAccount: accounts.has(p.email) })),
    totals: { projects: list.length, open: open.length, owed: list.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + p.balance, 0), accounts: Number((users && users.n) || 0) },
  };
}
export async function saveProject(db, p, now = Date.now()) {
  p = p || {};
  const email = cleanEmail(p.email), title = text(p.title, 120), total = cents(p.total);
  if (!email) return { ok: false, message: "Type the client's e-mail address (it is how their account finds the project)." };
  if (!title) return { ok: false, message: 'Give the project a name.' };
  if (total === null) return { ok: false, message: 'The total must be a number of dollars, like 450 or 450.00.' };
  const status = STATUSES.includes(p.status) ? p.status : 'booked';
  const due = p.due ? (dayOk(p.due) ? p.due : null) : '';
  if (due === null) return { ok: false, message: 'The due date is not a real date.' };
  const link = text(p.link, 500);
  if (link && !httpsOk(link)) return { ok: false, message: 'The link must start with https://' };
  const row = [email, text(p.clientName, 120), title, text(p.service, 120), status, total, due, text(p.note, 2000), link];
  if (p.id) {
    const r = await db.prepare('UPDATE client_projects SET email=?, client_name=?, title=?, service=?, status=?, total_cents=?, due=?, note=?, link=?, updated_at=? WHERE id=?').bind(...row, now, String(p.id)).run();
    if (!r.meta || !r.meta.changes) return { ok: false, message: 'That project is not there any more. Reload the page.' };
    return { ok: true, id: String(p.id) };
  }
  const id = id12();
  await db.prepare('INSERT INTO client_projects (email, client_name, title, service, status, total_cents, due, note, link, created_at, updated_at, id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(...row, now, now, id).run();
  return { ok: true, id };
}
export async function deleteProject(db, id) {
  await db.batch([db.prepare('DELETE FROM client_payments WHERE project_id = ?').bind(String(id || '')), db.prepare('DELETE FROM client_projects WHERE id = ?').bind(String(id || ''))]);
  return { ok: true };
}
export async function addPayment(db, x, now = Date.now()) {
  x = x || {};
  const p = await db.prepare('SELECT id FROM client_projects WHERE id = ?').bind(String(x.projectId || '')).first();
  if (!p) return { ok: false, message: 'That project is not there any more. Reload the page.' };
  const amount = cents(x.amount);
  if (!amount) return { ok: false, message: 'Type how much was paid, like 150 or 150.00.' };
  const paidOn = x.paidOn || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(now));
  if (!dayOk(paidOn)) return { ok: false, message: 'The payment date is not a real date.' };
  const id = id12();
  await db.prepare('INSERT INTO client_payments (id, project_id, amount_cents, method, paid_on, note, created_at) VALUES (?,?,?,?,?,?,?)').bind(id, p.id, amount, METHODS.includes(x.method) ? x.method : 'other', paidOn, text(x.note, 200), now).run();
  await db.prepare('UPDATE client_projects SET updated_at = ? WHERE id = ?').bind(now, p.id).run();
  return { ok: true, id };
}
export async function deletePayment(db, id) { await db.prepare('DELETE FROM client_payments WHERE id = ?').bind(String(id || '')).run(); return { ok: true }; }

/** Erase my account (luoh projects saved on it too, as luoh's own delete does). Client projects are Nick's business records and stay. */
export async function deleteAccount(db, user) {
  await db.batch([
    db.prepare('DELETE FROM projects WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM login_links WHERE email = ?').bind(user.email),
    db.prepare('DELETE FROM account_tickets WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
}

// ---- the HTTP side: /api/account/<what> -----------------------------------------------------------------------------------------
const redirect = (to, cookies = []) => { const h = new Headers({ location: to, 'cache-control': 'no-store' }); cookies.forEach((c) => h.append('set-cookie', c)); return new Response(null, { status: 303, headers: h }); };
const offMsg = 'Accounts are not switched on yet.';

export async function accountRequest({ request, env, params }) {
  env = env || {};
  const url = new URL(request.url), what = [].concat((params && params.path) || []).join('/') || url.pathname.replace(/^\/api\/account\/?/, '');
  const host = url.host, method = request.method, cors = corsFor(request);
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' } });
  try {
    if (what === 'me' && method === 'GET') {
      const info = { on: accountsOn(env), google: !!env.GOOGLE_CLIENT_ID, email: !!env.RESEND_API_KEY, clientId: env.GOOGLE_CLIENT_ID || '' };
      if (!info.on) return reply({ ...info, user: null }, 200, cors);
      const u = await currentAccount(request, env);
      if (!u) return reply({ ...info, user: null }, 200, cors);
      // Client projects (money) only for this site's own Account page, never for another site's script.
      const o = request.headers.get('origin');
      if (url.searchParams.get('projects') === '1' && (!o || o === url.origin)) return reply({ ...info, user: publicAccount(u), projects: await projectsFor(await accountsDb(env), u.email) }, 200, cors);
      return reply({ ...info, user: publicAccount(u) }, 200, cors);
    }
    if (!accountsOn(env)) return reply({ ok: false, message: offMsg }, 503, cors);
    const db = await accountsDb(env);

    if (what === 'verify' && method === 'GET') {
      const got = await useLink(db, url.searchParams.get('t'));
      if (!got) return redirect('/account?expired=1');
      const u = await upsertAccount(db, { email: got.email, provider: 'email' });
      return redirect(await continueTo(db, u.id, got.returnTo), [await sessionCookie(env, u.id, host)]);
    }
    if (what === 'connect' && method === 'GET') {
      const u = await currentAccount(request, env), back = safeReturn(url.searchParams.get('return'));
      if (!u) return redirect(`/account?return=${encodeURIComponent(back)}`);
      return redirect(await continueTo(db, u.id, back));
    }
    if (method !== 'POST') return reply({ ok: false, message: 'Unknown request.' }, 404, cors);
    let body; try { body = await request.json(); } catch { return reply({ ok: false, message: 'Bad request.' }, 400, cors); }
    body = body || {};

    if (what === 'redeem') {   // soulnicolas.com trades its one-time ticket (no cookie involved)
      const o = request.headers.get('origin') || '';
      const who = await redeemTicket(db, body.ticket, o);
      const h = TICKET_ORIGINS.includes(o) ? { 'access-control-allow-origin': o, vary: 'Origin' } : { vary: 'Origin' };
      return who ? reply({ ok: true, user: who }, 200, h) : reply({ ok: false, message: 'That sign-in has expired. Try again.' }, 400, h);
    }
    // Everything below changes the signed-in state, so it must come from this site's own pages (not another site's script).
    const o = request.headers.get('origin');
    if (o && o !== url.origin) return reply({ ok: false, message: 'Not allowed from another site.' }, 403);
    if (what === 'google') {
      const c = await verifyGoogle(body.credential, env);
      if (!c) return reply({ ok: false, message: 'Google sign-in did not work. Try again.' }, 401);
      const u = await upsertAccount(db, { email: String(c.email).toLowerCase(), name: text(c.name, 120) || null, provider: 'google' });
      return reply({ ok: true, user: publicAccount(u), next: await continueTo(db, u.id, body.return) }, 200, { 'set-cookie': await sessionCookie(env, u.id, host) });
    }
    if (what === 'email') {
      const out = await sendLink(db, env, { email: body.email, returnTo: body.return, origin: url.origin });
      return reply(out, out.ok ? 200 : out.status);
    }
    if (what === 'logout') return reply({ ok: true }, 200, { 'set-cookie': [clearCookie(host), ...(cookieDomain(host) ? [`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`] : [])] });
    if (what === 'continue') {
      const u = await currentAccount(request, env);
      if (!u) return reply({ ok: false, message: 'Please sign in first.' }, 401);
      return reply({ ok: true, next: await continueTo(db, u.id, body.return) });
    }
    if (what === 'name') {
      const u = await currentAccount(request, env);
      if (!u) return reply({ ok: false, message: 'Please sign in first.' }, 401);
      const name = text(body.name, 80);
      await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name || null, u.id).run();
      return reply({ ok: true, user: publicAccount({ ...u, name: name || null }) });
    }
    if (what === 'delete') {
      const u = await currentAccount(request, env);
      if (!u) return reply({ ok: false, message: 'Please sign in first.' }, 401);
      if (cleanEmail(body.confirm) !== String(u.email).toLowerCase()) return reply({ ok: false, message: 'Type your e-mail address exactly to confirm.' }, 400);
      await deleteAccount(db, u);
      return reply({ ok: true, deleted: true }, 200, { 'set-cookie': clearCookie(host) });
    }
    return reply({ ok: false, message: 'Unknown request.' }, 404);
  } catch (e) {
    console.error('account', what, e);
    return reply({ ok: false, message: 'Something went wrong on our side. Try again in a minute.' }, 500, cors);
  }
}
