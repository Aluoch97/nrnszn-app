// NuGallery read from Google Drive at the edge (Cloudflare Pages Functions), replacing the Apps Script backend
// (apps-script/gallery/Code.gs) with the same answer, rule for rule: Gallery Root > category folders > door folders > photos.
//   { categories: [ { title, certified, doors: [ { title, images: [ {id,name,dateSort,date,credit,igUrl,thumbUrl,fullUrl,downloadUrl} ], cover, videoUrl } ] } ] }
// It signs in to Drive as a Google SERVICE ACCOUNT (read-only), so the Cloudflare secret GOOGLE_SERVICE_ACCOUNT_JSON (the
// account's JSON key) is needed, and the Gallery Root folder must be shared with the account's e-mail address (Viewer).
// Photos themselves are still served through /api/drive (public Drive thumbnails, cached at Cloudflare), as before.

export const GALLERY_ROOT_FOLDER_ID = '1e3JOe1YPrZQz5wxUqDOpsEbStteNBiQs'; // NuGallery root folder (same as Code.gs; an address, not a secret)
export const DEFAULT_CREDIT = 'Shot by Nicólas Soul';
export const DEFAULT_CREDIT_URL = 'https://www.soulnicolas.com/'; // link used whenever the credit is the default one
const TIMEZONE = 'America/Chicago';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const ID = /^[A-Za-z0-9_-]{10,100}$/;
const PARENTS_PER_QUERY = 25; // doors read together in one Drive request

// ---------------------------------------------------------------- the small rules (ported from Code.gs, unit-tested)

/** Strips an optional leading ordering number like "1 " or "01 - " from a folder name. */
export const cleanFolderName = (name) => String(name).replace(/^\d+\s*[-.]?\s*/, '');

/** "Spring 2024" / "Fall 2025" as a sortable number, newest = highest (Winter < Spring < Summer < Fall). */
export function seasonYearSortKey(name) {
  const m = /(Winter|Spring|Summer|Fall)\s*(\d{4})/i.exec(name);
  if (!m) return 0;
  return parseInt(m[2], 10) * 10 + { winter: 0, spring: 1, summer: 2, fall: 3 }[m[1].toLowerCase()];
}

export function toInstagramUrl(raw) {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return 'https://instagram.com/' + raw.replace(/^@/, '');
}

/** A door folder's Description: "Credit | Instagram | Video", any part may be empty. */
export function parseCredit(rawDescription, isCertifiedGroup) {
  const raw = String(rawDescription || '').trim();
  if (!raw) return isCertifiedGroup ? { credit: '', igUrl: '', videoUrl: '' } : { credit: DEFAULT_CREDIT, igUrl: DEFAULT_CREDIT_URL, videoUrl: '' };
  const parts = raw.split('|');
  let credit = (parts[0] || '').trim();
  let igUrl = parts[1] ? toInstagramUrl(parts[1].trim()) : '';
  const videoUrl = parts[2] ? parts[2].trim() : '';
  if (!credit && !isCertifiedGroup) credit = DEFAULT_CREDIT;
  if (!igUrl && credit === DEFAULT_CREDIT) igUrl = DEFAULT_CREDIT_URL;
  return { credit, igUrl, videoUrl };
}

const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** MM/dd/yyyy in Nashville time (a photo made late on the 28th stays on the 28th). */
export const formatDate = (ms) => dateFmt.format(new Date(ms));

/** A file named cover_… or cover-… is always the door's face; otherwise the newest photo. */
export function pickCoverUrl(images) {
  for (const im of images) if (/^cover[_-]/i.test(im.name)) return im.thumbUrl;
  return images.length ? images[0].thumbUrl : null;
}

export function imageFrom(file, credit, igUrl) {
  const created = new Date(file.createdTime);
  return {
    id: file.id,
    name: file.name,
    dateSort: created.getTime(),
    date: formatDate(created.getTime()),
    credit: credit || '',
    igUrl: igUrl || '',
    thumbUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w500`,
    fullUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1600`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${file.id}`,
  };
}

// ---------------------------------------------------------------- signing in as the service account

/** The secret pasted into Cloudflare is the key file's JSON. Tolerates a paste with real line breaks inside the key. */
export function parseServiceAccount(text) {
  const raw = String(text || '').trim();
  let email = '', key = '';
  try { const j = JSON.parse(raw); email = j.client_email; key = j.private_key; }
  catch {
    email = (/"client_email"\s*:\s*"([^"]+)"/.exec(raw) || [])[1];
    key = (/"private_key"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/.exec(raw) || [])[1];
  }
  key = String(key || '').replace(/\\n/g, '\n').trim();
  if (!email || !/BEGIN PRIVATE KEY/.test(key)) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
  return { email, key };
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textB64url = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
const pemToDer = (pem) => Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));

export async function signJwt({ email, key }, nowSecs) {
  const head = textB64url({ alg: 'RS256', typ: 'JWT' });
  const claims = textB64url({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: nowSecs, exp: nowSecs + 3600 });
  const k = await crypto.subtle.importKey('pkcs8', pemToDer(key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

let tokenCache = { email: '', token: '', until: 0 };
/** An access token, kept for about 55 minutes inside a warm instance. */
export async function getAccessToken(account, now = Date.now()) {
  if (tokenCache.email === account.email && tokenCache.token && now < tokenCache.until) return tokenCache.token;
  const assertion = await signJwt(account, Math.floor(now / 1000));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Google sign-in answered ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Google sign-in gave no access token');
  tokenCache = { email: account.email, token: data.access_token, until: now + Math.min(Number(data.expires_in) || 3600, 3600) * 1000 - 5 * 60 * 1000 };
  return data.access_token;
}
export const forgetToken = () => { tokenCache = { email: '', token: '', until: 0 }; };

// ---------------------------------------------------------------- reading Drive

async function listFiles(token, q, fields, orderBy) {
  const out = [];
  let pageToken = '';
  do {
    const url = new URL(FILES_URL);
    url.search = new URLSearchParams({ q, fields: `nextPageToken, files(${fields})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(orderBy ? { orderBy } : {}), ...(pageToken ? { pageToken } : {}) }).toString();
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Drive answered ${res.status}`); // never cached: the last good copy keeps being served
    const data = await res.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

const subfolders = (token, parentId) => listFiles(token, `'${parentId}' in parents and mimeType = '${FOLDER}' and trashed = false`, 'id,name,description', 'name');

/** Every photo directly inside each of these door folders, grouped by door id (several doors per request). */
async function photosByDoor(token, doorIds) {
  const byDoor = new Map(doorIds.map((id) => [id, []]));
  for (let i = 0; i < doorIds.length; i += PARENTS_PER_QUERY) {
    const chunk = doorIds.slice(i, i + PARENTS_PER_QUERY);
    const q = `(${chunk.map((id) => `'${id}' in parents`).join(' or ')}) and mimeType contains 'image/' and trashed = false`;
    for (const f of await listFiles(token, q, 'id,name,createdTime,parents')) for (const p of f.parents || []) if (byDoor.has(p)) byDoor.get(p).push(f);
  }
  return byDoor;
}

/** The whole gallery, built like Code.gs's buildGalleryData(). */
export async function buildGallery(token, rootId = GALLERY_ROOT_FOLDER_ID) {
  if (!ID.test(rootId)) throw new Error('bad gallery root folder id');
  const categoryFolders = (await subfolders(token, rootId)).sort((a, b) => a.name.localeCompare(b.name));
  const categories = [];
  for (const category of categoryFolders) {
    const isCertified = /certified/i.test(category.name);
    const doorFolders = await subfolders(token, category.id);
    const photos = await photosByDoor(token, doorFolders.map((d) => d.id));
    let doors = doorFolders.map((door) => {
      const parsed = parseCredit(door.description, isCertified);
      const images = photos.get(door.id).map((f) => imageFrom(f, parsed.credit, parsed.igUrl)).sort((a, b) => b.dateSort - a.dateSort);
      return { title: cleanFolderName(door.name), images, cover: pickCoverUrl(images), videoUrl: parsed.videoUrl, _sort: seasonYearSortKey(door.name), _raw: door.name };
    }).filter((d) => d.images.length > 0);
    doors = isCertified ? doors.sort((a, b) => b._sort - a._sort) : doors.sort((a, b) => a._raw.localeCompare(b._raw));
    for (const d of doors) { delete d._sort; delete d._raw; }
    if (doors.length) categories.push({ title: cleanFolderName(category.name), certified: isCertified, doors });
  }
  return { categories };
}

/** Sign in and read the gallery. `secret` is the GOOGLE_SERVICE_ACCOUNT_JSON text. */
export async function loadGallery(secret, rootId = GALLERY_ROOT_FOLDER_ID) {
  const token = await getAccessToken(parseServiceAccount(secret));
  return buildGallery(token, rootId);
}
