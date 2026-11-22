// Page videos chosen in /admin > Page videos (src/edge/hero.js). If the page has one, its still picture fades in over the pictures
// (or the Home archway video) and the video plays on top as soon as the phone allows; if there is none, or anything fails, the
// page stays exactly as built. Anyone who asked for less motion or to save data gets only the still picture.
export async function heroVideo(bg: HTMLElement | null, page: string, opts: { className: string; replace?: HTMLVideoElement | null } ) {
  if (!bg || !page) return;
  let v = '', frame = { x: 50, y: 50, z: 1 };
  try {
    const r = await fetch('/api/hero', { headers: { accept: 'application/json' } });
    const j = r.ok ? await r.json() : null;
    v = j && j.videos && typeof j.videos[page] === 'string' && /^[a-z0-9]{6,24}$/.test(j.videos[page]) ? j.videos[page] : '';
    const f = j && j.frames && j.frames[page];
    if (f && [f.x, f.y, f.z].every((n) => typeof n === 'number' && isFinite(n))) frame = { x: Math.min(100, Math.max(0, f.x)), y: Math.min(100, Math.max(0, f.y)), z: Math.min(2.5, Math.max(1, f.z)) };
  } catch { return; }
  if (!v) return;
  const file = (part: string) => `/api/hero?file=${encodeURIComponent(`${page}/${v}/${part}`)}`;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator as any).connection?.saveData;
  const vid = document.createElement('video');
  // iPhones only start a video by themselves when it is muted, inline and says so in its attributes (not just in script).
  vid.className = `${opts.className} hv`;
  vid.muted = true; vid.defaultMuted = true; vid.loop = true; vid.playsInline = true;
  for (const a of ['muted', 'loop', 'playsinline', 'webkit-playsinline', 'disablepictureinpicture']) vid.setAttribute(a, '');
  vid.setAttribute('aria-hidden', 'true'); vid.preload = still ? 'none' : 'auto'; vid.poster = file('poster.jpg');
  // Astro's page styles reach only elements that carry the page's style marker, so copy it from the header.
  for (const a of [...bg.attributes]) if (a.name.startsWith('data-astro-cid')) vid.setAttribute(a.name, a.value);
  applyFrame(vid, frame);
  vid.style.opacity = '0'; vid.style.transition = 'opacity 1.2s ease';
  for (const [part, media] of [['small.mp4', '(max-width: 760px)'], ['large.mp4', '']]) {
    const s = document.createElement('source'); s.src = file(part); s.type = 'video/mp4'; if (media) s.media = media; vid.appendChild(s);
  }
  // The still picture shows as soon as it has loaded, so the header is right even when the phone will not play videos on its own
  // (iPhone Low Power Mode, data saving, or a refused autoplay); the video then moves on top of it whenever it does start.
  let shown = false;
  const show = () => { if (shown) return; shown = true; vid.style.opacity = '1'; bg.dataset.video = 'on'; if (opts.replace) setTimeout(() => opts.replace?.pause(), 1300); };
  const img = new Image(); img.onload = show; img.src = vid.poster;
  vid.addEventListener('playing', () => { show(); bg.dataset.video = 'playing'; });
  bg.appendChild(vid);
  if (still) return;
  vid.setAttribute('autoplay', ''); vid.autoplay = true;
  const tryPlay = () => { if (vid.paused) vid.play().catch(() => { /* refused for now: the still stays */ }); };
  tryPlay();
  vid.addEventListener('canplay', tryPlay, { once: true });
  // A refused autoplay is often allowed after the first touch, or when the page comes back to the screen.
  addEventListener('touchstart', tryPlay, { once: true, passive: true });
  addEventListener('pointerdown', tryPlay, { once: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tryPlay(); });
}

/** Where the video sits in its header: the point kept in view (object-position) and the zoom, grown from that same point. */
export function applyFrame(el: HTMLElement, f: { x: number; y: number; z: number }) {
  el.style.objectPosition = `${f.x}% ${f.y}%`;
  el.style.transformOrigin = `${f.x}% ${f.y}%`;
  el.style.transform = f.z > 1 ? `scale(${f.z})` : '';
}
