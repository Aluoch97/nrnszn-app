// YouTube playlist reader for /api/playlist?list=<id> (used by the Certified Lounge app's video screen).
// YouTube's playlist RSS feed no longer answers, and the Data API needs a key, so this reads the
// public playlist page and takes the video list out of the data the page carries (ytInitialData).
// If YouTube changes that format, parsing finds no videos, nothing is cached, and the app falls back
// to its plain player. The daily backend check (scripts/check-backends.mjs) catches it.

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

export async function loadPlaylist(list) {
  if (!ID.test(list)) throw new Error('bad playlist id');
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
  return { ok: true, list, title, videos };
}

export const isPlaylistId = (v) => ID.test(v || '');
