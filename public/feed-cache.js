/* nrnFeed(path, direct, options): loads one of the site's read-only feeds (/api/feed/gallery, /cinema, /services) and returns a promise of its JSON.
   - If this device already holds a copy that is less than `maxAge` old (default 1 hour), that copy is returned AT ONCE and a fresh one is fetched
     in the background and saved for next time. So a repeat visit opens instantly, and keeps working with a bad connection or offline.
   - If there is no usable copy, it waits for the live feed (the old direct address is the fallback, exactly as before). If that fails and an older
     copy exists, the older copy is used rather than nothing.
   - `options.valid(data)` says whether an answer is a real one: anything else (an error page from Google, an empty list) is never saved.
   Copies live in the browser's Cache Storage under "nrn-feeds-v1". The Refresh button in the footer clears them. */
(function () {
  var STORE = 'nrn-feeds-v1', HOUR = 60 * 60 * 1000;

  function store() { return window.caches ? caches.open(STORE) : Promise.reject(new Error('no cache storage')); }

  function kept(path) {
    return store().then(function (c) { return c.match(path); }).then(function (r) {
      if (!r) return null;
      var at = Number(r.headers.get('x-kept-at') || 0);
      return r.json().then(function (data) { return { data: data, age: Date.now() - at }; });
    }).catch(function () { return null; });
  }

  function live(path, direct) {
    return fetch(path)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r; })
      .catch(function () { return direct ? fetch(direct) : Promise.reject(new Error('feed failed')); })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function save(path, data) {
    try {
      store().then(function (c) {
        return c.put(path, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'x-kept-at': String(Date.now()) } }));
      }).catch(function () { /* storage full or blocked: not a problem */ });
    } catch (e) { /* ignore */ }
  }

  window.nrnFeed = function (path, direct, options) {
    options = options || {};
    var maxAge = options.maxAge == null ? HOUR : options.maxAge;
    var valid = options.valid || function (d) { return !!d && !d.error; };
    var fresh = live(path, direct).then(function (data) { if (valid(data)) save(path, data); return data; });
    fresh.catch(function () { /* handled below; this stops the browser calling a quick failure "unhandled" while the kept copy is still being looked up */ });
    return kept(path).then(function (k) {
      if (k && valid(k.data) && k.age >= 0 && k.age < maxAge) { fresh.catch(function () { /* the kept copy is on screen; nothing to do */ }); return k.data; }
      return fresh.catch(function (err) { if (k && valid(k.data)) return k.data; throw err; });
    });
  };
})();
