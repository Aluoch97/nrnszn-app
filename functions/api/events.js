// GET /api/events: the events added in /admin that are marked "show on the site". The Events page merges them with the show guide and the older past events.
import { listPublic } from '../../src/edge/events.js';
import { hasDb } from '../../src/edge/db.js';

export const onRequestGet = async ({ env }) => {
  let events = [];
  if (hasDb(env)) { try { events = await listPublic(env.DB); } catch (e) { console.error('events', e); } }
  return new Response(JSON.stringify({ ok: true, events }), { headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'public, max-age=60' } });
};
