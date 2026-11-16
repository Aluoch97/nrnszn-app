// Minimal offline support: pages are network-first (always fresh when online),
// static assets are cache-first. The version below is stamped automatically on every build (scripts/stamp-version.mjs), so a changed site
// always gets a new cache and old saved files are dropped; nobody has to bump it by hand.
const VERSION = 'nrn-v7';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['/portal'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !k.startsWith('nrn-feeds')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Videos stream in pieces (range requests); let the browser handle them directly.
  if (url.pathname.startsWith('/media/') || req.headers.has('range')) return;
  // Live feeds and photos from /api are cached at Cloudflare; never keep a copy in the phone.
  if (url.pathname.startsWith('/api/')) return;
  // The version file tells the footer and the status page what is live right now: always fresh.
  if (url.pathname === '/version.json') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/portal')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
