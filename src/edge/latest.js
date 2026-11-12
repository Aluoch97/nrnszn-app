// Latest interview + latest music video, read straight from YouTube at the edge (Cloudflare Pages Functions).
// This replaces the Apps Script "App API" (apps-script/Code.gs, action=latestVideos) with the same answer shape and the
// same rule: the newest PUBLIC video by YouTube publish date, wherever it sits in the playlist (up to 500 items looked at).
// It needs the Cloudflare secret YOUTUBE_API_KEY (the same one /api/playlist uses). About 2 to 4 units of the free daily
// 10,000 per refresh, and the answer is kept for FRESH_SECS (see feeds.js).
import { playlists } from '../data/portal.js';

const API = 'https://www.googleapis.com/youtube/v3/playlistItems';
const MAX_ITEMS = 500;

/** Trim stray spaces, line breaks or quotes that can sneak in when pasting the secret. */
export const cleanKey = (v) => String(v || '').trim().replace(/^['"]+|['"]+$/g, '');

/** From YouTube's playlistItems: the newest public video, as { id, title, publishedAt }, or null. */
export function pickNewest(items) {
  const playable = (items || []).filter((it) => it?.contentDetails?.videoId && it.contentDetails.videoPublishedAt && it.status?.privacyStatus === 'public');
  if (!playable.length) return null;
  playable.sort((a, b) => b.contentDetails.videoPublishedAt.localeCompare(a.contentDetails.videoPublishedAt));
  const top = playable[0];
  return { id: top.contentDetails.videoId, title: top.snippet?.title || '', publishedAt: top.contentDetails.videoPublishedAt };
}

export async function newestInPlaylist(listId, key) {
  let items = [];
  let pageToken = '';
  do {
    const url = new URL(API);
    url.search = new URLSearchParams({ part: 'snippet,contentDetails,status', playlistId: listId, maxResults: '50', key, ...(pageToken ? { pageToken } : {}) }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`YouTube answered ${res.status}`); // never cached, so the last good copy keeps being served
    const data = await res.json();
    items = items.concat(data.items || []);
    pageToken = data.nextPageToken || '';
  } while (pageToken && items.length < MAX_ITEMS);
  return pickNewest(items);
}

/** The same JSON the Apps Script API sent: { ok: true, interview: Video|null, music: Video|null }. */
export async function loadLatestVideos(key) {
  const [interview, music] = await Promise.all([newestInPlaylist(playlists.interview.id, key), newestInPlaylist(playlists.music.id, key)]);
  if (!interview && !music) throw new Error('YouTube answered without any public videos'); // an empty answer is not cached
  return { ok: true, interview, music };
}
