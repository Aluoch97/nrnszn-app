// /api/playlist?list=<YouTube playlist id>: the playlist's videos as JSON, cached at Cloudflare like the feeds
// (5-minute copies, served stale while refreshing, up to a week if YouTube fails). Used by play.nrnszn.com.
import { serveCached } from '../../src/edge/feeds.js';
import { loadPlaylist, isPlaylistId } from '../../src/edge/playlist.js';

const CORS = { 'access-control-allow-origin': '*' }; // public data; the Certified Lounge app reads it from play.nrnszn.com

export async function onRequestGet(context) {
  const list = new URL(context.request.url).searchParams.get('list') || '';
  if (!isPlaylistId(list)) return new Response(JSON.stringify({ ok: false, error: 'bad playlist id' }), { status: 400, headers: { 'content-type': 'application/json', ...CORS } });
  return serveCached(`playlist-${list}`, async () => JSON.stringify(await loadPlaylist(list)), context, Date.now(), CORS);
}
