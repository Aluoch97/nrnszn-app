// Edge cache for the read-only Google Apps Script feeds (Cloudflare Pages Functions).
//
// Each feed is kept at Cloudflare for FRESH_SECS. After that the old copy is
// still answered instantly while a fresh one is fetched in the background
// ("stale while revalidate"); if Google is down or rate-limited, the last good
// copy keeps being served for up to KEEP_SECS. A copy is only stored when the
// upstream answer looks right, so a Google error page is never cached.
//
// Writes (bookings, payments, survey answers, click counts) never come here:
// the pages send those straight to Google.
import { SERVICES_API_URL } from '../data/services.js';
import { cleanKey, loadLatestVideos } from './latest.js';
import { loadGallery, GALLERY_ROOT_FOLDER_ID } from './gallery.js';

export const FRESH_SECS = 300; // 5 minutes
export const KEEP_SECS = 7 * 24 * 3600; // a week

// Same addresses the widgets fall back to (public/widgets/cinema.html, gallery.html).
const CINEMA_URL = 'https://script.google.com/macros/s/AKfycbwvTktScBSsHqzk2_T1CmL1wDjEvcrye23VKbuMdiqqsp6SW5Wj7wlN06Eoje45GYgK/exec';
const GALLERY_URL = 'https://script.google.com/macros/s/AKfycbxDNK16PU32crdDeibSDgZWIUZXOSzuGP_MbemJxLYEeBL-E1RqqEYwNlQ6OQpEIY9T/exec';

// Drive thumbnails (drive.google.com/thumbnail?id=…&sz=w500) go through /api/drive so Cloudflare caches the photos too.
export function viaDrive(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'drive.google.com' || u.pathname !== '/thumbnail') return url;
    const id = u.searchParams.get('id') || '', sz = u.searchParams.get('sz') || 'w500';
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(id) || !/^w\d{2,4}$/.test(sz)) return url;
    return `/api/drive?id=${id}&sz=${sz}`;
  } catch {
    return url;
  }
}

function galleryOk(d) { return !d.error && Array.isArray(d.categories) && d.categories.length > 0; }
function shapeGallery(d) {
  for (const c of d.categories) for (const door of c.doors || []) for (const im of door.images || []) {
    if (im.thumbUrl) im.thumbUrl = viaDrive(im.thumbUrl);
    if (im.fullUrl) im.fullUrl = viaDrive(im.fullUrl);
  }
  return d;
}

export const FEEDS = {
  services: {
    url: () => `${SERVICES_API_URL}?action=data`,
    ok: (d) => Array.isArray(d.services) && d.services.length > 0,
  },
  cinema: {
    url: () => CINEMA_URL,
    ok: (d) => Array.isArray(d.films) && d.films.length > 0,
  },
  gallery: {
    url: () => GALLERY_URL,
    ok: galleryOk,
    shape: shapeGallery,
    // Read from Google Drive at the edge when the Cloudflare secret GOOGLE_SERVICE_ACCOUNT_JSON is set (src/edge/gallery.js);
    // until then, or if Drive fails, the old Apps Script backend.
    load: async (env) => {
      const secret = String(env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
      if (secret) {
        try {
          const d = await loadGallery(secret, env.GALLERY_ROOT_FOLDER_ID || GALLERY_ROOT_FOLDER_ID);
          if (!galleryOk(d)) throw new Error('Drive gave an empty gallery');
          return JSON.stringify({ ...shapeGallery(d), source: 'drive' }); // lets you see at a glance that Drive (not the old backend) answered
        } catch (e) { console.error('gallery via Drive failed, using Apps Script', e); }
      }
      return loadJson(GALLERY_URL, galleryOk, shapeGallery);
    },
  },
  // Latest interview + music video for Home and Portal. Read from YouTube at the edge when the Cloudflare secret
  // YOUTUBE_API_KEY is set (src/edge/latest.js); until then, or if YouTube fails, the old Apps Script API (PUBLIC_API_URL).
  latest: {
    load: async (env) => {
      const key = cleanKey(env.YOUTUBE_API_KEY);
      if (key) {
        try { return JSON.stringify(await loadLatestVideos(key)); }
        catch (e) { if (!env.PUBLIC_API_URL) throw e; console.error('latest videos via YouTube failed, using the old API', e); }
      }
      if (!env.PUBLIC_API_URL) throw new Error('feed not configured');
      const u = new URL(env.PUBLIC_API_URL);
      u.searchParams.set('action', 'latestVideos');
      return loadJson(u.toString(), (d) => d && d.ok === true);
    },
  },
};

async function loadJson(url, ok, shape) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const data = await res.json(); // an HTML error/quota page fails here and is never cached
  if (!ok(data)) throw new Error('upstream answered without the expected data');
  return JSON.stringify(shape ? shape(data) : data);
}

async function load(feed, env) {
  if (feed.load) return feed.load(env);
  const url = feed.url(env);
  if (!url) throw new Error('feed not configured');
  return loadJson(url, feed.ok, feed.shape);
}

function reply(body, state, ageSecs, extraHeaders = {}) {
  return new Response(body, {
    headers: {
      ...extraHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-feed-cache': state, // HIT, STALE (refreshing in the background) or MISS
      'x-feed-age': String(Math.round(ageSecs)),
    },
  });
}

export async function serveFeed(name, context, now = Date.now()) {
  const feed = FEEDS[name];
  if (!feed) return new Response('Not found', { status: 404 });
  return serveCached(name, () => load(feed, context.env || {}), context, now);
}

// Stale-while-revalidate cache around any loader that returns a JSON string (throws when the answer looks wrong).
// freshSecs: how long a copy counts as fresh (default FRESH_SECS). The playlist reader uses longer,
// to stay well inside the YouTube API's free daily allowance.
export async function serveCached(name, loadBody, context, now = Date.now(), extraHeaders = {}, freshSecs = FRESH_SECS) {
  const cache = caches.default;
  const key = new Request(new URL(`/__feed-cache/${name}`, context.request.url).toString());
  const hit = await cache.match(key);
  const age = hit ? (now - Number(hit.headers.get('x-fetched-at') || 0)) / 1000 : Infinity;

  const refresh = async () => {
    const body = await loadBody();
    await cache.put(key, new Response(body, {
      headers: { 'content-type': 'application/json', 'x-fetched-at': String(now), 'cache-control': `public, max-age=${KEEP_SECS}` },
    }));
    return body;
  };

  if (hit && age < freshSecs) return reply(await hit.text(), 'HIT', age, extraHeaders);
  if (hit && age < KEEP_SECS) {
    context.waitUntil(refresh().catch((e) => console.error(`feed ${name} refresh`, e)));
    return reply(await hit.text(), 'STALE', age, extraHeaders);
  }
  try {
    return reply(await refresh(), 'MISS', 0, extraHeaders);
  } catch (e) {
    console.error(`feed ${name}`, e);
    return new Response(JSON.stringify({ ok: false, error: 'feed unavailable' }), {
      status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
    });
  }
}

// Gallery photos: cached at Cloudflare for 30 days (a Drive file id's thumbnail doesn't change).
export async function serveDrive(context) {
  const u = new URL(context.request.url);
  const id = u.searchParams.get('id') || '', sz = u.searchParams.get('sz') || 'w500';
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(id) || !/^w\d{2,4}$/.test(sz)) return new Response('Bad request', { status: 400 });
  const res = await fetch(`https://drive.google.com/thumbnail?id=${id}&sz=${sz}`, {
    redirect: 'follow',
    cf: { cacheEverything: true, cacheTtl: 30 * 24 * 3600 },
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(res.body, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=2592000, immutable' },
  });
}
