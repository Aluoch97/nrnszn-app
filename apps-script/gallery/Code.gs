/**
 * NuGallery — Apps Script backend
 * ---------------------------------------------------------
 * Folder structure expected in Google Drive:
 *
 *   [Gallery Root Folder]
 *     ├── Events/                         <- a CATEGORY
 *     │     ├── The Playlist/                 <- a DOOR (a shoot)
 *     │     │     ├── shot1.jpg
 *     │     │     └── shot2.jpg
 *     │     └── Art After Dark/
 *     │           └── shot1.jpg
 *     ├── Interviews/                     <- a CATEGORY
 *     │     └── She 4 The Streets Interview/  <- a DOOR
 *     │           └── shot1.jpg
 *     └── Renaissance Certified/          <- a CATEGORY (special: gets the
 *           ├── Spring 2024/                  certified logo, sorted newest
 *           │     └── shot1.jpg               to oldest instead of A–Z)
 *           ├── Fall 2024/
 *           ├── Spring 2025/
 *           └── Fall 2025/
 *
 * THREE-LEVEL MODEL:
 *   Root > Category folder > Door folder > photos directly inside.
 *   - A CATEGORY is any folder directly inside the Gallery Root.
 *   - A DOOR is any folder directly inside a category folder; its photos
 *     live directly inside it.
 *
 * ADDING A NEW DOOR (shoot): just create a new folder inside the right
 * category folder (Events, Interviews, etc.) and drop photos in it. It
 * shows up automatically — no code or sheet changes needed.
 *
 * ADDING A NEW CATEGORY: create a new folder directly inside the Gallery
 * Root. It becomes a new "wing" in the lobby automatically.
 *
 * CHOOSING A DOOR'S COVER PHOTO: by default, a door's thumbnail is
 * whichever photo is most recently uploaded in that folder. To pin a
 * specific photo as the cover regardless of date, name that file with a
 * "cover_" or "cover-" prefix, e.g. cover_bestshot.jpg. This only affects
 * the thumbnail — the photo still appears in its normal chronological
 * place inside the room.
 *
 * SETTING THE PHOTOGRAPHER CREDIT AND A RECAP VIDEO: open a DOOR folder in
 * Drive, click the (i) Details/Info panel, and type into the folder's
 * Description field. Format: "Credit | Instagram | Video" — any segment
 * can be left empty:
 *
 *   Shot by Jane Doe
 *   Shot by Jane Doe | @janedoe
 *   Shot by Jane Doe | | https://youtu.be/xxxxxxxxxxx
 *   Shot by Jane Doe | @janedoe | https://youtu.be/xxxxxxxxxxx
 *
 * The middle segment (Instagram) makes the credit a clickable link to that
 * profile. The third segment adds a small play-button badge on that door
 * linking to the recap video — used for a door like "Art After Dark" or
 * "The Playlist". Leave the description blank to fall back to
 * DEFAULT_CREDIT below — except inside the "Renaissance Certified"
 * category, where a blank description stays blank (since those showcases
 * are shot by a mix of photographers, not just one). Whenever the credit
 * is DEFAULT_CREDIT and no link is given, it automatically links to
 * DEFAULT_CREDIT_URL (soulnicolas.com).
 *
 * Row/door order = folder order (alphabetical by default; prefix a folder
 * name with a number like "1 The Playlist" to force a specific order — the
 * leading number is stripped before display). The "Renaissance Certified"
 * category is the one exception: its doors are always sorted newest-to-
 * oldest by parsing "Spring/Fall YYYY" from the door name, regardless of
 * any numeric prefix.
 *
 * Each photo's date is pulled automatically from its Drive "created" date.
 *
 * SPEED: there are two cache layers. CacheService is the fast one but has
 * a hard 100KB-per-key limit — a gallery with 200+ photos will exceed
 * that, so there's also a small JSON file kept in your own Drive (outside
 * the shared gallery folder) as a fallback with no real size limit. The
 * cache is rebuilt — and each door's COVER thumbnail pre-warmed on
 * Google's end (not every photo in every room, which can exceed Apps
 * Script's 6-minute execution limit on a large gallery) — by a TIME
 * TRIGGER (see setup step 5), not by visitors. New photos show up within
 * 6 hours automatically, or immediately if you run refreshGalleryCache
 * once manually, or open the deployed URL with ?refresh=1 on the end.
 *
 * SETUP:
 * 0. REQUIRED — enable the Drive API Advanced Service: in the Apps Script
 *    editor, click the "+" next to "Services" in the left sidebar, find
 *    "Drive API", and click Add (accept the default version, v3). Without
 *    this step, collectImages() below will throw a "Drive is not defined"
 *    error — it's what lets this script batch-read hundreds of photos in
 *    one request instead of hundreds of slow individual ones.
 * 1. Put ROOT_FOLDER_ID below (the Gallery Root Folder's ID from its
 *    Drive URL: drive.google.com/drive/folders/<THIS PART>).
 * 2. Share that folder (and everything inside it) as
 *    "Anyone with the link — Viewer".
 * 3. Deploy > New deployment > Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 * 4. Copy the /exec URL into GALLERY_ENDPOINT in the widget HTML file.
 * 5. In the Apps Script editor, click the clock icon (Triggers) on the
 *    left sidebar > Add Trigger:
 *      Function: refreshGalleryCache
 *      Event source: Time-driven
 *      Type: Hour timer, every 6 hours
 *    This keeps the cache warm automatically so visitors are never the
 *    ones paying the slow cold-load cost. Do this once — it keeps running
 *    on its own after that.
 */

var ROOT_FOLDER_ID = '1e3JOe1YPrZQz5wxUqDOpsEbStteNBiQs'; // NuGallery root folder
var DEFAULT_CREDIT = 'Shot by Nicólas Soul';
var DEFAULT_CREDIT_URL = 'https://www.soulnicolas.com/'; // link used whenever the credit is "Shot by Nicólas Soul"
var TIMEZONE = 'America/Chicago';
var CACHE_KEY = 'nugallery_data_v1';
var CACHE_TTL_SECONDS = 21600; // 6 hours (the max CacheService allows) — how long a cached response is served
var CACHE_FILE_NAME = 'nugallery_cache.json'; // backup cache for galleries too big for CacheService's 100KB limit

// Reading every folder and file from Drive on every single visit is slow —
// and CacheService (the fast in-memory cache) has a hard 100KB-per-key
// limit. A gallery with 200+ photos will likely blow past that, and when
// that happens CacheService.put() silently fails — meaning EVERY visitor
// was hitting a full live Drive re-scan on every single load, not just an
// occasional cold one. That's almost certainly what "doors take a while
// to appear" was, every time, once the gallery grew past ~100KB of JSON.
//
// Fix: below CacheService there's now a second cache layer — a small JSON
// file kept in your own Drive (not the shared gallery folder), which has
// no practical size limit. doGet() tries the fast CacheService cache
// first, then this file, and only does a live Drive rescan if neither
// exists yet (i.e. before refreshGalleryCache has ever run).
//
// doGet() itself NEVER warms thumbnails — that only happens in
// refreshGalleryCache(), which you run manually once and then on a TIME
// TRIGGER (see setup step 5), so a visitor is never the one waiting on it.
function doGet(e) {
  var forceRefresh = e && e.parameter && e.parameter.refresh;

  if (!forceRefresh) {
    var cached = CacheService.getScriptCache().get(CACHE_KEY);
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }
    var fileCached = readDriveCache();
    if (fileCached) {
      return ContentService.createTextOutput(fileCached).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // No cache in either layer yet, or an explicit ?refresh=1 — build and
  // cache now, no thumbnail warming here. Same speed as a plain Drive read.
  var json = buildAndCache();
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// Reads Drive, caches the JSON in BOTH layers, and returns it — no
// thumbnail warming. This is what doGet() falls back to when neither
// cache layer has anything yet, so a visitor's worst case is never
// slower than a plain Drive read.
function buildAndCache() {
  var data;
  try {
    data = buildGalleryData();
  } catch (err) {
    data = { error: String(err), categories: [] };
  }

  var json = JSON.stringify(data);

  try {
    CacheService.getScriptCache().put(CACHE_KEY, json, CACHE_TTL_SECONDS);
  } catch (cacheErr) {
    // Too big for CacheService's 100KB-per-key limit — fine, the Drive
    // file cache below has no meaningful size limit and covers this case.
  }

  writeDriveCache(json);

  return json;
}

// The Drive-file cache: lives in your own "My Drive" root (NOT inside the
// shared gallery folder, so it never shows up to anyone browsing that
// shared folder). Has no practical size ceiling, unlike CacheService.
function getCacheFile(createIfMissing) {
  var folder = DriveApp.getRootFolder();
  var files = folder.getFilesByName(CACHE_FILE_NAME);
  if (files.hasNext()) return files.next();
  if (createIfMissing) {
    return folder.createFile(CACHE_FILE_NAME, '', MimeType.PLAIN_TEXT);
  }
  return null;
}

function writeDriveCache(json) {
  try {
    var file = getCacheFile(true);
    file.setContent(json);
  } catch (e) {
    // Best-effort — if this fails, doGet() just does a live rebuild on
    // its next request instead of reading a cache.
  }
}

function readDriveCache() {
  try {
    var file = getCacheFile(false);
    if (!file) return null;
    var content = file.getBlob().getDataAsString();
    return content || null;
  } catch (e) {
    return null;
  }
}

// Run this manually once (function dropdown in the editor > Run), and set
// it up on a time-driven trigger (setup step 5) — never called from
// doGet(). Builds the same as buildAndCache(), then warms the door COVER
// thumbnails (what actually shows on the lobby/category screens) on
// Google's end. Deliberately NOT every photo in every room — with 200+
// photos that blew past Apps Script's 6-minute execution limit and made
// this function fail outright (silently, since it's on a timer). Warming
// only the covers keeps this fast and reliable regardless of how many
// total photos the gallery grows to; a specific room's other photos still
// warm normally the first time any visitor actually opens that room.
function refreshGalleryCache() {
  var json = buildAndCache();

  try {
    var data = JSON.parse(json);
    var coverUrls = [];
    (data.categories || []).forEach(function (category) {
      (category.doors || []).forEach(function (door) {
        if (door.cover) coverUrls.push(door.cover);
      });
    });
    warmThumbnails(coverUrls);
  } catch (warmErr) {
    // Warming is best-effort — a failure here should never break the gallery.
  }

  return json;
}

// Requests each thumbnail URL once so Google generates and caches it on
// their end ahead of time, instead of the first real visitor paying that
// cost. Runs in batches since UrlFetchApp.fetchAll has a request limit.
function warmThumbnails(urls) {
  if (!urls || !urls.length) return;
  var chunkSize = 50;
  for (var i = 0; i < urls.length; i += chunkSize) {
    var chunk = urls.slice(i, i + chunkSize).map(function (u) {
      return { url: u, muteHttpExceptions: true };
    });
    try {
      UrlFetchApp.fetchAll(chunk);
    } catch (e) {
      // Best-effort — move on if a batch fails.
    }
  }
}

function buildGalleryData() {
  var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var categoryFolders = sortByName(listFolders(root));
  var categories = [];

  categoryFolders.forEach(function (categoryFolder) {
    var isCertified = /certified/i.test(categoryFolder.getName());
    var doorFolders = listFolders(categoryFolder);

    var doors = doorFolders
      .map(function (doorFolder) {
        var parsed = parseCredit(doorFolder.getDescription(), isCertified);
        var images = collectImages(doorFolder, parsed.credit, parsed.igUrl);
        return {
          title: cleanFolderName(doorFolder.getName()),
          images: images,
          cover: pickCoverUrl(images),
          videoUrl: parsed.videoUrl,
          sortKey: seasonYearSortKey(doorFolder.getName()),
          rawName: doorFolder.getName()
        };
      })
      .filter(function (door) { return door.images.length > 0; });

    if (isCertified) {
      doors.sort(function (a, b) { return b.sortKey - a.sortKey; }); // newest first
    } else {
      doors.sort(function (a, b) { return a.rawName.localeCompare(b.rawName); });
    }
    doors.forEach(function (d) { delete d.sortKey; delete d.rawName; });

    if (doors.length > 0) {
      categories.push({
        title: cleanFolderName(categoryFolder.getName()),
        certified: isCertified,
        doors: doors
      });
    }
  });

  return { categories: categories };
}

function listFolders(parent) {
  var list = [];
  var it = parent.getFolders();
  while (it.hasNext()) list.push(it.next());
  return list;
}

function sortByName(folders) {
  return folders.slice().sort(function (a, b) { return a.getName().localeCompare(b.getName()); });
}

// Uses the Drive API (Advanced Service) instead of DriveApp here, because
// DriveApp's file iterator makes a separate network round-trip for nearly
// every property of every file — with 200+ photos that added up to enough
// individual calls to exceed Apps Script's 6-minute execution limit.
// Drive.Files.list() fetches every image in a folder, with only the fields
// actually needed, in one batched request instead of hundreds of small
// ones. Requires the "Drive API" Advanced Service to be enabled — see
// setup step 0 at the top of this file.
function collectImages(folder, credit, igUrl) {
  var images = [];
  var folderId = folder.getId();
  var pageToken = null;

  do {
    var response = Drive.Files.list({
      q: "'" + folderId + "' in parents and mimeType contains 'image/' and trashed = false",
      fields: 'nextPageToken, files(id, name, createdTime)',
      pageSize: 1000,
      pageToken: pageToken || undefined
    });

    (response.files || []).forEach(function (file) {
      var created = new Date(file.createdTime);
      var id = file.id;
      images.push({
        id: id,
        name: file.name,
        dateSort: created.getTime(),
        date: Utilities.formatDate(created, TIMEZONE, 'MM/dd/yyyy'),
        credit: credit || '',
        igUrl: igUrl || '',
        thumbUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w500',
        fullUrl: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600',
        downloadUrl: 'https://drive.google.com/uc?export=download&id=' + id
      });
    });

    pageToken = response.nextPageToken;
  } while (pageToken);

  images.sort(function (a, b) { return b.dateSort - a.dateSort; });
  return images;
}

// Picks which photo represents a door on its lobby/category tile. A file
// named with a "cover_" or "cover-" prefix (e.g. cover_bestshot.jpg) is
// always used, regardless of date, so you can control the door's face
// without affecting photo order inside the room. Falls back to the most
// recent photo when no file is explicitly marked as the cover.
function pickCoverUrl(images) {
  for (var i = 0; i < images.length; i++) {
    if (/^cover[_-]/i.test(images[i].name)) return images[i].thumbUrl;
  }
  return images.length > 0 ? images[0].thumbUrl : null;
}

// Parses a door folder's Description field into { credit, igUrl, videoUrl }.
// Format: "Credit | Instagram | Video". Any segment can be left empty.
//   Shot by Jane Doe
//   Shot by Jane Doe | @janedoe
//   Shot by Jane Doe | | https://youtu.be/xxxxxxxxxxx        (credit + recap video, no IG)
//   Shot by Jane Doe | @janedoe | https://youtu.be/xxxxxxxxxxx
// Whenever the credit ends up being DEFAULT_CREDIT and no link was given
// explicitly, it links to DEFAULT_CREDIT_URL automatically.
function parseCredit(rawDescription, isCertifiedGroup) {
  var raw = (rawDescription || '').trim();
  if (!raw) {
    return isCertifiedGroup
      ? { credit: '', igUrl: '', videoUrl: '' }
      : { credit: DEFAULT_CREDIT, igUrl: DEFAULT_CREDIT_URL, videoUrl: '' };
  }
  var parts = raw.split('|');
  var credit = (parts[0] || '').trim();
  var igUrl = parts[1] ? toInstagramUrl(parts[1].trim()) : '';
  var videoUrl = parts[2] ? parts[2].trim() : '';
  if (!credit && !isCertifiedGroup) credit = DEFAULT_CREDIT;
  if (!igUrl && credit === DEFAULT_CREDIT) igUrl = DEFAULT_CREDIT_URL;
  return { credit: credit, igUrl: igUrl, videoUrl: videoUrl };
}

function toInstagramUrl(raw) {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  var handle = raw.replace(/^@/, '');
  return 'https://instagram.com/' + handle;
}

// Strips an optional leading ordering number like "1 " or "01 - " from
// a folder name, so you can control order without it showing in the UI.
function cleanFolderName(name) {
  return name.replace(/^\d+\s*[-.]?\s*/, '');
}

// Turns "Spring 2024" / "Fall 2025" into a sortable number, newest = highest.
// Season rank within a year: Winter < Spring < Summer < Fall.
function seasonYearSortKey(name) {
  var m = /(Winter|Spring|Summer|Fall)\s*(\d{4})/i.exec(name);
  if (!m) return 0;
  var rank = { winter: 0, spring: 1, summer: 2, fall: 3 }[m[1].toLowerCase()];
  var year = parseInt(m[2], 10);
  return year * 10 + rank;
}
