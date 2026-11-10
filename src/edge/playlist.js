// YouTube playlist reader for /api/playlist?list=<id> (used by the Certified Lounge app's video screen).
// Main path: the official YouTube Data API, with the key in the Cloudflare secret YOUTUBE_API_KEY.
// Backup path (no key, or the API fails): read the public playlist page and take the video list out
// of the data the page carries (ytInitialData). If both fail, nothing is cached, the last good copy
// keeps being served, and the app falls back to its plain player. The daily backend check catches it.

const ID = /^[A-Za-z0-9_-]{10,64}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;

export function playlistUrl(list) {
  return `https://www.youtube.com/playlist?list=${list}`;
}

const text = (t) => (t == null ? '' : typeof t === 'string' ? t : t.content ?? t.simpleText ?? (t.runs || []).map((r) => r.text).join('') ?? '');

// Pull the videos out of ytInitialData. Handles the current page format (lockupViewModel)
// and the older one (playlistVideoRenderer).
export function parsePlaylist(data) {
  const videos = [];
  const seen = new Set();
  const add = (v) => { if (VIDEO.test(v.id) && !seen.has(v.id) && v.title) { seen.add(v.id); videos.push(v); } };
  const walk = (o) => {
    if (!o || typeof o !== 'object' || videos.length >= 100) return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const lk = o.lockupViewModel;
    if (lk && lk.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const md = lk.metadata?.lockupMetadataViewModel || {};
      let duration = '';
      JSON.stringify(lk.contentImage || {}).replace(/"thumbnailBadgeViewModel":\{"text":"([^"]+)"/, (_, t) => { duration = t; return _; });
      const parts = (md.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap((r) => (r.metadataParts || []).map((p) => text(p.text))).filter(Boolean);
      add({ id: lk.contentId, title: text(md.title).trim(), duration, age: parts.find((p) => /\bago$/.test(p)) || '' }); // e.g. "1y ago"
      return;
    }
    const pv = o.playlistVideoRenderer;
    if (pv) {
      add({ id: pv.videoId, title: text(pv.title).trim(), duration: text(pv.lengthText), age: (pv.videoInfo?.runs || []).map((r) => r.text).find((t) => /\bago$/.test(t)) || '' });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(data);
  const title = text(data?.metadata?.playlistMetadataRenderer?.title) || text(data?.header?.pageHeaderRenderer?.pageTitle) || '';
  return { title, videos };
}

export function extractInitialData(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html) || /window\["ytInitialData"\] = (\{.*?\});/s.exec(html);
  if (!m) throw new Error('playlist page without ytInitialData');
  return JSON.parse(m[1]);
}

// ---------- YouTube Data API ----------
// About 5 units of the free 10,000/day per refresh (playlist title, up to 2 pages of items, durations).

const API = 'https://www.googleapis.com/youtube/v3/';

async function api(path, params, key) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`youtube api ${res.status}: ${data.error?.message || 'error'}`);
  return data;
}

// "PT1H2M3S" -> "1:02:03", "PT4M5S" -> "4:05" (the same look as YouTube's own badges).
export function formatDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return '';
  const h = Number(m[1] || 0) * 24 + Number(m[2] || 0), min = Number(m[3] || 0), sec = Number(m[4] || 0);
  if (!h && !min && !sec) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(min)}:${pad(sec)}` : `${min}:${pad(sec)}`;
}

// "2026-08-01T..." -> "3 months ago"
export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const s = Math.max(0, (now - t) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export async function loadPlaylistViaApi(list, key, now = Date.now()) {
  const [meta, items] = await Promise.all([
    api('playlists', { part: 'snippet', id: list }, key),
    (async () => {
      const out = [];
      let pageToken = '';
      for (let page = 0; page < 2; page++) { // up to 100 videos, same cap as the page reader
        const d = await api('playlistItems', { part: 'snippet,contentDetails,status', playlistId: list, maxResults: '50', ...(pageToken && { pageToken }) }, key);
        out.push(...(d.items || []));
        pageToken = d.nextPageToken || '';
        if (!pageToken) break;
      }
      return out;
    })(),
  ]);
  const seen = new Set();
  const picked = items.filter((it) => {
    const id = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
    const title = it.snippet?.title || '';
    const ok = VIDEO.test(id || '') && !seen.has(id) && it.status?.privacyStatus !== 'private'
      && title !== 'Private video' && title !== 'Deleted video';
    if (ok) seen.add(id);
    return ok;
  });
  if (!picked.length) throw new Error('no videos found');
  const ids = picked.map((it) => it.contentDetails?.videoId || it.snippet.resourceId.videoId);
  const durations = {};
  for (let i = 0; i < ids.length; i += 50) {
    const d = await api('videos', { part: 'contentDetails', id: ids.slice(i, i + 50).join(',') }, key);
    for (const v of d.items || []) durations[v.id] = formatDuration(v.contentDetails?.duration);
  }
  const videos = picked.map((it, i) => ({
    id: ids[i],
    title: it.snippet.title.trim(),
    duration: durations[ids[i]] || '',
    age: timeAgo(it.contentDetails?.videoPublishedAt, now),
  }));
  return { ok: true, list, title: meta.items?.[0]?.snippet?.title || '', videos, source: 'api' };
}

// key: the YouTube API key, if set. Falls back to reading the page when there's no key or the API fails.
export async function loadPlaylist(list, key) {
  if (!ID.test(list)) throw new Error('bad playlist id');
  if (key) {
    try {
      return await loadPlaylistViaApi(list, key);
    } catch (e) {
      console.error(`playlist ${list}: API failed, reading the page instead`, e);
    }
  }
  return loadPlaylistFromPage(list);
}

async function loadPlaylistFromPage(list) {
  const res = await fetch(playlistUrl(list), {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`youtube ${res.status}`);
  const { title, videos } = parsePlaylist(extractInitialData(await res.text()));
  if (!videos.length) throw new Error('no videos found');
  return { ok: true, list, title, videos, source: 'page' };
}

export const isPlaylistId = (v) => ID.test(v || '');
