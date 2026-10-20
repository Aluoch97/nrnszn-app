/**
 * NuRenaissance App API — one Apps Script backend for app.nrnszn.com.
 *
 * Setup (once):
 *  1. Create a Google Sheet named "NuRenaissance Site", then Extensions → Apps Script.
 *  2. Paste this file in as Code.gs.
 *  3. Services (+) → add "YouTube Data API v3".
 *  4. Project Settings → Script properties → add DEPLOY_HOOK_URL
 *     (Cloudflare Pages → your project → Settings → Builds → Deploy hooks).
 *  5. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
 *     Copy the /exec URL into Cloudflare as PUBLIC_API_URL.
 *  6. Run setupDailyRebuild() once so "latest video" refreshes every morning.
 *
 * Each widget that moves into the app adds one case to the router below.
 */

const PLAYLISTS = {
  interview: 'PLVprhlbgSo1vN-wkuvFDjabBQ85XURyTd',
  music: 'PLVprhlbgSo1sfS02MFZbi3t7pCJkoy9rd',
};

const CACHE_SECONDS = 30 * 60;

// ---------- Router ----------

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  try {
    switch (action) {
      case 'latestVideos':
        return json_(Object.assign({ ok: true }, latestVideos_()));
      case 'ping':
        return json_({ ok: true, time: new Date().toISOString() });
      default:
        return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error' });
  }
}

// Posts arrive as text/plain JSON (see src/lib/api.js). Nothing posts yet;
// the Payment and Services routes will add cases here.
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (_) {}
  switch (body.action) {
    default:
      return json_({ ok: false, error: 'Unknown action' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Latest videos ----------

function latestVideos_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('latestVideos');
  if (hit) return JSON.parse(hit);

  const out = {
    interview: newestInPlaylist_(PLAYLISTS.interview),
    music: newestInPlaylist_(PLAYLISTS.music),
  };
  cache.put('latestVideos', JSON.stringify(out), CACHE_SECONDS);
  return out;
}

// Newest by YouTube publish date, regardless of where it sits in the playlist.
function newestInPlaylist_(playlistId) {
  let items = [];
  let pageToken;
  do {
    const res = YouTube.PlaylistItems.list('snippet,contentDetails,status', {
      playlistId: playlistId,
      maxResults: 50,
      pageToken: pageToken,
    });
    items = items.concat(res.items || []);
    pageToken = res.nextPageToken;
  } while (pageToken && items.length < 500);

  const playable = items.filter(function (it) {
    return it.contentDetails && it.contentDetails.videoPublishedAt &&
      it.status && it.status.privacyStatus === 'public';
  });
  if (!playable.length) return null;

  playable.sort(function (a, b) {
    return b.contentDetails.videoPublishedAt.localeCompare(a.contentDetails.videoPublishedAt);
  });
  const top = playable[0];
  return {
    id: top.contentDetails.videoId,
    title: top.snippet.title,
    publishedAt: top.contentDetails.videoPublishedAt,
  };
}

// ---------- Publishing ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NuRenaissance site')
    .addItem('Publish site', 'publishSite')
    .addItem('Refresh latest videos', 'clearVideoCache')
    .addToUi();
}

/** Rebuilds app.nrnszn.com on Cloudflare (about a minute). */
function publishSite() {
  const hook = PropertiesService.getScriptProperties().getProperty('DEPLOY_HOOK_URL');
  if (!hook) throw new Error('Add DEPLOY_HOOK_URL in Project Settings → Script properties first.');
  clearVideoCache();
  const res = UrlFetchApp.fetch(hook, { method: 'post', muteHttpExceptions: true });
  const ok = res.getResponseCode() < 300;
  try {
    SpreadsheetApp.getActive().toast(ok ? 'Publishing — live in about a minute.' : 'Publish failed: ' + res.getResponseCode());
  } catch (_) { /* running from a trigger, no UI */ }
  if (!ok) throw new Error('Deploy hook returned ' + res.getResponseCode());
}

function clearVideoCache() {
  CacheService.getScriptCache().remove('latestVideos');
}

/** Run once. Rebuilds every morning so the pre-rendered page picks up new uploads. */
function setupDailyRebuild() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'publishSite'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('publishSite').timeBased().everyDays(1).atHour(6).create();
}
