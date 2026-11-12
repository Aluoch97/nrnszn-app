// Signing in to Google as a read-only SERVICE ACCOUNT from Cloudflare Pages Functions (no libraries: Web Crypto only).
// The Cloudflare secret GOOGLE_SERVICE_ACCOUNT_JSON holds the account's JSON key. Used by the gallery (Drive) and the cinema
// catalog (Sheets); each asks for its own read-only scope and gets its own access token.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

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

export async function signJwt({ email, key }, nowSecs, scope = DRIVE_SCOPE) {
  const head = textB64url({ alg: 'RS256', typ: 'JWT' });
  const claims = textB64url({ iss: email, scope, aud: TOKEN_URL, iat: nowSecs, exp: nowSecs + 3600 });
  const k = await crypto.subtle.importKey('pkcs8', pemToDer(key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

const tokenCache = new Map(); // account e-mail + scope -> { token, until }
/** An access token for one scope, kept for about 55 minutes inside a warm instance. */
export async function getAccessToken(account, now = Date.now(), scope = DRIVE_SCOPE) {
  const id = account.email + ' ' + scope, hit = tokenCache.get(id);
  if (hit && now < hit.until) return hit.token;
  const assertion = await signJwt(account, Math.floor(now / 1000), scope);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Google sign-in answered ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Google sign-in gave no access token');
  tokenCache.set(id, { token: data.access_token, until: now + Math.min(Number(data.expires_in) || 3600, 3600) * 1000 - 5 * 60 * 1000 });
  return data.access_token;
}
export const forgetToken = () => tokenCache.clear();

