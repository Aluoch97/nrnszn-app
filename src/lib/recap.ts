// The recap player on an event's own page: the event's YouTube playlist, watched right on the page.
// A big poster of the first video, the playlist underneath (from /api/playlist), and tapping any video plays it here.
// The YouTube player only loads when someone presses play, so the page stays fast. "Open in YouTube" stays as a small link.
// Used by src/pages/events/[slug].astro (built events) and src/pages/event-live.astro (events added in /admin).

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The playlist and/or video in a YouTube link, or null if it isn't a YouTube link we can play here. */
export function parseYouTube(href: string): { list?: string; video?: string } | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let video = '';
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    video = u.searchParams.get('v') || (/^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? '');
  } else return null;
  const list = u.searchParams.get('list') || '';
  const out: { list?: string; video?: string } = {};
  if (PLAYLIST_ID.test(list)) out.list = list;
  if (VIDEO_ID.test(video)) out.video = video;
  return out.list || out.video ? out : null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const thumb = (id: string) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

/** Fills a <section class="evp-recap"> for this YouTube link. Returns false if the link can't be played on the page. */
export function mountRecap(section: HTMLElement, href: string): boolean {
  const yt = parseYouTube(href);
  if (!yt) return false;
  section.hidden = false;
  const player = section.querySelector<HTMLElement>('.evp-player')!;
  const now = section.querySelector<HTMLElement>('.evp-now')!;
  const list = section.querySelector<HTMLOListElement>('.evp-list')!;
  const open = section.querySelector<HTMLAnchorElement>('.evp-yt a')!;
  open.href = href;

  let videos: { id: string; title: string; duration?: string }[] = [];
  let current = yt.video || '';

  const embed = (id: string) => {
    const f = el('iframe', 'evp-frame');
    const q = 'autoplay=1&playsinline=1&rel=0' + (yt.list ? `&list=${encodeURIComponent(yt.list)}` : '');
    f.src = id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}` : `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(yt.list || '')}&autoplay=1&playsinline=1&rel=0`;
    f.title = 'Recap video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    return f;
  };
  const play = (id: string) => {
    current = id;
    player.replaceChildren(embed(id));
    const v = videos.find((x) => x.id === id);
    now.textContent = v ? v.title : '';
    now.hidden = !v;
    list.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', b.dataset.id === id ? 'true' : 'false'));
  };
  const poster = () => {
    const b = el('button', 'evp-poster');
    b.type = 'button';
    b.setAttribute('aria-label', 'Play the recap');
    if (current) { const im = el('img'); im.src = thumb(current); im.alt = ''; im.width = 480; im.height = 360; im.loading = 'lazy'; b.appendChild(im); }
    b.appendChild(el('span', 'evp-play', '▶'));
    b.addEventListener('click', () => play(current));
    player.replaceChildren(b);
  };
  poster();
  // Arriving from a "Watch the recap" link (/events/<slug>/#recap): the section only shows once this runs, so scroll to it now,
  // and again once the list and the page have finished loading (they can move it), unless the visitor has scrolled since.
  let moved = false;
  const stop = () => { moved = true; };
  ['wheel', 'touchstart', 'keydown'].forEach((t) => addEventListener(t, stop, { once: true, passive: true }));
  const toRecap = () => { if (location.hash === '#recap' && !moved) section.scrollIntoView({ block: 'start' }); };
  requestAnimationFrame(toRecap);
  if (document.readyState !== 'complete') addEventListener('load', () => requestAnimationFrame(toRecap), { once: true });

  if (!yt.list) { list.hidden = true; return true; }
  list.replaceChildren(el('li', 'evp-loading', 'Loading the videos…'));
  fetch(`/api/playlist?list=${encodeURIComponent(yt.list)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => {
      videos = (r && r.ok && Array.isArray(r.videos) ? r.videos : []).filter((v: any) => v && VIDEO_ID.test(v.id) && v.title);
      if (!videos.length) throw new Error('no videos');
      if (!current) { current = videos[0].id; if (!player.querySelector('iframe')) poster(); }
      const h = section.querySelector<HTMLElement>('.evp-count');
      if (h) h.textContent = `${videos.length} video${videos.length === 1 ? '' : 's'}`;
      requestAnimationFrame(toRecap);
      list.replaceChildren(...videos.map((v) => {
        const li = el('li');
        const b = el('button', 'evp-item');
        b.type = 'button';
        b.dataset.id = v.id;
        b.setAttribute('aria-current', v.id === current && player.querySelector('iframe') ? 'true' : 'false');
        const im = el('img'); im.src = thumb(v.id); im.alt = ''; im.width = 120; im.height = 90; im.loading = 'lazy';
        const t = el('span', 'evp-item-text');
        t.appendChild(el('span', 'evp-item-title', v.title));
        if (v.duration) t.appendChild(el('span', 'evp-item-meta', v.duration));
        b.append(im, t);
        b.addEventListener('click', () => { play(v.id); player.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        li.appendChild(b);
        return li;
      }));
    })
    .catch(() => {
      // The list couldn't be read: the player still plays the whole playlist.
      list.hidden = true;
    });
  return true;
}
