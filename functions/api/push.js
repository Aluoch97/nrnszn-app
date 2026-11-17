// /api/push: phone notifications for visitors (see src/edge/push.js).
//   GET  /api/push                                         -> { on, key }  (is it switched on, and the public key a phone needs)
//   POST /api/push { action:'subscribe', subscription:{ endpoint, p256dh, auth } }   a phone turns notifications on
//   POST /api/push { action:'unsubscribe', endpoint }                                 a phone turns them off
// Sending is owner-only and lives in /api/admin (action 'push-send').
import { hasDb } from '../../src/edge/db.js';
import { pushInfo, pushSubscribe, pushUnsubscribe } from '../../src/edge/push.js';

const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' } });

export const onRequestGet = ({ env }) => reply({ ok: true, ...pushInfo(env || {}) });

export async function onRequestPost({ request, env }) {
  env = env || {};
  let body; try { body = await request.json(); } catch { return reply({ ok: false, message: 'Bad request.' }, 400); }
  if (!pushInfo(env).on) return reply({ ok: false, message: 'Notifications are not switched on yet.' }, 503);
  if (!hasDb(env)) return reply({ ok: false, message: 'The site database is not connected yet.' }, 503);
  try {
    if (body && body.action === 'subscribe') return reply(await pushSubscribe(env.DB, env, body.subscription, request.headers.get('cf-connecting-ip')));
    if (body && body.action === 'unsubscribe') return reply(await pushUnsubscribe(env.DB, body.endpoint));
  } catch (e) { return reply({ ok: false, message: String((e && e.message) || e).slice(0, 200) }, 400); }
  return reply({ ok: false, message: 'Unknown request.' }, 400);
}
