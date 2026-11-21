// Page videos chosen in /admin > Page videos (src/edge/hero.js). If the page has one, it fades in over the pictures (or the Home
// archway video) once it is actually playing; if not, or anything fails, the page stays exactly as built. Anyone who asked for
// less motion or to save data gets the still picture instead of the moving one.
export async function heroVideo(bg: HTMLElement | null, page: string, opts: { className: string; replace?: HTMLVideoElement | null } ) {
  if (!bg || !page) return;
  let v = '';
  try {
    const r = await fetch('/api/hero', { headers: { accept: 'application/json' } });
    const j = r.ok ? await r.json() : null;
    v = j && j.videos && typeof j.videos[page] === 'string' && /^[a-z0-9]{6,24}$/.test(j.videos[page]) ? j.videos[page] : '';
  } catch { return; }
  if (!v) return;
  const file = (part: string) => `/api/hero?file=${encodeURIComponent(`${page}/${v}/${part}`)}`;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator as any).connection?.saveData;
  const vid = document.createElement('video');
  vid.className = `${opts.className} hv`; vid.muted = true; vid.loop = true; vid.playsInline = true; vid.setAttribute('playsinline', '');
  vid.setAttribute('aria-hidden', 'true'); vid.preload = 'auto'; vid.poster = file('poster.jpg');
  // Astro's page styles reach only elements that carry the page's style marker, so copy it from the header.
  for (const a of [...bg.attributes]) if (a.name.startsWith('data-astro-cid')) vid.setAttribute(a.name, a.value);
  vid.style.opacity = '0'; vid.style.transition = 'opacity 1.2s ease';
  for (const [part, media] of [['small.mp4', '(max-width: 760px)'], ['large.mp4', '']]) {
    const s = document.createElement('source'); s.src = file(part); s.type = 'video/mp4'; if (media) s.media = media; vid.appendChild(s);
  }
  const show = () => { vid.style.opacity = '1'; bg.dataset.video = 'on'; if (opts.replace) setTimeout(() => opts.replace?.pause(), 1300); };
  if (still) {
    // Only the still: show the poster once it has loaded.
    const img = new Image(); img.onload = show; img.src = vid.poster; vid.removeAttribute('autoplay');
  } else {
    vid.autoplay = true;
    vid.addEventListener('playing', show, { once: true });
  }
  bg.appendChild(vid);
  if (!still) vid.play().catch(() => { /* the browser said no: the poster still fades in when it can */ });
}
