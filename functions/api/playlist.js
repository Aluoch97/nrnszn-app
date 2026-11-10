// /api/playlist?list=<YouTube playlist id>: the playlist's videos as JSON, cached at Cloudflare like the feeds
// (30-minute copies, served stale while refreshing, up to a week if YouTube fails). Used by play.nrnszn.com.
// Uses the YouTube Data API when the Cloudflare secret YOUTUBE_API_KEY is set; otherwise reads the playlist page.
import { serveCached } from '../../src/edge/feeds.js';
import { loadPlaylist, isPlaylistId } from '../../src/edge/playlist.js';

const PLAYLIST_FRESH_SECS = 30 * 60; // keeps API use to about 1,200 of the 10,000 free daily units at most
const CORS = { 'access-control-allow-origin': '*' }; // public data; the Certified Lounge app reads it from play.nrnszn.com

export async function onRequestGet(context) {
  const list = new URL(context.request.url).searchParams.get('list') || '';
  if (!isPlaylistId(list)) return new Response(JSON.stringify({ ok: false, error: 'bad playlist id' }), { status: 400, headers: { 'content-type': 'application/json', ...CORS } });
  // Trim stray spaces, line breaks or quotes that can sneak in when pasting the secret.
  const key = String(context.env?.YOUTUBE_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '');
  return serveCached(`playlist-${list}`, async () => JSON.stringify(await loadPlaylist(list, key)), context, Date.now(), CORS, PLAYLIST_FRESH_SECS);
}
