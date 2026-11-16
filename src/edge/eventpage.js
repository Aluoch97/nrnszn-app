// Every event has its own page at /events/<slug>/ with the details, the flyer, tickets and links.
//   - The older past events (src/data/events.js) get their pages when the site is built (src/pages/events/[slug].astro).
//   - Events added in /admin live in the database, so their page is made when someone opens it: functions/events/[slug].js takes the ready-made
//     template page (/event-live/, built with the site's normal header and footer), puts this event's title, description, share picture and a
//     JSON copy of the event into it, and the page's own script draws the details (as plain text, never as HTML).
//   A slug for an admin event ends in its 12-letter id ("spring-showcase-a1b2c3d4e5f6"), so renaming the event keeps the old link working
//   (it redirects to the new slug). The older events' slugs start with their date ("2026-10-17-certified-lounge-fall-2026"), so the two never clash.

export const slugify = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'event';
export const eventSlug = (e) => `${slugify(e.title)}-${e.id}`;
export const idFromSlug = (slug) => { const m = /-([a-f0-9]{12})$/.exec(String(slug || '')); return m ? m[1] : ''; };
/** The slug of one of the older events that live in the site's code. */
export const staticSlug = (e) => `${e.day}-${slugify(e.title)}`;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const jsonSafe = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** "Sat, Feb 13, 2027 · 7 PM" from a YYYY-MM-DD day and an optional time text. */
export function niceWhen(day, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); if (!m) return String(time || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (time ? ` · ${time}` : '');
}

/** Search-engine "Event" data, so Google can show the date and a tickets button. */
export function eventJsonLd(e, url, image) {
  const ld = { '@context': 'https://schema.org', '@type': 'Event', name: e.title, startDate: e.day, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', url,
    organizer: { '@type': 'Organization', name: 'NuRenaissance Media', url: 'https://www.nrnszn.com' } };
  if (e.where) ld.location = { '@type': 'Place', name: e.where };
  if (image) ld.image = [image];
  if (e.details) ld.description = String(e.details).slice(0, 300);
  if (/^https:\/\//.test(e.tickets || '')) ld.offers = { '@type': 'Offer', url: e.tickets, availability: 'https://schema.org/InStock' };
  return ld;
}

const summary = (e) => String(e.details || '').replace(/\s+/g, ' ').trim().slice(0, 155) || [niceWhen(e.day, e.time), e.where].filter(Boolean).join(' · ');

/** Fills the template page for one admin event. Everything that goes into the page is escaped. */
export function renderEventPage(template, e, origin) {
  const url = `${origin}/events/${eventSlug(e)}/`, image = e.flyer ? `${origin}/api/flyer?id=${e.flyer}&size=900` : `${origin}/img/share.jpg`;
  const title = `${e.title} | NuRenaissance`, desc = summary(e);
  let html = String(template);
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, () => `<meta name="description" content="${esc(desc)}" />`);
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, () => `<link rel="canonical" href="${esc(url)}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, () => `<meta property="og:title" content="${esc(title)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, () => `<meta property="og:description" content="${esc(desc)}" />`);
  html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/?>/, () => `<meta property="og:url" content="${esc(url)}" />`);
  html = html.replace(/<meta property="og:image" content="[^"]*"\s*\/?>/, () => `<meta property="og:image" content="${esc(image)}" />`);
  html = html.replace(/<meta name="twitter:image" content="[^"]*"\s*\/?>/, () => `<meta name="twitter:image" content="${esc(image)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/, () => `<meta name="twitter:description" content="${esc(desc)}" />`);
  html = html.replace(/<meta property="og:image:(width|height)" content="[^"]*"\s*\/?>\s*/g, '').replace(/<meta property="og:image:alt" content="[^"]*"\s*\/?>\s*/, '');
  html = html.replace(/<meta name="robots" content="noindex[^"]*"\s*\/?>\s*/, '');   // the template is hidden from search; a real event is not
  html = html.replace('</head>', () => `<script type="application/ld+json">${jsonSafe(eventJsonLd(e, url, e.flyer ? image : ''))}</script></head>`);
  html = html.replace('</body>', () => `<script type="application/json" id="event-data">${jsonSafe({ ...e, slug: eventSlug(e) })}</script></body>`);
  return html;
}
