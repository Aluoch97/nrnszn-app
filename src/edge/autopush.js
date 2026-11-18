// Automatic phone notifications for the site (Nov 18, 2026, Nick): when something new appears, visitors who turned notifications on are told.
//   events   : a new PUBLISHED event dated today or later is added in /admin
//   videos   : a new video on the NuRenaissance YouTube (the Interview and Music Video playlists the site already follows)
//   services : a new service appears in the NuServices sheet
//   gallery  : new photos in NuGallery (Google Drive), grouped by album
//   cinema   : a new film, show or episode in the NuCinema sheet
// Each kind is its own switch in /admin > Phone notifications > Automatic, all OFF until Nick turns them on. There is no timer: normal page views
// (the cookieless /api/hit beacon) run a quick check at most every 10 minutes, and saving an event in /admin runs one at once. It sends only between 9 AM
// and 9 PM Central, shares the 3-a-day limit with manual sends, and when several kinds have news at once it sends ONE digest. Every item is "claimed" in
// push_auto_seen BEFORE it is sent (so two data centres never announce the same thing), and turning a kind on first records everything that exists, silently.
import { ensurePush, pushSend } from './push.js';
import { listPublic } from './events.js';
import { FEEDS } from './feeds.js';

export const KINDS = ['events', 'videos', 'services', 'gallery', 'cinema'];
export const QUIET_START = 9, QUIET_END = 21;
const TZ = 'America/Chicago';
const DDL = ['CREATE TABLE IF NOT EXISTS push_auto_seen (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, key))',
  'CREATE TABLE IF NOT EXISTS push_auto_cfg (kind TEXT PRIMARY KEY, on_ INTEGER NOT NULL DEFAULT 0)'];
export const ensureAuto = async (db) => { await ensurePush(db); await db.batch(DDL.map((s) => db.prepare(s))); };
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const centralToday = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
export const centralHour = (now) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? MON[+m[2] - 1] + ' ' + +m[3] : ''; };

export async function getAutoSettings(db) {
  await ensureAuto(db);
  const on = {}; for (const r of (await db.prepare('SELECT kind, on_ FROM push_auto_cfg').all()).results) on[r.kind] = !!r.on_;
  return Object.fromEntries(KINDS.map((k) => [k, on[k] === true]));
}
const claim = async (db, kind, key, now) => Number(((await db.prepare('INSERT OR IGNORE INTO push_auto_seen (kind, key, at) VALUES (?,?,?)').bind(kind, key, now).run()).meta || {}).changes) || 0;
const unclaim = (db, kind, key) => db.prepare('DELETE FROM push_auto_seen WHERE kind = ? AND key = ?').bind(kind, key).run();

// The feeds are read through the site's own cached copies (/api/feed/<name>, kept 5 minutes at Cloudflare) so the check never adds load on Google or YouTube
// beyond what visitors already cause; without an address (tests, or no request at hand) the feed code is called directly.
const feedText = async (name, env, origin) => {
  if (!origin) return FEEDS[name].load(env);
  const r = await fetch(origin + '/api/feed/' + name, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('feed ' + name + ' answered ' + r.status);
  return r.text();
};

// ---- what exists right now, per kind: [{ key, title, ... }], or null when that source cannot be read (then nothing is touched) ----
export const SOURCES = {
  async events(env, now) {
    const today = centralToday(now);
    return (await listPublic(env.DB)).filter((e) => e.day >= today).map((e) => ({ key: e.id, title: e.title, day: e.day, where: e.where, slug: e.slug }));
  },
  async videos(env, now, origin) {
    const d = JSON.parse(await feedText('latest', env, origin)), out = [];
    if (d.interview && d.interview.id) out.push({ key: d.interview.id, title: d.interview.title, label: 'interview' });
    if (d.music && d.music.id) out.push({ key: d.music.id, title: d.music.title, label: 'music video' });
    return out;
  },
  async services(env, now, origin) {
    const d = JSON.parse(await feedText('services', env, origin));
    return (d.services || []).filter((s) => s.id && s.name).map((s) => ({ key: 'svc:' + s.id, title: s.name }));
  },
  async gallery(env, now, origin) {
    const d = JSON.parse(await feedText('gallery', env, origin)), out = [];
    for (const c of d.categories || []) for (const door of c.doors || []) for (const im of door.images || []) if (im.id) out.push({ key: im.id, title: im.name, door: [c.title, door.title].filter(Boolean).join(' · ') });
    return out;
  },
  async cinema(env, now, origin) {
    const d = JSON.parse(await feedText('cinema', env, origin)), out = [], add = (title, yt, show) => { const key = String(yt || title || '').slice(0, 200); if (key && title) out.push({ key, title: show ? show + ': ' + title : title }); };
    for (const g of d.films || []) for (const it of g.items || []) add(it.title, it.youtube);
    for (const s of d.shows || []) for (const ep of s.episodes || []) add(/^Watch /.test(ep.title) && (s.episodes || []).length === 1 ? s.title : ep.title, ep.youtube, /^Watch /.test(ep.title) && (s.episodes || []).length === 1 ? '' : s.title);
    return out;
  },
};
/** Reads the sources for `kinds`; a source that fails is null (skipped). */
export async function gatherAuto(env, kinds, now = Date.now(), sources = SOURCES, origin = '') {
  const data = {};
  for (const k of kinds) { try { data[k] = await sources[k](env, now, origin); } catch (e) { data[k] = null; } }
  return data;
}

/** Owner flips the switches. A kind that goes from off to on first records everything that exists now (no notifications for old things). */
export async function setAutoSettings(db, want, env, now = Date.now(), sources = SOURCES, origin = '') {
  await ensureAuto(db); want = want || {};
  const cur = await getAutoSettings(db), next = Object.fromEntries(KINDS.map((k) => [k, want[k] === true]));
  const turningOn = KINDS.filter((k) => next[k] && !cur[k]);
  const data = await gatherAuto(env, turningOn, now, sources, origin);
  for (const k of turningOn) {
    if (data[k] === null) { next[k] = false; continue; }   // the source cannot be read right now: leave it off rather than announce its whole backlog later
    for (const it of data[k]) await claim(db, k, it.key, now);
  }
  for (const k of KINDS) await db.prepare('INSERT OR REPLACE INTO push_auto_cfg (kind, on_) VALUES (?, ?)').bind(k, next[k] ? 1 : 0).run();
  return next;
}

function batchFor(kind, items) {
  const n = items.length;
  if (kind === 'events') return n === 1
    ? { title: 'New event', body: clean([items[0].title, pretty(items[0].day), items[0].where].filter(Boolean).join(' · '), 140), url: '/events/' + items[0].slug + '/', short: 'New event: ' + items[0].title }
    : { title: n + ' new events', body: clean(items.map((i) => i.title).join(' · '), 140), url: '/events', short: n + ' new events' };
  if (kind === 'videos') return n === 1
    ? { title: 'New on YouTube', body: clean(items[0].title + ' (' + items[0].label + ')', 140), url: '/', short: 'New ' + items[0].label + ': ' + items[0].title }
    : { title: 'New on YouTube', body: clean(items.map((i) => i.title).join(' · '), 140), url: '/', short: n + ' new videos' };
  if (kind === 'services') return n === 1
    ? { title: 'New service', body: clean(items[0].title, 140), url: '/services', short: 'New service: ' + items[0].title }
    : { title: n + ' new services', body: clean(items.map((i) => i.title).join(' · '), 140), url: '/services', short: n + ' new services' };
  if (kind === 'gallery') {
    const doors = new Map(); for (const i of items) doors.set(i.door, (doors.get(i.door) || 0) + 1);
    const text = doors.size === 1 ? n + (n === 1 ? ' new photo in ' : ' new photos in ') + [...doors.keys()][0] : n + ' new photos across ' + doors.size + ' albums';
    return { title: 'New in the gallery', body: clean(text, 140), url: '/gallery', short: text };
  }
  return n === 1
    ? { title: 'New on NuCinema', body: clean(items[0].title, 140), url: '/cinema', short: 'New on NuCinema: ' + items[0].title }
    : { title: n + ' new on NuCinema', body: clean(items.map((i) => i.title).join(' · '), 140), url: '/cinema', short: n + ' new on NuCinema' };
}

/** One check. `data` = { kind: items|null } for the ENABLED kinds. Returns what happened (for the tests). */
export async function runAuto(db, env, data, { now = Date.now(), fetchFn = fetch } = {}) {
  const set = await getAutoSettings(db), out = { sent: [], skipped: '' };
  const kinds = KINDS.filter((k) => set[k] && Array.isArray(data[k]));
  if (!KINDS.some((k) => set[k])) { out.skipped = 'off'; return out; }
  const hour = centralHour(now); if (hour < QUIET_START || hour >= QUIET_END) { out.skipped = 'quiet hours'; return out; }
  const batches = [];
  for (const k of kinds) {
    const fresh = []; for (const it of data[k]) if (await claim(db, k, it.key, now)) fresh.push(it);
    if (fresh.length) batches.push({ kind: k, items: fresh, ...batchFor(k, fresh) });
  }
  if (!batches.length) return out;
  const msg = batches.length === 1 ? batches[0] : { title: 'New on NuRenaissance', body: clean(batches.map((b) => b.short).join(' · '), 140), url: '/' };
  const release = async () => { for (const b of batches) for (const i of b.items) await unclaim(db, b.kind, i.key); };
  try {
    const r = await pushSend(db, env, { title: msg.title, body: msg.body, url: msg.url }, { fetchFn, now });
    out.sent.push({ kinds: batches.map((b) => b.kind), phones: r.sent, title: msg.title });
    if (r.sent === 0 && r.failed > 0) await release();   // nothing reached a phone: try again next time
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/Nobody has turned on/.test(m)) { out.sent.push({ kinds: batches.map((b) => b.kind), phones: 0, title: msg.title }); return out; }   // nobody to tell: counted as seen
    await release(); out.skipped = m.slice(0, 120);   // the daily limit or a keys problem: keep them for the next check
  }
  return out;
}

/** The check a page view (or saving an event) starts. At most every 10 minutes per data centre unless forced. Never throws. */
export async function maybeAuto(env, { force = false, now = Date.now(), sources = SOURCES, fetchFn = fetch, origin = '' } = {}) {
  try {
    if (!env || !env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
    const mem = globalThis.__nrnAuto || (globalThis.__nrnAuto = { at: 0 });
    if (!force && now - mem.at < 10 * 60 * 1000) return null; mem.at = now;
    const set = await getAutoSettings(env.DB), on = KINDS.filter((k) => set[k]); if (!on.length) return null;
    return await runAuto(env.DB, env, await gatherAuto(env, on, now, sources, origin), { now, fetchFn });
  } catch (e) { return null; }
}
