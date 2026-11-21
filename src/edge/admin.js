// /api/admin: the owner's sign-in and the owner-only facts behind the /admin page (same idea as Soul Vault's /admin).
//
//   GET  /api/admin                        no sign-in: just says whether sign-in is set up ("mode": "ready" | "not-set-up"). No data.
//   POST /api/admin {action:'login', password}   right password => a signed session token (30 days). Wrong => 401; five wrong tries from one
//                                                address lock that address out for 15 minutes (best effort: counted per Cloudflare data centre).
//   GET  /api/admin   + Authorization: Bearer <token>   the setup checklist: which secrets and bindings exist (yes/no only, never a value).
//   POST /api/admin {action:'account-login'}  (no password) the signed-in NuRenaissance account (cookie nrn_session) gets the same session token, but
//                                                ONLY when its e-mail is in the Cloudflare variable ADMIN_EMAILS. This is the way in when the password is forgotten.
//   POST /api/admin {action:'backup'} + token             "Back up now": runs the sheet backup (src/edge/backup.js) once.
//   GET  /api/admin?section=events | analytics&days=7|30|90  + token   the events list / the website numbers (need the D1 database binding DB).
//   POST /api/admin {action:'event-save', event} | {action:'event-delete', id}  + token   add, edit or delete an event.
//   GET  /api/admin?section=push  + token                   how many phones have notifications on, how many were sent today.
//   POST /api/admin {action:'push-auto', auto:{events,videos,services,gallery,cinema}}  + token   switch the automatic notifications on or off (src/edge/autopush.js).
//   POST /api/admin {action:'push-send', push:{title, body, url}}  + token   send one phone notification to everyone (at most 3 a day).
//   GET  /api/admin?section=clients  + token                client projects, their payments and totals (accounts database ACCOUNTS_DB, src/edge/accounts.js).
//   POST /api/admin {action:'client-save', project} | {action:'client-delete', id} | {action:'client-pay', payment} | {action:'client-pay-delete', id}  + token
//
// Switches on only when the Cloudflare secret ADMIN_PASSWORD exists (at least 10 characters). The session token is signed with a key made
// from that password, so changing the password signs every device out. The token lives in the browser's localStorage, like Soul Vault's owner key.
import { sameToken } from './survey-recap-api.js';
import { runBackup, backupStatus } from './backup.js';
import { hasDb } from './db.js';
import { listAll, saveEvent, deleteEvent } from './events.js';
import { summary } from './analytics.js';
import { pushStatus, pushSend } from './push.js';
import { getAutoSettings, setAutoSettings, maybeAuto } from './autopush.js';
import { currentAccount, accountsDb, hasAccountsDb, accountsOn, allProjects, saveProject, deleteProject, addPayment, deletePayment } from './accounts.js';

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' } });
export const SESSION_MS = 30 * 24 * 3600 * 1000;
export const MAX_TRIES = 5, LOCK_MS = 15 * 60 * 1000;
export const adminReady = (env) => String((env && env.ADMIN_PASSWORD) || '').length >= 10;
/** The e-mails allowed into /admin through their NuRenaissance account (ADMIN_EMAILS, separated by commas or spaces). */
export const adminEmails = (env) => String((env && env.ADMIN_EMAILS) || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
const accountDoor = (env) => accountsOn(env) && adminEmails(env).length > 0;

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function sign(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${env.ADMIN_PASSWORD}|nrn-admin-session-v1`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function makeToken(env, now = Date.now()) {
  const payload = b64u(enc.encode(JSON.stringify({ exp: now + SESSION_MS, v: 1 })));
  return `${payload}.${await sign(env, payload)}`;
}
export async function verifyToken(env, token, now = Date.now()) {
  if (!adminReady(env)) return false;
  const [payload, sig, extra] = String(token || '').split('.');
  if (!payload || !sig || extra !== undefined) return false;
  if (!sameToken(sig, await sign(env, payload))) return false;
  try { const p = JSON.parse(new TextDecoder().decode(fromB64u(payload))); return p && p.v === 1 && Number(p.exp) > now; } catch { return false; }
}

// Wrong-password counter per address (kept in memory: it resets when Cloudflare restarts the worker, so it slows guessing down rather than stopping it).
const tries = new Map();
export const forgetTries = () => tries.clear();
const who = (request) => request.headers.get('cf-connecting-ip') || 'unknown';
function locked(ip, now) { const t = tries.get(ip); return !!t && t.until > now; }
function wrong(ip, now) {
  const t = tries.get(ip) || { n: 0, until: 0 };
  if (t.until && t.until <= now) { t.n = 0; t.until = 0; }
  t.n += 1; if (t.n >= MAX_TRIES) t.until = now + LOCK_MS;
  tries.set(ip, t); if (tries.size > 5000) tries.clear();
}

/** Which secrets and bindings exist. Yes/no only. */
export function setupChecklist(env) {
  const has = (k) => !!String(env[k] || '').trim();
  return [
    { group: 'Survey and e-mails', items: [
      { name: 'SURVEY_SERVICE_ACCOUNT_JSON', label: 'Survey sheet key', present: has('SURVEY_SERVICE_ACCOUNT_JSON') },
      { name: 'RESEND_API_KEY', label: 'E-mail sending key (Resend)', present: has('RESEND_API_KEY') },
      { name: 'SURVEY_UNSUB_SECRET', label: 'Unsubscribe link secret', present: has('SURVEY_UNSUB_SECRET') },
      { name: 'RECAP_CRON_TOKEN', label: 'Daily recap job password', present: has('RECAP_CRON_TOKEN') },
    ] },
    { group: 'Payments and services', items: [
      { name: 'PAYMENTS_SERVICE_ACCOUNT_JSON', label: 'Payments log key', present: has('PAYMENTS_SERVICE_ACCOUNT_JSON') },
      { name: 'SERVICES_SERVICE_ACCOUNT_JSON', label: 'Services clicks and requests key', present: has('SERVICES_SERVICE_ACCOUNT_JSON') },
    ] },
    { group: 'Feeds', items: [
      { name: 'GOOGLE_SERVICE_ACCOUNT_JSON', label: 'Gallery, cinema and prices read key', present: has('GOOGLE_SERVICE_ACCOUNT_JSON') },
      { name: 'YOUTUBE_API_KEY', label: 'YouTube key', present: has('YOUTUBE_API_KEY') },
    ] },
    { group: 'Events and analytics', items: [
      { name: 'DB', label: 'Site database (D1 binding)', present: hasDb(env) },
    ] },
    { group: 'Phone notifications', items: [
      { name: 'VAPID_PUBLIC_KEY', label: 'Notifications public key', present: has('VAPID_PUBLIC_KEY') },
      { name: 'VAPID_PRIVATE_KEY', label: 'Notifications private key', present: has('VAPID_PRIVATE_KEY') },
    ] },
    { group: 'NuRenaissance accounts', items: [
      { name: 'ACCOUNTS_DB', label: 'Accounts database (D1 binding, the same one luoh uses)', present: hasAccountsDb(env) },
      { name: 'NRN_ACCOUNT_SECRET', label: 'Account sign-in secret (same value in luoh)', present: accountsOn(env) },
      { name: 'GOOGLE_CLIENT_ID', label: 'Google sign-in client id', present: has('GOOGLE_CLIENT_ID') },
      { name: 'ADMIN_EMAILS', label: 'Admin e-mails (sign in here with your account if you forget the password)', present: adminEmails(env).length > 0 },
    ] },
    { group: 'Backups and sign-in', items: [
      { name: 'BACKUPS', label: 'Backup storage bucket (R2 binding)', present: !!(env.BACKUPS && typeof env.BACKUPS.put === 'function') },
      { name: 'BACKUP_CRON_TOKEN', label: 'Nightly backup job password', present: has('BACKUP_CRON_TOKEN') },
      { name: 'ADMIN_PASSWORD', label: 'Admin password (this page)', present: adminReady(env) },
    ] },
  ];
}

async function authed(request, env) {
  return verifyToken(env, (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
}

export async function adminGet({ request, env }) {
  env = env || {};
  if (!adminReady(env)) return reply({ status: 'ok', message: 'NuRenaissance admin.', mode: 'not-set-up' });
  if (!request.headers.get('authorization')) return reply({ status: 'ok', message: 'NuRenaissance admin.', mode: 'ready', accountLogin: accountDoor(env) });
  if (!(await authed(request, env))) return reply({ ok: false, message: 'Please sign in again.' }, 401);
  const url = new URL(request.url), section = url.searchParams.get('section');
  if (section === 'push') {
    if (!hasDb(env)) return reply({ ok: false, result: 'no-db', message: 'The site database is not connected yet (see docs/admin-setup.md).' }, 503);
    try { return reply({ ok: true, ...(await pushStatus(env.DB, env)), auto: await getAutoSettings(env.DB) }); } catch (e) { console.error('admin push', e); return reply({ ok: false, message: 'The database did not answer. Try again in a minute.' }, 502); }
  }
  if (section === 'clients') {
    if (!hasAccountsDb(env)) return reply({ ok: false, result: 'no-db', message: 'The accounts database is not connected yet (see docs/accounts-setup.md).' }, 503);
    try { return reply({ ok: true, ...(await allProjects(await accountsDb(env))) }); } catch (e) { console.error('admin clients', e); return reply({ ok: false, message: 'The database did not answer. Try again in a minute.' }, 502); }
  }
  if (section === 'events' || section === 'analytics') {
    if (!hasDb(env)) return reply({ ok: false, result: 'no-db', message: 'The site database is not connected yet (see docs/admin-setup.md).' }, 503);
    try {
      return reply(section === 'events' ? { ok: true, events: await listAll(env.DB) } : { ok: true, ...(await summary(env.DB, Number(url.searchParams.get('days')))) });
    } catch (e) { console.error('admin section', section, e); return reply({ ok: false, message: 'The database did not answer. Try again in a minute.' }, 502); }
  }
  let backup = null; try { backup = await (await backupStatus(env)).json(); } catch { /* the page shows its own backup row */ }
  return reply({ status: 'ok', mode: 'ready', signedIn: true, setup: setupChecklist(env), backup });
}

export async function adminPost({ request, env, waitUntil }) {
  env = env || {};
  if (!adminReady(env)) return reply({ ok: false, message: 'Admin sign-in is not set up yet (see docs/admin-setup.md).' }, 503);
  let body; try { body = await request.json(); } catch { return reply({ ok: false, message: 'Bad request.' }, 400); }
  const now = Date.now(), ip = who(request);
  if (body && body.action === 'login') {
    if (locked(ip, now)) return reply({ ok: false, message: 'Too many wrong tries. Please wait 15 minutes.' }, 429);
    if (typeof body.password !== 'string' || !sameToken(body.password, env.ADMIN_PASSWORD)) { wrong(ip, now); return reply({ ok: false, message: 'That password is not right.' }, 401); }
    tries.delete(ip);
    return reply({ ok: true, token: await makeToken(env, now), days: SESSION_MS / 86400000 });
  }
  if (body && body.action === 'account-login') {
    const o = request.headers.get('origin');
    if (o && o !== new URL(request.url).origin) return reply({ ok: false, message: 'Not allowed from another site.' }, 403);
    if (!accountDoor(env)) return reply({ ok: false, result: 'not-set-up', message: 'Signing in with your account is not set up yet: add your e-mail to ADMIN_EMAILS in Cloudflare (see docs/admin-setup.md).' }, 503);
    let who = null; try { who = await currentAccount(request, env); } catch (e) { console.error('admin account-login', e); }
    if (!who) return reply({ ok: false, result: 'signed-out', message: 'Sign in to your NuRenaissance account first.' }, 401);
    if (!adminEmails(env).includes(String(who.email).toLowerCase())) return reply({ ok: false, result: 'not-admin', message: `${who.email} is not on the admin list.` }, 403);
    return reply({ ok: true, token: await makeToken(env, now), days: SESSION_MS / 86400000 });
  }
  if (!(await authed(request, env))) return reply({ ok: false, message: 'Please sign in again.' }, 401);
  if (body && body.action === 'backup') {
    if (!(env.BACKUPS && typeof env.BACKUPS.put === 'function')) return reply({ ok: false, result: 'not-set-up', message: 'The backup bucket is not connected yet (see docs/backup-setup.md).' }, 503);
    try { const out = await runBackup(env); return reply(out, out.ok ? 200 : 502); }
    catch (e) { return reply({ ok: false, result: 'failed', error: String((e && e.message) || e).slice(0, 200) }, 502); }
  }
  if (body && (body.action === 'event-save' || body.action === 'event-delete')) {
    if (!hasDb(env)) return reply({ ok: false, result: 'no-db', message: 'The site database is not connected yet (see docs/admin-setup.md).' }, 503);
    try {
      const out = body.action === 'event-save' ? await saveEvent(env.DB, body.event) : await deleteEvent(env.DB, body.id);
      if (out.ok && body.action === 'event-save' && waitUntil) waitUntil(maybeAuto(env, { force: true, origin: new URL(request.url).origin }));   // a new event goes out right away (if it is between 9 AM and 9 PM Central and the switch is on)
      return reply(out, out.ok ? 200 : 400);
    } catch (e) { console.error('admin event', e); return reply({ ok: false, message: 'The database did not answer. Try again in a minute.' }, 502); }
  }
  if (body && ['client-save', 'client-delete', 'client-pay', 'client-pay-delete'].includes(body.action)) {
    if (!hasAccountsDb(env)) return reply({ ok: false, result: 'no-db', message: 'The accounts database is not connected yet (see docs/accounts-setup.md).' }, 503);
    try {
      const db = await accountsDb(env), a = body.action;
      const out = a === 'client-save' ? await saveProject(db, body.project) : a === 'client-delete' ? await deleteProject(db, body.id) : a === 'client-pay' ? await addPayment(db, body.payment) : await deletePayment(db, body.id);
      return reply(out, out.ok ? 200 : 400);
    } catch (e) { console.error('admin client', e); return reply({ ok: false, message: 'The database did not answer. Try again in a minute.' }, 502); }
  }
  if (body && body.action === 'push-auto') {
    if (!hasDb(env)) return reply({ ok: false, result: 'no-db', message: 'The site database is not connected yet (see docs/admin-setup.md).' }, 503);
    try { return reply({ ok: true, auto: await setAutoSettings(env.DB, body.auto, env, Date.now(), undefined, new URL(request.url).origin) }); } catch (e) { console.error('admin push-auto', e); return reply({ ok: false, message: 'The database did not answer. Try again in a minute.' }, 502); }
  }
  if (body && body.action === 'push-send') {
    if (!hasDb(env)) return reply({ ok: false, result: 'no-db', message: 'The site database is not connected yet (see docs/admin-setup.md).' }, 503);
    try { return reply({ ok: true, ...(await pushSend(env.DB, env, body.push)) }); }
    catch (e) { return reply({ ok: false, message: String((e && e.message) || e).slice(0, 240) }, 400); }   // plain-language messages from push.js (no title, nobody subscribed, daily limit, keys missing)
  }
  return reply({ ok: false, message: 'Unknown request.' }, 400);
}
