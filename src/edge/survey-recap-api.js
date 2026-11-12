// POST /api/survey-recap: runs the daily recap check (called once a day by .github/workflows/recap-daily.yml, or by hand from the Actions tab).
// Protected by the Cloudflare secret RECAP_CRON_TOKEN (sent as "Authorization: Bearer <token>"). Switches on only when that and the three
// survey secrets exist; otherwise it does nothing and the old Apps Script timer keeps doing the job.
//   ?preview=1  sends the sample recap e-mail to Nick instead of running the check.
import { checkForRecapVideo, sendPreviewRecap } from './survey-recap.js';
import { surveyReady } from './survey-api.js';

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' } });
export const recapReady = (env) => surveyReady(env) && !!String(env.RECAP_CRON_TOKEN || '').trim();

/** Compares two strings without stopping at the first difference. */
export function sameToken(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export function recapStatus(env) {
  return reply({ status: 'ok', message: 'NuRenaissance survey recap endpoint is live.', mode: recapReady(env) ? 'edge' : 'apps-script' });
}

export async function handleRecap({ request, env }) {
  env = env || {};
  if (!recapReady(env)) return reply({ ok: false, mode: 'apps-script', message: 'Not switched on yet: the old Apps Script timer still sends the recap.' }, 503);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!sameToken(given, env.RECAP_CRON_TOKEN)) return reply({ ok: false, message: 'Unauthorized' }, 401);
  if (new URL(request.url).searchParams.get('preview') === '1') {
    try { await sendPreviewRecap(env); return reply({ ok: true, result: 'preview-sent' }); }
    catch (e) { return reply({ ok: false, result: 'failed', error: String(e && e.message || e) }, 502); }
  }
  const out = await checkForRecapVideo(env);
  return reply({ ok: out.result !== 'failed', ...out }, out.result === 'failed' ? 502 : 200);
}
