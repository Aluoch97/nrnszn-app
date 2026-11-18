// POST /api/hit: counts one page view, without cookies (see src/edge/analytics.js). Always answers 204.
import { recordHit } from '../../src/edge/analytics.js';
import { maybeAuto } from '../../src/edge/autopush.js';

export const onRequestPost = (context) => {
  // Every page view also runs the (throttled, never-throwing) check for new events, videos, services, photos and films: see src/edge/autopush.js.
  try { if (context.waitUntil) context.waitUntil(maybeAuto(context.env, { origin: new URL(context.request.url).origin })); } catch { /* the page view still counts */ }
  return recordHit(context);
};
