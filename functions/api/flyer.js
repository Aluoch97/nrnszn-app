// GET /api/flyer?id=<id>&size=480|900: an event flyer picture (see src/edge/events.js).
import { flyerResponse } from '../../src/edge/events.js';
import { hasDb } from '../../src/edge/db.js';

export const onRequestGet = async ({ request, env }) => {
  const u = new URL(request.url);
  if (!hasDb(env)) return new Response('Not found', { status: 404 });
  try { return await flyerResponse(env.DB, u.searchParams.get('id'), u.searchParams.get('size')); }
  catch (e) { console.error('flyer', e); return new Response('Not found', { status: 404 }); }
};
