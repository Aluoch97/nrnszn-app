// /events/<slug>/ for an event added in /admin (see src/edge/eventpage.js). Anything that is not one of those (the older events have real pages
// made at build time, and unknown addresses) is passed straight on with context.next(), so nothing else changes.
import { getPublicEvent } from '../../src/edge/events.js';
import { hasDb } from '../../src/edge/db.js';
import { idFromSlug, eventSlug, renderEventPage } from '../../src/edge/eventpage.js';

export const onRequestGet = async (context) => {
  const { request, env, params } = context, slug = String(params.slug || '');
  const id = idFromSlug(slug);
  if (!id || !hasDb(env)) return context.next();
  let event = null;
  try { event = await getPublicEvent(env.DB, id); } catch (e) { console.error('event page', e); return context.next(); }
  if (!event) return context.next();
  const url = new URL(request.url), canonical = eventSlug(event);
  if (slug !== canonical) return Response.redirect(`${url.origin}/events/${canonical}/`, 301);   // the event was renamed: the old link still works
  try {
    const tpl = await env.ASSETS.fetch(new URL('/event-live/', url.origin));
    if (!tpl.ok) return context.next();
    return new Response(renderEventPage(await tpl.text(), event, url.origin), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  } catch (e) { console.error('event page render', e); return context.next(); }
};
