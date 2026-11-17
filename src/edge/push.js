// Phone notifications for the NuRenaissance site. A visitor taps "Notifications" in the footer; the phone gives a private notification address and two keys,
// kept in D1 (`push_subs`). Nick sends one from /admin > Phone notifications; `pushSend` encrypts the message for
// each phone (RFC 8291, aes128gcm) and signs the request with our key (VAPID, RFC 8292), both with the browser-standard WebCrypto. A push service
// (Google, Apple, Mozilla) only ever sees encrypted bytes. The signing subject is the site address, never an email.
// Keys: the Cloudflare secrets VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (made once with scripts/make-vapid-keys.mjs). Without them nothing is shown or sent.
/** Most notifications that can go out in 24 hours (Nick's own sends only; nothing is automatic). */
export const PUSH_DAILY_CAP = 3;
const MAX_SUBS = 20000;

const enc = new TextEncoder();
export const b64u = {
  encode(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(text) { const t = String(text).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), c => c.charCodeAt(0)); },
};
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
/** The encrypted request body for one phone. `random` is only for tests. */
export async function encryptPayload(text, sub, random) {
  const uaPublic = b64u.decode(sub.p256dh), authSecret = b64u.decode(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh key');
  if (authSecret.length !== 16) throw new Error('bad auth secret');
  const plain = enc.encode(text); if (plain.length > 3800) throw new Error('message too long');
  const server = (random && random.serverKeys) || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));
  const salt = (random && random.salt) || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plain, new Uint8Array([2]))));   // 0x02 = last record
  const header = new Uint8Array(21); header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65;
  return concat(header, asPublic, cipher);
}
/** "vapid t=<signed token>, k=<our public key>" */
export async function vapidHeader(endpoint, subject, publicKey, privateKey, now = Date.now()) {
  const pub = b64u.decode(publicKey); if (pub.length !== 65 || pub[0] !== 4) throw new Error('bad VAPID public key');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), d: privateKey };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims)));
  return 'vapid t=' + head + '.' + claims + '.' + b64u.encode(sig) + ', k=' + publicKey;
}
/** 'sent' | 'gone' (404/410: the phone unsubscribed, delete it) | 'failed' */
export async function sendPush(sub, text, vapid, fetchFn = fetch) {
  try {
    if (new URL(sub.endpoint).protocol !== 'https:') return 'failed';
    const res = await fetchFn(sub.endpoint, { method: 'POST', body: await encryptPayload(text, sub), headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: await vapidHeader(sub.endpoint, vapid.subject, vapid.publicKey, vapid.privateKey) } });
    try { await res.body && res.body.cancel(); } catch (e) { /* ignore */ }
    if (res.status >= 200 && res.status < 300) return 'sent';
    return res.status === 404 || res.status === 410 ? 'gone' : 'failed';
  } catch (e) { return 'failed'; }
}

// ---- the stored subscriptions and the send log (D1) ----
const DDL = ['CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, at INTEGER NOT NULL, ip_hash TEXT)',
  'CREATE INDEX IF NOT EXISTS ix_push_subs_ip ON push_subs (ip_hash, at)',
  'CREATE TABLE IF NOT EXISTS push_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, title TEXT, body TEXT, url TEXT, sent INTEGER, failed INTEGER, removed INTEGER)'];
export const ensurePush = db => db.batch(DDL.map(s => db.prepare(s)));
const sha = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
const configured = env => !!(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
const vapidOf = env => ({ subject: env.VAPID_SUBJECT || 'https://www.nrnszn.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Public: is it switched on, and the public key the phone needs. */
export const pushInfo = env => (configured(env) ? { on: true, key: env.VAPID_PUBLIC_KEY } : { on: false });

export async function pushSubscribe(db, env, p, ip) {
  if (!configured(env)) throw new Error('Notifications are not switched on yet.');
  await ensurePush(db); p = p || {};
  const ep = String(p.endpoint || '').trim(), k = String(p.p256dh || ''), a = String(p.auth || '');
  if (ep.length < 18 || ep.length > 600 || !/^https:\/\/\S+$/.test(ep) || !/^[A-Za-z0-9_-]{80,100}$/.test(k) || !/^[A-Za-z0-9_-]{20,30}$/.test(a)) throw new Error('That does not look like a phone notification address.');
  const h = await sha('push|' + (ip || 'unknown')), now = Date.now();
  if (Number((await db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE ip_hash = ? AND at > ?').bind(h, now - 3600e3).first()).n) >= 10) throw new Error('Too many sign-ups from here. Try again later.');
  if (Number((await db.prepare('SELECT COUNT(*) AS n FROM push_subs').first()).n) >= MAX_SUBS && !(await db.prepare('SELECT 1 AS x FROM push_subs WHERE endpoint = ?').bind(ep).first())) throw new Error('Notifications are full right now.');
  await db.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, at, ip_hash) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth').bind(ep, k, a, now, h).run();
  return { ok: true };
}
export async function pushUnsubscribe(db, endpoint) {
  await ensurePush(db);
  await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(endpoint || '').trim()).run();
  return { ok: true };
}
async function sentToday(db, now) { return Number((await db.prepare('SELECT COUNT(*) AS n FROM push_log WHERE at > ? AND sent > 0').bind(now - 24 * 3600e3).first()).n) || 0; }
/** Owner: how many phones, how many sent today, and the limit. */
export async function pushStatus(db, env, now = Date.now()) {
  await ensurePush(db);
  return { on: configured(env), subscribers: Number((await db.prepare('SELECT COUNT(*) AS n FROM push_subs').first()).n) || 0, sentToday: await sentToday(db, now), cap: PUSH_DAILY_CAP,
    last: (await db.prepare('SELECT at, title, body, sent FROM push_log ORDER BY id DESC LIMIT 5').all()).results };
}
/** Owner: send one notification to everyone. A same-site path only for where a tap goes. Throws a plain message for bad input or the daily limit. */
export async function pushSend(db, env, p, { fetchFn = fetch, now = Date.now() } = {}) {
  if (!configured(env)) throw new Error('Notifications are not switched on yet (the two keys are missing).');
  await ensurePush(db); p = p || {};
  const title = clean(p.title, 60), body = clean(p.body, 140); let url = String(p.url || '/').trim();
  if (!title) throw new Error('Write a title first.');
  if (!/^\/[A-Za-z0-9\-._~\/?=&%#]*$/.test(url) || url.startsWith('//')) url = '/';
  if ((await sentToday(db, now)) >= PUSH_DAILY_CAP) throw new Error('You have already sent ' + PUSH_DAILY_CAP + ' notifications in the last 24 hours. Fans would get tired of it. Try again tomorrow.');
  const subs = (await db.prepare('SELECT endpoint, p256dh, auth FROM push_subs ORDER BY at ASC LIMIT 5000').all()).results;
  if (!subs.length) throw new Error('Nobody has turned on notifications yet.');
  const text = JSON.stringify({ title, body, url, tag: 'soulvault' }), vapid = vapidOf(env);
  let sent = 0, failed = 0; const gone = [];
  for (let i = 0; i < subs.length; i += 25) {
    const r = await Promise.all(subs.slice(i, i + 25).map(s => sendPush(s, text, vapid, fetchFn)));
    r.forEach((x, k) => { if (x === 'sent') sent++; else if (x === 'gone') gone.push(subs[i + k].endpoint); else failed++; });
  }
  for (const e of gone) await db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e).run();
  await db.prepare('INSERT INTO push_log (at, title, body, url, sent, failed, removed) VALUES (?,?,?,?,?,?,?)').bind(now, title, body, url, sent, failed, gone.length).run();   // a send only uses up the day when something went out (see sentToday)
  return { sent, failed, removed: gone.length };
}
