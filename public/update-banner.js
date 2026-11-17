/* "A new version is ready. Tap to update."
   The page remembers the version it was opened with (from /version.json, which is never kept in a cache). It looks again when the app comes back to the
   screen, when the phone goes back online, and every 5 minutes. If the version has changed, a small bar appears at the bottom; tapping it clears every
   saved copy on this device and reloads the page on the new version. Never shown inside a frame or on /admin. Plain text only, nothing from the network is shown. */
(function () {
  if (window.top !== window) return;
  if (/^\/admin(\/|$)/.test(location.pathname)) return;
  var loaded = null, shown = false;

  function readVersion() {
    return fetch('/version.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { return j && j.version ? String(j.version) : null; }).catch(function () { return null; });
  }
  function update(btn) {
    btn.disabled = true; btn.textContent = 'Updating…';
    var steps = [];
    try { if ('serviceWorker' in navigator) steps.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.update(); })); })); } catch (e) {}
    try { if ('caches' in window) steps.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    Promise.all(steps).catch(function () {}).then(function () {
      try { var u = new URL(location.href); u.searchParams.set('r', String(Date.now())); location.replace(u.toString()); } catch (e) { location.reload(); }
    });
  }
  function show() {
    if (shown) return; shown = true;
    var bar = document.createElement('div');
    bar.setAttribute('role', 'status'); bar.setAttribute('data-update-banner', '');
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:520px;margin:0 auto;display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;border-radius:14px;background:#1b1b22;color:#fff;font:600 15px/1.3 system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18)';
    var text = document.createElement('span'); text.style.cssText = 'flex:1;min-width:0'; text.textContent = 'A new version is ready.';
    var go = document.createElement('button'); go.type = 'button'; go.textContent = 'Tap to update';
    go.style.cssText = 'min-height:44px;padding:0 16px;border:0;border-radius:10px;background:#c8175f;color:#fff;font:700 15px system-ui,-apple-system,sans-serif;cursor:pointer';
    go.addEventListener('click', function () { update(go); });
    var later = document.createElement('button'); later.type = 'button'; later.setAttribute('aria-label', 'Not now'); later.textContent = '×';
    later.style.cssText = 'min-width:44px;min-height:44px;border:0;background:transparent;color:#fff;font:400 24px/1 system-ui,sans-serif;cursor:pointer';
    later.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(text); bar.appendChild(go); bar.appendChild(later);
    document.body.appendChild(bar);
  }
  function check() {
    readVersion().then(function (v) {
      if (!v) return;
      if (loaded === null) { loaded = v; return; }
      if (v !== loaded) show();
    });
  }
  check();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('online', check);
  setInterval(check, 5 * 60 * 1000);
})();
