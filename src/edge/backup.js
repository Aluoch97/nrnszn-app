// Daily copy of the four Google Sheets that hold the site's real data (surveys + subscribers + discount codes, payments log, services, cinema)
// into a PRIVATE Cloudflare R2 bucket, so a deleted or damaged sheet can be rebuilt from a file that Google does not control.
//
//   POST /api/backup  (Authorization: Bearer <BACKUP_CRON_TOKEN>)  runs the backup. Called once a day by .github/workflows/backup-daily.yml.
//   GET  /api/backup                                              says whether it is set up and when the last backup was made (no data).
//
// Switches on only when BOTH exist: the R2 binding BACKUPS and the secret BACKUP_CRON_TOKEN (see docs/backup-setup.md).
// Each sheet is read with the service account the site already uses for it, with READ-ONLY permission. A sheet that cannot be read is
// reported and skipped; the others are still saved. Nothing is written back to Google. The bucket must never be made public: it holds
// subscriber e-mail addresses and payment notes.
import { parseServiceAccount, getAccessToken, SHEETS_SCOPE } from './google.js';
import { SURVEYS_SHEET_ID } from './survey-sheets.js';
import { PAYMENTS_SHEET_ID } from './payments.js';
import { SERVICES_SHEET_ID } from './services.js';
import { CINEMA_SHEET_ID } from './cinema.js';
import { sameToken } from './survey-recap-api.js';

export const KEEP_BACKUPS = 30;
const PREFIX = 'sheets/';
const ID_OK = /^[A-Za-z0-9_-]{20,100}$/;
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' } });

/** Which sheets to copy, and which of the site's existing keys can read each one. */
export function sources(env) {
  const pick = (override, fallback) => (ID_OK.test(String(override || '')) ? override : fallback);
  return [
    { name: 'surveys', sheetId: pick(env.SURVEYS_SHEET_ID, SURVEYS_SHEET_ID), secret: env.SURVEY_SERVICE_ACCOUNT_JSON },
    { name: 'payments', sheetId: pick(env.PAYMENTS_SHEET_ID, PAYMENTS_SHEET_ID), secret: env.PAYMENTS_SERVICE_ACCOUNT_JSON },
    { name: 'services', sheetId: pick(env.SERVICES_SHEET_ID, SERVICES_SHEET_ID), secret: env.GOOGLE_SERVICE_ACCOUNT_JSON },
    { name: 'cinema', sheetId: pick(env.CINEMA_SHEET_ID, CINEMA_SHEET_ID), secret: env.GOOGLE_SERVICE_ACCOUNT_JSON },
  ];
}

export const backupReady = (env) => !!(env && env.BACKUPS && typeof env.BACKUPS.put === 'function' && String(env.BACKUP_CRON_TOKEN || '').trim());

/** Every tab of one spreadsheet, as the cells were typed (formulas stay formulas), so a restore can put them back. */
export async function readAllTabs(token, sheetId) {
  const head = { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) };
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`, head);
  if (!meta.ok) throw new Error(`Sheets answered ${meta.status} for the tab list`);
  const titles = ((await meta.json()).sheets || []).map((s) => s.properties && s.properties.title).filter(Boolean);
  if (!titles.length) return {};
  const q = new URLSearchParams();
  titles.forEach((t) => q.append('ranges', `'${String(t).replace(/'/g, "''")}'`));
  q.set('valueRenderOption', 'FORMULA'); q.set('majorDimension', 'ROWS');
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${q}`, head);
  if (!res.ok) throw new Error(`Sheets answered ${res.status} for the cells`);
  const data = await res.json(), tabs = {};
  titles.forEach((t, i) => { tabs[t] = (data.valueRanges && data.valueRanges[i] && data.valueRanges[i].values) || []; });
  return tabs;
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads every sheet, saves one file for today, and keeps the newest KEEP_BACKUPS. Returns counts only, never the data. */
export async function runBackup(env, now = new Date()) {
  const out = { saved: {}, failed: {}, skipped: {} }, snapshot = { version: 1, at: now.toISOString(), sheets: {} };
  for (const s of sources(env)) {
    if (!String(s.secret || '').trim()) { out.skipped[s.name] = 'no key for this sheet is set on the site'; continue; }
    try {
      const token = await getAccessToken(parseServiceAccount(s.secret), now.getTime(), SHEETS_SCOPE);
      const tabs = await readAllTabs(token, s.sheetId);
      snapshot.sheets[s.name] = { sheetId: s.sheetId, tabs };
      out.saved[s.name] = { tabs: Object.keys(tabs).length, rows: Object.values(tabs).reduce((n, r) => n + r.length, 0) };
    } catch (e) { out.failed[s.name] = String((e && e.message) || e).slice(0, 200); }
  }
  if (!Object.keys(out.saved).length) return { ok: false, result: 'nothing-saved', ...out };
  const body = await gzip(JSON.stringify(snapshot));
  const key = `${PREFIX}${now.toISOString().slice(0, 10)}.json.gz`;
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { at: snapshot.at, sheets: Object.keys(out.saved).join(',') } });
  // keep only the newest KEEP_BACKUPS
  try {
    const all = await listAll(env.BACKUPS);
    const old = all.map((o) => o.key).sort().reverse().slice(KEEP_BACKUPS);
    for (const k of old) await env.BACKUPS.delete(k);
  } catch (e) { /* cleanup is best effort; the new file is already saved */ }
  const partial = Object.keys(out.failed).length > 0;
  return { ok: true, result: partial ? 'partial' : 'saved', file: key, bytes: body.length, ...out };
}

async function listAll(bucket) {
  const objects = []; let cursor;
  for (let i = 0; i < 20; i++) {
    const page = await bucket.list({ prefix: PREFIX, cursor });
    objects.push(...(page.objects || []));
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return objects;
}

export async function backupStatus(env) {
  env = env || {};
  if (!backupReady(env)) return reply({ status: 'ok', message: 'NuRenaissance sheet backups.', mode: 'not-set-up' });
  let last = null;
  try {
    const all = (await listAll(env.BACKUPS)).sort((a, b) => (a.key < b.key ? 1 : -1));
    if (all[0]) last = { file: all[0].key, at: all[0].uploaded ? new Date(all[0].uploaded).toISOString() : null, bytes: all[0].size, kept: all.length };
  } catch (e) { return reply({ status: 'ok', message: 'NuRenaissance sheet backups.', mode: 'r2', error: 'could not list the bucket' }); }
  return reply({ status: 'ok', message: 'NuRenaissance sheet backups.', mode: 'r2', last });
}

export async function handleBackup({ request, env }) {
  env = env || {};
  if (!backupReady(env)) return reply({ ok: false, mode: 'not-set-up', message: 'Backups are not set up yet (see docs/backup-setup.md).' }, 503);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameToken(given, env.BACKUP_CRON_TOKEN)) return reply({ ok: false, message: 'Unauthorized' }, 401);
  try {
    const out = await runBackup(env);
    return reply(out, out.ok ? 200 : 502);
  } catch (e) { return reply({ ok: false, result: 'failed', error: String((e && e.message) || e).slice(0, 200) }, 502); }
}
