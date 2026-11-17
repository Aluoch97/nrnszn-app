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

// Phone notifications (public/push.js, src/edge/push.js). The message arrives encrypted; the browser decrypts it and gives us JSON { title, body, url, tag }.
// Plain text only, and a tap goes to a page on this site.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'NuRenaissance').slice(0, 100), {
    body: String(d.body || '').slice(0, 200), icon: '/icons/icon-192.png', badge: '/icons/favicon-48.png',
    tag: String(d.tag || 'nrnszn').slice(0, 60), data: { url: String(d.url || '/') },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let target = '/';
  try { const u = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin); if (u.origin === self.location.origin) target = u.pathname + u.search + u.hash; } catch (err) { /* home */ }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { if (c.navigate) c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});

