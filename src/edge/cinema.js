// NuCinema catalog read from its Google Sheet at the edge (Cloudflare Pages Functions), replacing the Apps Script web app
// (apps-script/cinema/Code.gs doGet) with the same answer, rule for rule:
//   { feature: {...}|null, films: [ { row, sub, items } ], shows: [ { title, synopsis, image, imdb, sub, episodes } ] }
// The Sheet stays where you edit the catalog. It is read with a read-only Google SERVICE ACCOUNT (Cloudflare secret
// GOOGLE_SERVICE_ACCOUNT_JSON, the same one the gallery uses); the Sheet must be shared with that account's e-mail (Viewer).
// The Sheet's own helper menu (🎬 Cinema Admin: new-upload check, importing a show's episodes) still lives in Apps Script.
import { parseServiceAccount, getAccessToken, SHEETS_SCOPE } from './google.js';

export const CINEMA_SHEET_ID = '131Z_OkhxZffRS0BWBFUy1GrgFeC_wvbqser53xJQEU8'; // the "NuCinema" spreadsheet (an address, not a secret)
export const SHEET_NAME = 'Cinema_Catalog';
// Columns are read BY POSITION, exactly like Code.gs (the header row is ignored: the live sheet's header has no "ShowTitle"
// label even though episodes keep their show name in that 13th column).
export const HEADERS = ['VideoID', 'Title', 'Type', 'SourceURL', 'Row', 'SubCategory', 'Synopsis', 'IMDb', 'Thumbnail', 'IsFeature', 'Status', 'Badge', 'ShowTitle'];
const idx = Object.fromEntries(HEADERS.map((h, i) => [h, i]));

/**
 * The catalog from the Sheet's data rows (everything under the header row). Rows may be short: Google trims empty cells
 * at the end of a row, Apps Script never did, so missing cells count as "".
 */
export function buildCatalog(dataRows) {
  const rows = (dataRows || []).map((r) => Array.from({ length: HEADERS.length }, (_, i) => (r && r[i] !== undefined && r[i] !== null ? r[i] : '')));

  let feature = null;
  const filmGroups = {}; // "Sub" -> items[]
  const filmOrder = [];
  const showDefs = {}; // Title -> {title,synopsis,image,imdb,sub,fallbackYoutube}
  const showOrder = [];
  const episodesByShow = {}; // ShowTitle -> episodes[]

  rows.forEach((r) => {
    if ((r[idx.Status] || '').toString().toLowerCase() !== 'approved') return;

    const type = (r[idx.Type] || '').toString().toLowerCase();
    const title = r[idx.Title] || '';
    const isFeature = String(r[idx.IsFeature]).toLowerCase() === 'true';

    // The feature is captured but the row still falls through to be filed as its normal type (usually an episode).
    if (isFeature) {
      feature = {
        title,
        synopsis: r[idx.Synopsis] || '',
        image: r[idx.Thumbnail] || '',
        youtube: r[idx.SourceURL] || '',
        imdb: r[idx.IMDb] || '',
        showTitle: r[idx.ShowTitle] || '',
      };
    }

    if (type === 'episode') {
      const showTitle = r[idx.ShowTitle] || '';
      if (!showTitle) return;
      if (!episodesByShow[showTitle]) episodesByShow[showTitle] = [];
      episodesByShow[showTitle].push({
        title,
        synopsis: r[idx.Synopsis] || '',
        image: r[idx.Thumbnail] || '',
        youtube: r[idx.SourceURL] || '',
        imdb: r[idx.IMDb] || '',
      });
      return;
    }

    const rowName = r[idx.Row] || 'Films';

    if (rowName === 'Shows') {
      showDefs[title] = {
        title,
        synopsis: r[idx.Synopsis] || '',
        image: r[idx.Thumbnail] || '',
        imdb: r[idx.IMDb] || '',
        sub: r[idx.SubCategory] || 'Shows',
        fallbackYoutube: r[idx.SourceURL] || '',
      };
      showOrder.push(title);
      return;
    }

    const item = {
      title,
      synopsis: r[idx.Synopsis] || '',
      image: r[idx.Thumbnail] || '',
      youtube: r[idx.SourceURL] || '',
      imdb: r[idx.IMDb] || '',
      badge: r[idx.Badge] || '',
    };
    const subName = r[idx.SubCategory] || 'Misc';
    if (!filmGroups[subName]) { filmGroups[subName] = []; filmOrder.push(subName); }
    filmGroups[subName].push(item);
  });

  const films = filmOrder.map((sub) => ({ row: 'Films', sub, items: filmGroups[sub] }));

  const shows = showOrder.map((t) => {
    const def = showDefs[t];
    let episodes = episodesByShow[t] || [];
    if (episodes.length === 0 && def.fallbackYoutube) {
      // no episodes imported yet: the show's own link stands in as a single entry
      episodes = [{ title: 'Watch ' + def.title, synopsis: def.synopsis, image: def.image, youtube: def.fallbackYoutube, imdb: def.imdb }];
    }
    return { title: def.title, synopsis: def.synopsis, image: def.image, imdb: def.imdb, sub: def.sub, episodes };
  });

  return { feature: featureWithEpisodes(feature, shows), films, shows };
}

// A featured episode carries its whole show's episode list, so the hero's lightbox can list the rest of the season.
function featureWithEpisodes(feature, shows) {
  if (!feature) return feature;
  if (feature.showTitle) {
    const parentShow = shows.find((s) => s.title === feature.showTitle);
    if (parentShow) feature.episodes = parentShow.episodes;
  }
  delete feature.showTitle;
  return feature;
}

/** The Sheet's rows (below the header) through the Sheets API, with numbers and true/false kept as Apps Script's getValues did. */
export async function readCatalogRows(token, sheetId = CINEMA_SHEET_ID) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(sheetId)) throw new Error('bad cinema sheet id');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_NAME + '!A2:M')}?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Sheets answered ${res.status}`); // never cached: the last good copy keeps being served
  const data = await res.json();
  return data.values || [];
}

/** Sign in and read the catalog. `secret` is the GOOGLE_SERVICE_ACCOUNT_JSON text. */
export async function loadCinema(secret, sheetId = CINEMA_SHEET_ID) {
  const token = await getAccessToken(parseServiceAccount(secret), Date.now(), SHEETS_SCOPE);
  return buildCatalog(await readCatalogRows(token, sheetId));
}
