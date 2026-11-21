/* Phone notifications for visitors (Nov 17, 2026, Nick). A "Notifications" button on /account, for signed-in people only (Nov 21, 2026; it used to be in the footer), hidden until /api/push says it is switched on: both VAPID keys set in
   Cloudflare) opens a small dialog with one button, "Turn on notifications". It asks the phone, subscribes to web push with the public key from /api/push and saves the
   subscription through POST /api/push. /sw.js shows each notification. Plain static text only. Never inside a frame. */
(function () {
  if (window.top !== window) return;
  var can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var info = null;

  function keyBytes(text) { var t = text.replace(/-/g, '+').replace(/_/g, '/'), s = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(s, function (c) { return c.charCodeAt(0); }); }
  function getInfo() { return fetch('/api/push', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function mine() {
    if (!can) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration('/sw.js').then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }).catch(function () { return null; });
  }
  function reveal() {
    getInfo().then(function (i) {
      if (!i || !i.on) return;
      info = i;
      document.querySelectorAll('[data-push-open]').forEach(function (b) { b.hidden = false; });
    });
  }

  var dlg = null;
  function build() {
    dlg = document.createElement('dialog');
    dlg.setAttribute('aria-labelledby', 'push-title');
    dlg.style.cssText = 'width:min(92vw,420px);box-sizing:border-box;padding:20px;border:1px solid rgba(255,255,255,.2);border-radius:16px;background:#1b1b22;color:#fff;font:16px/1.45 system-ui,-apple-system,sans-serif';
    dlg.innerHTML = '<h2 id="push-title" style="margin:0 0 8px;font-size:20px">Notifications</h2><p id="push-msg" role="status" aria-live="polite" style="margin:0 0 14px"></p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="push-go" style="min-height:44px;padding:0 18px;border:0;border-radius:10px;background:#c8175f;color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer" hidden></button>' +
      '<button type="button" id="push-close" style="min-height:44px;padding:0 18px;border:1px solid rgba(255,255,255,.35);border-radius:10px;background:transparent;color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer">Close</button></div>' +
      '<p style="margin:14px 0 0;font-size:14px;opacity:.8">Only news and announcements, a few a month at most. Turn them off here or in your phone’s settings any time.</p>';
    document.body.appendChild(dlg);
    dlg.querySelector('#push-close').addEventListener('click', function () { dlg.close(); });
    dlg.querySelector('#push-go').addEventListener('click', toggle);
  }
  function show(text, label, state) {
    dlg.querySelector('#push-msg').textContent = text;
    var b = dlg.querySelector('#push-go'); b.hidden = !label; b.textContent = label || ''; b.dataset.state = state || ''; b.disabled = false;
  }
  function refresh() {
    if (!can) return show(ios && !standalone ? 'On iPhone, first add this site to your Home Screen (Share, then Add to Home Screen), then open it from the Home Screen to turn notifications on.' : 'This browser cannot show notifications.', '', 'none');
    if (Notification.permission === 'denied') return show('Notifications are blocked for this site. Allow them in your phone or browser settings, then come back.', '', 'blocked');
    mine().then(function (sub) {
      var on = !!sub && Notification.permission === 'granted';
      show(on ? "You're on. You'll hear about news and announcements." : 'Get a notification on your phone for news and announcements from NuRenaissance.', on ? 'Turn off notifications' : 'Turn on notifications', on ? 'on' : 'off');
    });
  }
  function post(body) { return fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }); }); }
  function toggle() {
    var b = dlg.querySelector('#push-go'); if (b.disabled) return;
    var off = b.dataset.state === 'on'; b.disabled = true;
    var done = function (m) { if (m) dlg.querySelector('#push-msg').textContent = m; setTimeout(refresh, m ? 1500 : 0); };
    if (off) {
      mine().then(function (sub) { if (!sub) return; var ep = sub.endpoint; return sub.unsubscribe().then(function () { return post({ action: 'unsubscribe', endpoint: ep }); }); })
        .then(function () { done('Notifications are off.'); }, function () { done('Could not change notifications on this phone.'); });
      return;
    }
    var asked = Notification.requestPermission();   // first, so the phone sees it as the result of the tap
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      return Promise.resolve(asked).then(function (perm) {
        if (perm !== 'granted') { done('Notifications were not allowed.'); return; }
        return navigator.serviceWorker.ready.then(function () { return reg.pushManager.getSubscription(); }).then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.key) });
        }).then(function (sub) {
          var j = sub.toJSON();
          return post({ action: 'subscribe', subscription: { endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth } }).then(function (r) {
            if (r && r.ok) return done('Notifications are on.');
            return sub.unsubscribe().catch(function () {}).then(function () { done((r && r.message) || 'Could not turn on notifications.'); });
          });
        });
      });
    }).catch(function () { done('Could not turn on notifications on this phone.'); });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-push-open]'); if (!a || !info) return;
    e.preventDefault(); if (!dlg) build(); dlg.showModal(); refresh();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal); else reveal();
})();
