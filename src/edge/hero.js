// Page videos (Nov 21, 2026, Nick: "a function on the admin page that lets me upload videos for each section, and change them
// when I want"). /admin > Page videos makes a short, silent loop on Nick's phone (src/pages/admin.astro, mediabunny) in two sizes
// plus a still picture, and sends them here. They live in the R2 bucket bound as `MEDIA` (private: this file serves them), with
// a small list `hero/manifest.json` saying which upload each page shows. A page with no video keeps its pictures.
//
//   GET  /api/hero                                   public: { on, videos: { <page>: <version> } } (kept 60 s)
//   GET  /api/hero?file=<page>/<version>/<part>      public: the file, with Range support (iPhones need it), kept a year
//   PUT  /api/hero?page=&v=&part=   + admin token    one part of a new upload (large.mp4, small.mp4 or poster.jpg)
//   POST /api/hero {action:'set', page, v}  + token  show that upload (all three parts must be there); older ones are deleted
//   POST /api/hero {action:'remove', page}  + token  back to the pictures; its files are deleted
import { verifyToken } from './admin.js';

export const PAGES = [
  { id: 'home', label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'events', label: 'Events' },
  { id: 'media', label: 'Media' },
  { id: 'apps', label: 'Apps' },
  { id: 'about', label: 'About' },
  { id: 'support', label: 'Support' },
];
const IDS = PAGES.map((p) => p.id);
export const PARTS = { 'large.mp4': { type: 'video/mp4', max: 40_000_000 }, 'small.mp4': { type: 'video/mp4', max: 20_000_000 }, 'poster.jpg': { type: 'image/jpeg', max: 1_500_000 } };
const MANIFEST = 'hero/manifest.json';
const V_RE = /^[a-z0-9]{6,24}$/;
// How the video sits in the header (Nov 21, 2026, Nick: "move the video up or down"): x / y = the point kept in view, in percent
// (CSS object-position), z = zoom (1 = fill the header, up to 2.5). Applied when the page shows it, so it can change any time.
export const DEFAULT_FRAME = { x: 50, y: 50, z: 1 };
export function cleanFrame(f) {
  if (!f || typeof f !== 'object') return null;
  const n = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Math.round(Number(v) * 100) / 100 : null);
  const x = n(f.x, 0, 100), y = n(f.y, 0, 100), z = n(f.z, 1, 2.5);
  return x === null || y === null || z === null ? null : { x, y, z };
}

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
export const heroOn = (env) => !!(env && env.MEDIA && typeof env.MEDIA.put === 'function');

export async function readManifest(env) {
  const o = await env.MEDIA.get(MANIFEST);
  if (!o) return {};
  try { const m = JSON.parse(await o.text()); return m && typeof m === 'object' ? m : {}; } catch { return {}; }
}
const writeManifest = (env, m) => env.MEDIA.put(MANIFEST, JSON.stringify(m), { httpMetadata: { contentType: 'application/json' } });
async function deletePrefix(env, prefix, keep = '') {
  let cursor;
  do {
    const r = await env.MEDIA.list({ prefix, cursor });
    const gone = r.objects.map((o) => o.key).filter((k) => !keep || !k.startsWith(keep));
    if (gone.length) await env.MEDIA.delete(gone);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
}

// The first bytes say what a file really is: an MP4 has "ftyp" at byte 4, a JPEG starts FF D8 FF.
export function looksRight(part, head) {
  if (part === 'poster.jpg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return String.fromCharCode(head[4], head[5], head[6], head[7]) === 'ftyp';
}

function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(h || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') { const n = Math.min(+m[2], size); start = size - n; end = size - 1; }
  else { start = +m[1]; end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1); }
  return start <= end && start < size ? { start, end } : 'bad';
}

async function serveFile(env, request, file) {
  const m = /^([a-z]+)\/([a-z0-9]{6,24})\/(large\.mp4|small\.mp4|poster\.jpg)$/.exec(file);
  if (!m || !IDS.includes(m[1])) return new Response('Not found', { status: 404 });
  const key = `hero/${file}`, type = PARTS[m[3]].type;
  const head = await env.MEDIA.head(key);
  if (!head) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const base = { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', etag: head.httpEtag };
  const r = parseRange(request.headers.get('range'), head.size);
  if (r === 'bad') return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${head.size}` } });
  if (request.method === 'HEAD') return new Response(null, { headers: { ...base, 'content-length': String(head.size) } });
  if (r) {
    const o = await env.MEDIA.get(key, { range: { offset: r.start, length: r.end - r.start + 1 } });
    return new Response(o.body, { status: 206, headers: { ...base, 'content-range': `bytes ${r.start}-${r.end}/${head.size}`, 'content-length': String(r.end - r.start + 1) } });
  }
  const o = await env.MEDIA.get(key);
  return new Response(o.body, { headers: { ...base, 'content-length': String(head.size) } });
}

export async function heroRequest({ request, env }) {
  env = env || {};
  const url = new URL(request.url), method = request.method;
  if (method === 'GET' || method === 'HEAD') {
    if (!heroOn(env)) return json({ on: false, videos: {} }, 200, { 'cache-control': 'public, max-age=60' });
    const file = url.searchParams.get('file');
    if (file) return serveFile(env, request, file);
    const m = await readManifest(env), videos = {}, frames = {};
    for (const id of IDS) if (m[id] && V_RE.test(String(m[id].v))) { videos[id] = m[id].v; frames[id] = cleanFrame(m[id].frame) || DEFAULT_FRAME; }
    return json({ on: true, videos, frames }, 200, { 'cache-control': 'public, max-age=60' });
  }
  // Everything else is Nick's, from /admin: the admin token, and only from this site's own pages.
  const o = request.headers.get('origin');
  if (o && o !== url.origin) return json({ ok: false, message: 'Not allowed from another site.' }, 403);
  if (!(await verifyToken(env, (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')))) return json({ ok: false, message: 'Please sign in again.' }, 401);
  if (!heroOn(env)) return json({ ok: false, message: 'Page videos are not set up yet: connect the R2 bucket as MEDIA (see docs/hero-videos-setup.md).' }, 503);

  if (method === 'PUT') {
    const page = url.searchParams.get('page') || '', v = url.searchParams.get('v') || '', part = url.searchParams.get('part') || '';
    if (!IDS.includes(page) || !V_RE.test(v) || !PARTS[part]) return json({ ok: false, message: 'Unknown page or file.' }, 400);
    const len = Number(request.headers.get('content-length') || 0);
    if (len > PARTS[part].max) return json({ ok: false, message: 'That file is too big. Pick a shorter part of the video.' }, 413);
    const buf = new Uint8Array(await request.arrayBuffer());
    if (!buf.length || buf.length > PARTS[part].max) return json({ ok: false, message: 'That file is too big. Pick a shorter part of the video.' }, 413);
    if (!looksRight(part, buf)) return json({ ok: false, message: 'That file is not the right kind.' }, 400);
    await env.MEDIA.put(`hero/${page}/${v}/${part}`, buf, { httpMetadata: { contentType: PARTS[part].type } });
    return json({ ok: true });
  }
  if (method !== 'POST') return json({ ok: false, message: 'Unknown request.' }, 404);
  let b; try { b = await request.json(); } catch { return json({ ok: false, message: 'Bad request.' }, 400); }
  if (b && b.action === 'list') return json({ ok: true, videos: await readManifest(env) });
  const page = String((b && b.page) || '');
  if (!IDS.includes(page)) return json({ ok: false, message: 'Unknown page.' }, 400);
  const m = await readManifest(env);
  if (b.action === 'set') {
    const v = String(b.v || '');
    if (!V_RE.test(v)) return json({ ok: false, message: 'Unknown upload.' }, 400);
    for (const part of Object.keys(PARTS)) if (!(await env.MEDIA.head(`hero/${page}/${v}/${part}`))) return json({ ok: false, message: 'The upload is not complete. Try again.' }, 400);
    if (b.frame !== undefined && !cleanFrame(b.frame)) return json({ ok: false, message: 'Unknown position.' }, 400);
    m[page] = { v, at: Date.now(), frame: cleanFrame(b.frame) || DEFAULT_FRAME };
    await writeManifest(env, m);
    await deletePrefix(env, `hero/${page}/`, `hero/${page}/${v}/`);   // older uploads for this page
    return json({ ok: true, videos: Object.fromEntries(Object.entries(m).map(([k, x]) => [k, x])) });
  }
  if (b.action === 'frame') {   // move / zoom the video already on a page (no new upload)
    const f = cleanFrame(b.frame);
    if (!f) return json({ ok: false, message: 'Unknown position.' }, 400);
    if (!m[page]) return json({ ok: false, message: 'That page has no video yet.' }, 400);
    m[page].frame = f;
    await writeManifest(env, m);
    return json({ ok: true, frame: f });
  }
  if (b.action === 'remove') {
    delete m[page];
    await writeManifest(env, m);
    await deletePrefix(env, `hero/${page}/`);
    return json({ ok: true });
  }
  return json({ ok: false, message: 'Unknown request.' }, 400);
}
