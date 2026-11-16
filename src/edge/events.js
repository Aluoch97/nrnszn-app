// Events you add and edit in /admin. Stored in the D1 database (src/edge/db.js); the Events page shows them next to the Certified Lounge show guide
// and the older past events that live in the site's code. Flyer pictures are stored in the same database (a 900 px and a 480 px copy,
// made in the browser before upload) and served by /api/flyer with a long cache (a new flyer always gets a new id).
import { ensureDb } from './db.js';
import { eventSlug } from './eventpage.js';

export const MAX_EVENTS = 300;
const ID_OK = /^[a-f0-9]{12}$/;
const DATA_URL = /^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_FLYER_CHARS = 700000; // about 500 KB of picture per size
const https = (u) => /^https:\/\/[^\s<>"']{1,500}$/i.test(u);
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

function realDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100;
}

/** Checks one event as typed in /admin. Returns { ok: true, event } or { ok: false, error } (plain words). Nothing is stored here. */
export function cleanEvent(input) {
  const o = input && typeof input === 'object' ? input : {};
  const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const title = str(o.title, 120);
  if (!title) return { ok: false, error: 'Give the event a name.' };
  const day = str(o.day, 10);
  if (!realDay(day)) return { ok: false, error: 'Pick the date of the event.' };
  const details = String(o.details == null ? '' : o.details).replace(/\r\n?/g, '\n').trim().slice(0, 2000);
  const tickets = str(o.tickets, 500), video = str(o.video, 500), watch = str(o.watch, 100);
  if (tickets && !https(tickets)) return { ok: false, error: 'The tickets link must start with https://' };
  if (video && !https(video)) return { ok: false, error: 'The recap video link must start with https://' };
  if (watch && !/^\/[A-Za-z0-9\-_/#?=&.]*$/.test(watch)) return { ok: false, error: 'The "watch on this site" link must be a page on this site, like /cinema' };
  if (watch.startsWith('//')) return { ok: false, error: 'The "watch on this site" link must be a page on this site, like /cinema' };
  return { ok: true, event: { title, day, time: str(o.time, 40), where: str(o.where, 160), details, tickets, video, watch, published: o.published !== false && o.published !== 0 && o.published !== '0' } };
}

/** Checks the two flyer pictures sent by /admin. Returns { ok, flyer: { mime, big, small } } with plain base64 text. */
export function cleanFlyer(f) {
  const b = DATA_URL.exec(String(f && f.big || '')), s = DATA_URL.exec(String(f && f.small || ''));
  if (!b || !s) return { ok: false, error: 'The flyer must be a JPG, PNG or WebP picture.' };
  if (b[1] !== s[1]) return { ok: false, error: 'The flyer pictures do not match.' };
  if (b[2].length > MAX_FLYER_CHARS || s[2].length > MAX_FLYER_CHARS) return { ok: false, error: 'That flyer is too big. Try a smaller picture.' };
  return { ok: true, flyer: { mime: `image/${b[1]}`, big: b[2], small: s[2] } };
}

const publicShape = (r) => ({ id: r.id, slug: eventSlug({ id: r.id, title: r.title }), title: r.title, day: r.day, time: r.time_text, where: r.where_text, details: r.details, tickets: r.tickets_url, video: r.video_url, watch: r.watch_path, flyer: r.flyer_id || '' });

/** What the Events page shows: published events only, newest first. */
export async function listPublic(db) {
  await ensureDb(db);
  const { results } = await db.prepare('SELECT * FROM events WHERE published = 1 ORDER BY day DESC, created_at DESC LIMIT ?').bind(MAX_EVENTS).all();
  return (results || []).map(publicShape);
}
/** One published event by id (for its own page), or null. */
export async function getPublicEvent(db, id) {
  await ensureDb(db);
  if (!ID_OK.test(String(id || ''))) return null;
  const r = await db.prepare('SELECT * FROM events WHERE id = ? AND published = 1').bind(id).first();
  return r ? publicShape(r) : null;
}
/** What /admin shows: everything, with the published flag. */
export async function listAll(db) {
  await ensureDb(db);
  const { results } = await db.prepare('SELECT * FROM events ORDER BY day DESC, created_at DESC LIMIT ?').bind(MAX_EVENTS).all();
  return (results || []).map((r) => ({ ...publicShape(r), published: !!r.published }));
}

/** Adds or edits one event. input.id edits that event. input.flyer = { big, small } replaces the flyer; input.removeFlyer = true clears it. */
export async function saveEvent(db, input, now = Date.now()) {
  await ensureDb(db);
  const c = cleanEvent(input); if (!c.ok) return c;
  const e = c.event, id = input && input.id ? String(input.id) : '';
  let existing = null;
  if (id) {
    if (!ID_OK.test(id)) return { ok: false, error: 'That event could not be found.' };
    existing = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    if (!existing) return { ok: false, error: 'That event could not be found.' };
  } else {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM events').first();
    if (n && n.n >= MAX_EVENTS) return { ok: false, error: `You already have ${MAX_EVENTS} events. Delete some old ones first.` };
  }
  let flyerId = existing ? existing.flyer_id : '';
  const statements = [];
  if (input && input.flyer) {
    const f = cleanFlyer(input.flyer); if (!f.ok) return f;
    const newId = randomId();
    statements.push(db.prepare('INSERT INTO event_flyers (id, mime, big, small, created_at) VALUES (?, ?, ?, ?, ?)').bind(newId, f.flyer.mime, f.flyer.big, f.flyer.small, now));
    if (flyerId) statements.push(db.prepare('DELETE FROM event_flyers WHERE id = ?').bind(flyerId));
    flyerId = newId;
  } else if (input && input.removeFlyer && flyerId) {
    statements.push(db.prepare('DELETE FROM event_flyers WHERE id = ?').bind(flyerId));
    flyerId = '';
  }
  const newEventId = existing ? existing.id : randomId();
  if (existing) statements.push(db.prepare('UPDATE events SET title=?, day=?, time_text=?, where_text=?, details=?, tickets_url=?, video_url=?, watch_path=?, flyer_id=?, published=?, updated_at=? WHERE id=?')
    .bind(e.title, e.day, e.time, e.where, e.details, e.tickets, e.video, e.watch, flyerId, e.published ? 1 : 0, now, existing.id));
  else statements.push(db.prepare('INSERT INTO events (id, title, day, time_text, where_text, details, tickets_url, video_url, watch_path, flyer_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newEventId, e.title, e.day, e.time, e.where, e.details, e.tickets, e.video, e.watch, flyerId, e.published ? 1 : 0, now, now));
  await db.batch(statements);
  return { ok: true, id: newEventId, flyer: flyerId };
}

export async function deleteEvent(db, id) {
  await ensureDb(db);
  if (!ID_OK.test(String(id || ''))) return { ok: false, error: 'That event could not be found.' };
  const row = await db.prepare('SELECT flyer_id FROM events WHERE id = ?').bind(id).first();
  if (!row) return { ok: false, error: 'That event could not be found.' };
  const st = [db.prepare('DELETE FROM events WHERE id = ?').bind(id)];
  if (row.flyer_id) st.push(db.prepare('DELETE FROM event_flyers WHERE id = ?').bind(row.flyer_id));
  await db.batch(st);
  return { ok: true };
}

/** GET /api/flyer?id=<id>&size=480|900 : the picture, cached for a year (a changed flyer has a new id). */
export async function flyerResponse(db, id, size) {
  const notFound = new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!ID_OK.test(String(id || ''))) return notFound;
  await ensureDb(db);
  const row = await db.prepare('SELECT mime, big, small FROM event_flyers WHERE id = ?').bind(id).first();
  if (!row) return notFound;
  const b64 = String(size) === '480' ? row.small : row.big;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const mime = /^image\/(webp|jpeg|png)$/.test(row.mime) ? row.mime : 'image/jpeg';
  return new Response(bytes, { headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
}
