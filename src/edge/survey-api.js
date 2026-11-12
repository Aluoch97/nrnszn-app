// /api/survey: the live survey endpoint at the edge (Cloudflare Pages Functions), replacing the Apps Script doPost
// (apps-script/survey/Code.gs). The rules, the Sheet writes and the e-mails are src/edge/survey.js and survey-sheets.js (proven
// identical to the old script); this file is only the front door: size limit, trap and flood checks, the choice of backend and the answers.
//
// It switches on only when ALL THREE Cloudflare secrets exist: SURVEY_SERVICE_ACCOUNT_JSON (a Google service account that is Editor on
// the NuRenaissance Surveys sheet), RESEND_API_KEY and SURVEY_UNSUB_SECRET (copied from the old script so e-mailed unsubscribe links keep working).
// Otherwise the answer comes from the old Apps Script exactly as before.
//
// A response goes to exactly ONE backend. Nothing is written before the response row is added, so until then any failure
// (no sign-in, Google refusing the row) hands it to the old Apps Script. If it is not certain whether the row was written (a timeout)
// it is NOT retried anywhere, and once the row is saved nothing afterwards (subscriber list, e-mails, summary) can lose it or send it twice.
import { parseServiceAccount, getAccessToken, SHEETS_WRITE_SCOPE } from './google.js';
import { shouldDrop, SURVEY_APPS_SCRIPT_URL } from './survey.js';
import { SurveySheet, SURVEYS_SHEET_ID, recordSubmission } from './survey-sheets.js';
import { rateLimitOk } from './payments.js';

export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
export const RATE_LIMIT_PER_MINUTE = 60; // same circuit breaker as RATE_LIMIT_PER_MINUTE in Code.gs (kept per Cloudflare data centre, so approximate)
export const MAX_BODY = 50000;
const SECRETS = ['SURVEY_SERVICE_ACCOUNT_JSON', 'RESEND_API_KEY', 'SURVEY_UNSUB_SECRET'];

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });
export const surveyReady = (env) => SECRETS.every((k) => String(env[k] || '').trim());

/** GET: a harmless "is it alive" answer, plus which backend would take a response. */
export function surveyStatus(env) {
  return reply({ status: 'ok', message: 'NuRenaissance survey endpoint is live.', mode: surveyReady(env) ? 'sheet' : 'apps-script' });
}

/** The old backend, as the fallback: the body is passed on unchanged and its answer handed back. */
async function viaAppsScript(text, env) {
  try {
    const res = await fetch(env.SURVEY_APPS_SCRIPT_URL || SURVEY_APPS_SCRIPT_URL, { method: 'POST', body: text, headers: { 'content-type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const answer = await res.text();
    try { JSON.parse(answer); } catch { return reply({ error: 'The survey could not be sent right now. Please try again.' }, 502); }
    return new Response(answer, { status: 200, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });
  } catch (e) {
    return reply({ error: 'The survey could not be sent right now. Please try again.' }, 502);
  }
}

/** POST: one survey response. Answers like the old doPost: { ok: true, subscribeResult? } or { error }. */
export async function handleSurvey({ request, env }) {
  env = env || {};
  let text, body;
  try {
    text = await request.text();
    if (text.length > MAX_BODY) return reply({ error: 'Request too large' }, 413);
    if (!text) return reply({ error: 'No data received by the server — check the request is sending a body.' });
    body = JSON.parse(text);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('expected an object');
  } catch (e) {
    return reply({ error: 'Something went wrong. Please try again or contact NuRenaissance Media directly.' });
  }

  if (shouldDrop(body)) return reply({ ok: true }); // the hidden-field and too-fast traps: quietly dropped, nothing saved
  if (!(await rateLimitOk('survey_submit', RATE_LIMIT_PER_MINUTE, 60))) return reply({ ok: true }); // flood: quietly dropped like before
  if (!surveyReady(env)) return viaAppsScript(text, env); // not switched over yet

  // Nothing written yet: a failure here can safely go to the old backend.
  let sheets;
  try {
    sheets = new SurveySheet(await getAccessToken(parseServiceAccount(env.SURVEY_SERVICE_ACCOUNT_JSON), Date.now(), SHEETS_WRITE_SCOPE), /^[A-Za-z0-9_-]{20,100}$/.test(env.SURVEYS_SHEET_ID || '') ? env.SURVEYS_SHEET_ID : SURVEYS_SHEET_ID);
  } catch (e) { console.error('survey: Google sign-in failed, using Apps Script', e); return viaAppsScript(text, env); }

  const state = { appending: false, saved: false };
  const realAppend = sheets.append.bind(sheets);
  sheets.append = async (...a) => {
    const first = !state.appending; state.appending = true;
    const n = await realAppend(...a); // (the row's date format is set inside; see dateTimeFormat below)
    if (first) state.saved = true;
    return n;
  };
  const realFormat = sheets.dateTimeFormat.bind(sheets);
  sheets.dateTimeFormat = async (...a) => { try { await realFormat(...a); } catch (e) { console.error('survey: date format failed (cosmetic)', e); } }; // the row is already written: never lose it over a cosmetic step

  try {
    return reply(await recordSubmission(body, env, { sheets }));
  } catch (e) {
    if (state.saved) { console.error('survey: the response is saved, but a later step failed', e); return reply({ ok: true, subscribeResult: 'error' }); }
    const refused = /^Sheets answered \d+ for /.test(String(e && e.message)); // Google said no: the row was not written
    if (!state.appending || refused) { console.error('survey: Sheets refused, using Apps Script', e); return viaAppsScript(text, env); }
    console.error('survey: no answer while writing the response; not retrying', e); // may or may not be written: never send it twice
    return reply({ error: 'Something went wrong. Please try again or contact NuRenaissance Media directly.' }, 502);
  }
}
