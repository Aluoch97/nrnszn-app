/* Counts this page view, without cookies (see src/edge/analytics.js and the privacy policy). Sends only the page address, the website you came from
   and your screen width. Nothing is sent for visitors who send Do Not Track or Global Privacy Control, for the /admin pages, or for the owner
   while signed in to /admin on this device. */
(function () {
  try {
    var path = location.pathname;
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1' || navigator.globalPrivacyControl) return;
    if (/^\/admin(\/|$)/.test(path)) return;
    if (document.visibilityState === 'prerender') return;
    try { if (localStorage.getItem('nrn_admin')) return; } catch (e) { /* storage blocked: count the visit */ }
    var send = function () {
      var body = JSON.stringify({ p: path, r: document.referrer || '', w: Math.round(window.innerWidth || 0) });
      try { if (navigator.sendBeacon && navigator.sendBeacon('/api/hit', new Blob([body], { type: 'text/plain' }))) return; } catch (e) { /* fall through */ }
      fetch('/api/hit', { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(function () { /* nothing to do */ });
    };
    if (document.readyState === 'complete') send(); else window.addEventListener('load', send);
  } catch (e) { /* never break the page */ }
})();
