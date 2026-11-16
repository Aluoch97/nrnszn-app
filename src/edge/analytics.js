// Cookieless website analytics, made by the site itself (no Google Analytics, no cookies, no ads).
//
//   POST /api/hit   {p: "/events", r: "<referrer>", w: 390}   sent by /hit.js once per page load. Always answers 204 and says nothing.
//   /admin          shows page views, visitors, top pages, where people come from, devices and cities (see summary()).
//
// What is kept per page view: the day, the page address (no query, no #), a device size class, the website they came from, the country/region/city
// Cloudflare works out from the connection, and an anonymous visitor code. The IP address is NEVER stored. The visitor code is a one-way hash of
// (a secret key + the day + the IP + the browser name) that changes every day, so a person can be counted once per day but cannot be recognised on
// another day or traced back to an IP. Browsers that send Do Not Track, robots, and the owner's own visits (signed in to /admin) are left out.
// Rows older than 400 days are deleted. public/privacy-policy says all of this in plain words: keep them in step.
import { ensureDb, hasDb } from './db.js';

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|uptime|lighthouse|headless|curl|wget|python|node-fetch|axios|go-http|java\/|httpclient|scrapy|ahrefs|semrush|mj12|dotbot|bingpreview|whatsapp|telegram|discord|skype/i;
export const KEEP_DAYS = 400;
export const FLOOD_PER_HOUR = 300;
const HOUR = 3600 * 1000, DAY = 24 * HOUR;

/** YYYY-MM-DD in Nashville time, so "today" matches the owner's day. */
export const chicagoDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export const deviceOf = (w) => { const n = Number(w); return !(n > 0) ? 'computer' : n < 600 ? 'phone' : n < 1024 ? 'tablet' : 'computer'; };

/** "/events?x=1#a" -> "/events" ; anything that is not an ordinary page address of this site -> '' */
export function cleanPath(p) {
  let s = String(p == null ? '' : p).split('#')[0].split('?')[0];
  if (!s.startsWith('/') || s.startsWith('//') || s.length > 200 || /[\s<>"'\\]/.test(s)) return '';
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (/^\/(admin|api|_astro|widgets)(\/|$)/.test(s)) return '';
  return s || '/';
}
/** The website a visitor came from (just the host), or '' when it is this site or not a web address. */
export function refHost(ref, siteHost) {
  try {
    const u = new URL(String(ref || '')); if (!/^https?:$/.test(u.protocol)) return '';
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    return h === String(siteHost || '').replace(/^www\./, '').toLowerCase() ? '' : h.slice(0, 80);
  } catch { return ''; }
}

async function visitorCode(env, day, ip, ua) {
  const salt = String((env && (env.ANALYTICS_SALT || env.ADMIN_PASSWORD)) || '');
  if (!salt || !ip) return '';   // with no secret key, visitors are simply not counted (page views still are)
  const data = new TextEncoder().encode(`${salt}|nrn-visitor|${day}|${ip}|${ua}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

const quiet = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

/** Handles POST /api/hit. Every skip path answers the same 204, so nothing can be learned from the reply. */
export async function recordHit({ request, env }, now = Date.now()) {
  try {
    env = env || {};
    if (!hasDb(env)) return quiet();
    if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return quiet();
    const ua = request.headers.get('user-agent') || '';
    if (!ua || BOT.test(ua)) return quiet();
    let body = {}; try { body = JSON.parse(await request.text()); } catch { return quiet(); }
    const path = cleanPath(body && body.p); if (!path) return quiet();
    const day = chicagoDay(now), ip = request.headers.get('cf-connecting-ip') || '';
    const visitor = await visitorCode(env, day, ip, ua);
    await ensureDb(env.DB);
    if (visitor) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM page_views WHERE visitor = ? AND ts > ?').bind(visitor, now - HOUR).first();
      if (n && n.n >= FLOOD_PER_HOUR) return quiet();
    }
    const cf = request.cf || {};
    const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
    await env.DB.prepare('INSERT INTO page_views (ts, day, path, visitor, device, ref, country, region, city) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(now, day, path, visitor, deviceOf(body.w), refHost(body.r, new URL(request.url).hostname), cut(cf.country, 2), cut(cf.region, 60), cut(cf.city, 60)).run();
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM page_views WHERE ts < ?').bind(now - KEEP_DAYS * DAY).run();   // tidy up now and then
  } catch (e) { console.error('hit not recorded', e); }
  return quiet();
}

/** The numbers for /admin: the last `days` days (7, 30 or 90) and the same length before them for comparison. */
export async function summary(db, days = 30, now = Date.now()) {
  days = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  await ensureDb(db);
  const dayList = (from, count) => Array.from({ length: count }, (_, i) => chicagoDay(now - (from - i) * DAY));
  const current = dayList(days - 1, days), previous = dayList(2 * days - 1, days);
  const first = current[0], prevFirst = previous[0], prevLast = previous[previous.length - 1];
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
  const perDay = async (from, to) => {
    const rows = await all('SELECT day, COUNT(*) AS views, COUNT(DISTINCT NULLIF(visitor, \'\')) AS visitors FROM page_views WHERE day >= ? AND day <= ? GROUP BY day', from, to);
    return Object.fromEntries(rows.map((r) => [r.day, r]));
  };
  const cur = await perDay(first, current[current.length - 1]), prev = await perDay(prevFirst, prevLast);
  const sum = (m, k) => Object.values(m).reduce((n, r) => n + (r[k] || 0), 0);
  const top = (sql, ...a) => all(sql, ...a);
  const [pages, refs, devices, countries, cities] = await Promise.all([
    top('SELECT path AS name, COUNT(*) AS views FROM page_views WHERE day >= ? GROUP BY path ORDER BY views DESC, name LIMIT 10', first),
    top('SELECT ref AS name, COUNT(*) AS views FROM page_views WHERE day >= ? AND ref != \'\' GROUP BY ref ORDER BY views DESC, name LIMIT 8', first),
    top('SELECT device AS name, COUNT(*) AS views FROM page_views WHERE day >= ? GROUP BY device ORDER BY views DESC, name', first),
    top('SELECT country AS name, COUNT(*) AS views FROM page_views WHERE day >= ? AND country != \'\' GROUP BY country ORDER BY views DESC, name LIMIT 8', first),
    top('SELECT city, region, country, COUNT(*) AS views FROM page_views WHERE day >= ? AND city != \'\' GROUP BY city, region, country ORDER BY views DESC, city LIMIT 8', first),
  ]);
  const visitors = sum(cur, 'visitors'), views = sum(cur, 'views');
  return {
    days, from: first, to: current[current.length - 1],
    views, visitors, viewsPerVisitor: visitors ? Math.round((views / visitors) * 10) / 10 : null,
    previous: { views: sum(prev, 'views'), visitors: sum(prev, 'visitors') },
    daily: current.map((d) => ({ day: d, views: (cur[d] || {}).views || 0, visitors: (cur[d] || {}).visitors || 0 })),
    pages, referrers: refs, devices, countries,
    cities: cities.map((c) => ({ name: [c.city, c.region].filter(Boolean).join(', ') + (c.country && c.country !== 'US' ? ` (${c.country})` : ''), views: c.views })),
  };
}
