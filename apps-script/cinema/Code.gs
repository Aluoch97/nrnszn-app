/**
 * NuRenaissance Cinema — backend
 * ================================
 * One Google Sheet + this script = a self-updating catalog for the
 * Cinema widget. Same pattern as NuDirectory / the services widget.
 *
 * SCHEMA — row 1 headers, exactly, A through M:
 *   VideoID | Title | Type | SourceURL | Row | SubCategory | Synopsis | IMDb | Thumbnail | IsFeature | Status | Badge | ShowTitle
 *
 * Type is one of:
 *   "video"    — a standalone film/feature (Films rows)
 *   "playlist" — a SHOW definition (its own poster/synopsis/imdb; Row=Shows)
 *   "episode"  — one episode of a show. ShowTitle must exactly match the
 *                Title of that show's "playlist" row. These are what build
 *                the episode list when someone opens a show.
 *
 * SETUP
 * 1. Create a new Google Sheet. Name the first tab exactly: Cinema_Catalog
 * 2. Add the headers above to row 1.
 * 3. Extensions → Apps Script, delete the placeholder code, paste this whole file in.
 * 4. Set CHANNEL_ID below.
 * 5. Run `setup` once from the editor (▶) — authorizes + backfills any
 *    missing columns on an existing sheet.
 * 6. Deploy → New deployment → Web app → Execute as: Me → Access: Anyone → Deploy.
 *    Copy the /exec URL into CATALOG_ENDPOINT in the widget HTML.
 * 7. Reload the sheet — a "🎬 Cinema Admin" menu appears. Use it to:
 *    - Set Up Daily Check Trigger (auto-detects new channel uploads)
 *    - Import Certified Tour Episodes (one-click, hardcoded playlist)
 *    - Import Episodes for a Show... (prompts for a show's exact Title +
 *      its YouTube playlist ID — run this once per show to build its season)
 *
 * FINDING YOUR CHANNEL ID
 * Go to youtube.com/account_advanced while logged into the channel, or
 * view page source on any of your videos and search "channelId".
 */

const CHANNEL_ID = "UCy-wvitXVh2is_RHwQBBRjQ"; // @nrnszn
const CERTIFIED_TOUR_PLAYLIST_ID = "PLVprhlbgSo1vgKbKRq7c3tsY-Y1tl4D3X";
const SHEET_NAME = "Cinema_Catalog";
const HEADERS = ["VideoID","Title","Type","SourceURL","Row","SubCategory","Synopsis","IMDb","Thumbnail","IsFeature","Status","Badge","ShowTitle"];

// ---------------------------------------------------------------------
// Setup / menu
// ---------------------------------------------------------------------

function setup(){
  const sheet = getSheet_();
  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  // Backfill any columns an older version of this sheet doesn't have yet.
  const existingHeaders = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  HEADERS.forEach(h => {
    if(existingHeaders.indexOf(h) === -1){
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h);
    }
  });
}

function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu("🎬 Cinema Admin")
    .addItem("Check for New Uploads Now", "checkForNewUploads")
    .addItem("Import Certified Tour Episodes", "importCertifiedTourEpisodes")
    .addItem("Move Certified Tour to Shows (one-time)", "migrateCertifiedTourToShows")
    .addItem("Import Episodes for a Show...", "importShowEpisodesPrompt")
    .addItem("Set Up Daily Check Trigger", "setupDailyTrigger")
    .addToUi();
}

function setupDailyTrigger(){
  ScriptApp.getProjectTriggers().forEach(t=>{
    if(t.getHandlerFunction() === "checkForNewUploads") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("checkForNewUploads").timeBased().everyDays(1).atHour(6).create();
  SpreadsheetApp.getUi().alert("Daily check scheduled for ~6am.");
}

function getSheet_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function idxMap_(){
  const idx = {};
  HEADERS.forEach((h,i)=> idx[h] = i);
  return idx;
}

// Clears the shared doGet() cache so a change made here (new episodes,
// migrated rows) shows up on the next page load instead of sitting stale
// for up to CATALOG_CACHE_TTL_SECONDS.
function invalidateCatalogCache_(){
  try { CacheService.getScriptCache().remove(CATALOG_CACHE_KEY); }
  catch(err){ /* non-fatal — worst case the cache just expires on its own TTL */ }
}

// Builds a full-width row array from a partial {header: value} object,
// so every appendRow call stays correct even as HEADERS grows over time.
function buildRow_(fields){
  const idx = idxMap_();
  const row = new Array(HEADERS.length).fill("");
  Object.keys(fields).forEach(k => { if(k in idx) row[idx[k]] = fields[k]; });
  return row;
}

function fetchPlaylistEntries_(playlistId){
  const feedUrl = "https://www.youtube.com/feeds/videos.xml?playlist_id=" + playlistId;
  const xml = UrlFetchApp.fetch(feedUrl).getContentText();
  const doc = XmlService.parse(xml);
  const root = doc.getRootElement();
  const ns = XmlService.getNamespace("http://www.w3.org/2005/Atom");
  const ytNs = XmlService.getNamespace("yt", "http://www.youtube.com/xml/schemas/2015");
  return root.getChildren("entry", ns).map(entry => ({
    videoId: entry.getChild("videoId", ytNs).getText(),
    title: entry.getChild("title", ns).getText()
  }));
}

// ---------------------------------------------------------------------
// RSS ingestion — new channel uploads only. Status "New" so they land
// in the sheet for you to sort; nothing here is Approved automatically.
// ---------------------------------------------------------------------

function checkForNewUploads(){
  if(CHANNEL_ID.indexOf("PASTE_") === 0){
    throw new Error("Set CHANNEL_ID at the top of the script first.");
  }

  const feedUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=" + CHANNEL_ID;
  const xml = UrlFetchApp.fetch(feedUrl).getContentText();
  const doc = XmlService.parse(xml);
  const root = doc.getRootElement();
  const ns = XmlService.getNamespace("http://www.w3.org/2005/Atom");
  const ytNs = XmlService.getNamespace("yt", "http://www.youtube.com/xml/schemas/2015");

  const entries = root.getChildren("entry", ns);
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const existingIds = new Set(data.slice(1).map(r => r[0]));

  let added = 0;
  entries.forEach(entry => {
    const videoId = entry.getChild("videoId", ytNs).getText();
    if(existingIds.has(videoId)) return;

    const title = entry.getChild("title", ns).getText();
    const url = "https://youtu.be/" + videoId;
    const thumb = "https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg";

    sheet.appendRow(buildRow_({
      VideoID: videoId, Title: title, Type: "video", SourceURL: url,
      Thumbnail: thumb, Status: "New"
    }));
    added++;
  });

  if(added > 0) Logger.log(added + " new video(s) added — needs sorting in the sheet.");
  return added;
}

// ---------------------------------------------------------------------
// One-off importer: every Certified Tour episode filed under Shows,
// as its own episode of the "Certified Tour" show. Safe to re-run —
// skips VideoIDs already in the sheet.
// ---------------------------------------------------------------------

function importCertifiedTourEpisodes(){
  const entries = fetchPlaylistEntries_(CERTIFIED_TOUR_PLAYLIST_ID);
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const existingIds = new Set(data.slice(1).map(r => r[0]));

  let added = 0;
  entries.forEach(({videoId, title}) => {
    if(existingIds.has(videoId)) return;
    const url = "https://youtu.be/" + videoId;
    const thumb = "https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg";

    sheet.appendRow(buildRow_({
      VideoID: videoId, Title: title, Type: "episode", SourceURL: url,
      Row: "Shows", Thumbnail: thumb, Status: "Approved", ShowTitle: "Certified Tour"
    }));
    added++;
  });

  const msg = added + " Certified Tour episode(s) added under Shows.";
  Logger.log(msg);
  invalidateCatalogCache_();
  try { SpreadsheetApp.getUi().alert(msg); } catch(e){ /* no UI when run from editor */ }
  return added;
}

// ---------------------------------------------------------------------
// One-time cleanup: converts any OLD Certified Tour rows that were
// filed under Films/Documentaries (Badge "VLOGUMENTARIES") into proper
// Shows episodes, and makes sure a "Certified Tour" show-definition
// row exists so it has a poster/synopsis in the Shows browse grid.
// Safe to re-run — does nothing once everything's already migrated.
// ---------------------------------------------------------------------

function migrateCertifiedTourToShows(){
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const idx = idxMap_();

  let migrated = 0;
  for(let i = 1; i < data.length; i++){
    const row = data[i];
    const badge = (row[idx.Badge] || "").toString();
    const rowName = (row[idx.Row] || "").toString();
    if(rowName === "Films" && badge === "VLOGUMENTARIES"){
      sheet.getRange(i + 1, idx.Type + 1).setValue("episode");
      sheet.getRange(i + 1, idx.Row + 1).setValue("Shows");
      sheet.getRange(i + 1, idx.SubCategory + 1).setValue("");
      sheet.getRange(i + 1, idx.Badge + 1).setValue("");
      sheet.getRange(i + 1, idx.ShowTitle + 1).setValue("Certified Tour");
      migrated++;
    }
  }

  const hasDef = data.slice(1).some(r =>
    (r[idx.Type] || "").toString().toLowerCase() === "playlist" && r[idx.Title] === "Certified Tour"
  );
  let addedDef = false;
  if(!hasDef){
    sheet.appendRow(buildRow_({
      Title: "Certified Tour", Type: "playlist", Row: "Shows", Status: "Approved",
      SubCategory: "Vlogumentaries",
      Synopsis: "Follow the NuRenaissance crew on the road as they bring their sound, style, and live energy from intimate venues to bigger stages across the map.",
      Thumbnail: "https://static.wixstatic.com/media/355bb7_27e18e65a5874f98b0c535492fea59f0~mv2.png/v1/fill/w_962,h_542,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/Certified%20Tour%20overs_PNG.png"
    }));
    addedDef = true;
  }

  const msg = migrated + " row(s) moved from Films to Shows." + (addedDef ? " Added the Certified Tour show/poster row too." : "");
  Logger.log(msg);
  invalidateCatalogCache_();
  try { SpreadsheetApp.getUi().alert(msg + "\n\nLast step: pick the most recent Certified Tour episode row and set its IsFeature column to TRUE (and clear IsFeature on any old standalone Certified Tour feature row)."); } catch(e){}
  return migrated;
}

// ---------------------------------------------------------------------
// Generic show importer — run once per show. Prompts for the show's
// exact Title (must match its "playlist" row already in the sheet) and
// its YouTube playlist ID, then adds every episode as its own row.
// Safe to re-run later to pick up new episodes.
// ---------------------------------------------------------------------

function importShowEpisodesPrompt(){
  const ui = SpreadsheetApp.getUi();
  const titleResp = ui.prompt("Import Episodes", "Exact Show Title (must match the show's row exactly):", ui.ButtonSet.OK_CANCEL);
  if(titleResp.getSelectedButton() !== ui.Button.OK) return;
  const showTitle = titleResp.getResponseText().trim();

  const playlistResp = ui.prompt("Import Episodes", "YouTube Playlist ID for \"" + showTitle + "\":", ui.ButtonSet.OK_CANCEL);
  if(playlistResp.getSelectedButton() !== ui.Button.OK) return;
  const playlistId = playlistResp.getResponseText().trim();

  const added = importShowEpisodes(showTitle, playlistId);
  ui.alert(added + " episode(s) imported for \"" + showTitle + "\".");
}

function importShowEpisodes(showTitle, playlistId){
  const entries = fetchPlaylistEntries_(playlistId);
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const existingIds = new Set(data.slice(1).map(r => r[0]));

  let added = 0;
  entries.forEach(({videoId, title}) => {
    if(existingIds.has(videoId)) return;
    const url = "https://youtu.be/" + videoId;
    const thumb = "https://img.youtube.com/vi/" + videoId + "/hqdefault.jpg";

    sheet.appendRow(buildRow_({
      VideoID: videoId, Title: title, Type: "episode", SourceURL: url,
      Row: "Shows", Thumbnail: thumb, Status: "Approved", ShowTitle: showTitle
    }));
    added++;
  });

  Logger.log(added + " episode(s) imported for " + showTitle);
  invalidateCatalogCache_();
  return added;
}

// ---------------------------------------------------------------------
// Public endpoint — the widget fetches this
// ---------------------------------------------------------------------

// Shared across every visitor hitting this deployment (unlike the widget's
// own sessionStorage cache, which is per-browser-tab only). Cuts down on
// repeated Sheet reads when multiple people load the page around the same
// time — Sheets API calls count against Apps Script's execution quotas.
const CATALOG_CACHE_KEY = "catalogPayload";
const CATALOG_CACHE_TTL_SECONDS = 300; // 5 minutes

function doGet(e){
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CATALOG_CACHE_KEY);
  if(cached){
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);
  const idx = idxMap_();

  let feature = null;
  const filmGroups = {}; // "Sub" -> items[]
  const filmOrder = [];
  const showDefs = {};   // Title -> {title,synopsis,image,imdb,sub,badge}
  const showOrder = [];
  const episodesByShow = {}; // ShowTitle -> episodes[]

  rows.forEach(r => {
    if((r[idx.Status] || "").toString().toLowerCase() !== "approved") return;

    const type = (r[idx.Type] || "").toString().toLowerCase();
    const title = r[idx.Title] || "";
    const isFeature = String(r[idx.IsFeature]).toLowerCase() === "true";

    // Capture the feature, but DON'T return early — a featured row still
    // needs to fall through and get filed as its normal type (usually an
    // episode), so it also shows up in that show's own episode list and
    // the Feature displays the actual episode title, not a playlist name.
    if(isFeature){
      feature = {
        title: title,
        synopsis: r[idx.Synopsis] || "",
        image: r[idx.Thumbnail] || "",
        youtube: r[idx.SourceURL] || "",
        imdb: r[idx.IMDb] || "",
        showTitle: r[idx.ShowTitle] || "" // used below to attach sibling episodes
      };
    }

    if(type === "episode"){
      const showTitle = r[idx.ShowTitle] || "";
      if(!showTitle) return;
      if(!episodesByShow[showTitle]) episodesByShow[showTitle] = [];
      episodesByShow[showTitle].push({
        title: title,
        synopsis: r[idx.Synopsis] || "",
        image: r[idx.Thumbnail] || "",
        youtube: r[idx.SourceURL] || "",
        imdb: r[idx.IMDb] || ""
      });
      return;
    }

    const rowName = r[idx.Row] || "Films";

    if(rowName === "Shows"){
      // this row IS a show's definition (Type "playlist" or similar)
      showDefs[title] = {
        title: title,
        synopsis: r[idx.Synopsis] || "",
        image: r[idx.Thumbnail] || "",
        imdb: r[idx.IMDb] || "",
        sub: r[idx.SubCategory] || "Shows",
        fallbackYoutube: r[idx.SourceURL] || ""
      };
      showOrder.push(title);
      return;
    }

    // otherwise: a Films item
    const item = {
      title: title,
      synopsis: r[idx.Synopsis] || "",
      image: r[idx.Thumbnail] || "",
      youtube: r[idx.SourceURL] || "",
      imdb: r[idx.IMDb] || "",
      badge: r[idx.Badge] || ""
    };
    const subName = r[idx.SubCategory] || "Misc";
    if(!filmGroups[subName]){ filmGroups[subName] = []; filmOrder.push(subName); }
    filmGroups[subName].push(item);
  });

  const films = filmOrder.map(sub => ({ row: "Films", sub: sub, items: filmGroups[sub] }));

  const shows = showOrder.map(t => {
    const def = showDefs[t];
    let episodes = episodesByShow[t] || [];
    if(episodes.length === 0 && def.fallbackYoutube){
      // no episodes imported yet — fall back to the show's own link as a single entry
      episodes = [{ title: "Watch " + def.title, synopsis: def.synopsis, image: def.image, youtube: def.fallbackYoutube, imdb: def.imdb }];
    }
    return { title: def.title, synopsis: def.synopsis, image: def.image, imdb: def.imdb, sub: def.sub, episodes: episodes };
  });

  const payload = { feature: featureWithEpisodes(feature, shows), films: films, shows: shows };
  const json = JSON.stringify(payload);

  try { cache.put(CATALOG_CACHE_KEY, json, CATALOG_CACHE_TTL_SECONDS); }
  catch(err){ /* payload over the 100KB cache-value limit, or cache unavailable — non-fatal, just skip caching this time */ }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// If the featured row belongs to a show (has a ShowTitle), attach that
// show's full episode list so the hero's lightbox can list the rest of
// the season too, same as opening the show directly.
function featureWithEpisodes(feature, shows){
  if(!feature) return feature;
  if(feature.showTitle){
    const parentShow = shows.find(s => s.title === feature.showTitle);
    if(parentShow) feature.episodes = parentShow.episodes;
  }
  delete feature.showTitle;
  return feature;
}
