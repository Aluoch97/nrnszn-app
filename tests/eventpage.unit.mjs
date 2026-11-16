// Event pages (src/edge/eventpage.js and functions/events/[slug].js): the web addresses, and the page made for an event added in /admin. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, eventSlug, idFromSlug, staticSlug, niceWhen, eventJsonLd, renderEventPage } from '../src/edge/eventpage.js';
import { onRequestGet } from '../functions/events/[slug].js';
import { saveEvent } from '../src/edge/events.js';
import { pastEvents } from '../src/data/events.js';
import { fakeD1 } from './_d1.mjs';

const TEMPLATE = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Event | NuRenaissance</title>
<meta name="description" content="NuRenaissance event details" />
<link rel="canonical" href="https://www.nrnszn.com/event-live" />
<meta name="robots" content="noindex, nofollow" />
<meta property="og:title" content="Event | NuRenaissance" /><meta property="og:description" content="x" /><meta property="og:url" content="https://www.nrnszn.com/event-live" />
<meta property="og:image" content="https://www.nrnszn.com/img/share.jpg" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" /><meta property="og:image:alt" content="alt" />
<meta name="twitter:image" content="https://www.nrnszn.com/img/share.jpg" /><meta name="twitter:description" content="x" /></head><body><main id="evp"></main></body></html>`;
const ev = (o = {}) => ({ id: 'a1b2c3d4e5f6', title: 'Spring Showcase', day: '2099-04-04', time: '7 PM', where: 'HOME Studios', details: 'Doors at 6.\nBe early.', tickets: 'https://www.nrnszn.com/support', video: '', watch: '', flyer: '', ...o });

test('web addresses: readable, safe, and the id at the end identifies an admin event', () => {
  assert.equal(slugify('Certified Lounge · Fall 2026'), 'certified-lounge-fall-2026'); assert.equal(slugify("Nicólas & Friends: 'Live'!"), 'nicolas-and-friends-live'); assert.equal(slugify('  '), 'event'); assert.equal(slugify('<script>'), 'script');
  assert.ok(slugify('x'.repeat(200)).length <= 60);
  assert.equal(eventSlug(ev()), 'spring-showcase-a1b2c3d4e5f6'); assert.equal(idFromSlug('spring-showcase-a1b2c3d4e5f6'), 'a1b2c3d4e5f6'); assert.equal(idFromSlug('renamed-title-a1b2c3d4e5f6'), 'a1b2c3d4e5f6', 'a renamed event keeps its id');
  for (const bad of ['', 'spring', '2026-10-17-certified-lounge-fall-2026', 'x-A1B2C3D4E5F6', 'x-a1b2c3d4e5f', 'x-a1b2c3d4e5f67', null]) assert.equal(idFromSlug(bad), '', String(bad));
  assert.equal(staticSlug({ day: '2026-10-17', title: 'Certified Lounge · Fall 2026' }), '2026-10-17-certified-lounge-fall-2026');
  assert.equal(niceWhen('2099-04-04', '7 PM'), 'Sat, Apr 4, 2099 · 7 PM'); assert.equal(niceWhen('2099-04-04', ''), 'Sat, Apr 4, 2099'); assert.equal(niceWhen('bad', 'x'), 'x');
});

test('the older events all get distinct pages, and none of their addresses can be mistaken for an admin event', () => {
  const slugs = pastEvents.map(staticSlug); assert.equal(new Set(slugs).size, pastEvents.length);
  for (const s of slugs) { assert.match(s, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/); assert.equal(idFromSlug(s), '', s); }
});

test('the page for an admin event: title, description, address, share picture and a JSON copy are filled in, and the "hide from search" tag is removed', () => {
  const html = renderEventPage(TEMPLATE, ev({ flyer: 'f1f1f1f1f1f1' }), 'https://www.nrnszn.com');
  assert.match(html, /<title>Spring Showcase \| NuRenaissance<\/title>/); assert.match(html, /<meta name="description" content="Doors at 6\. Be early\." \/>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.nrnszn\.com\/events\/spring-showcase-a1b2c3d4e5f6\/" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.nrnszn\.com\/api\/flyer\?id=f1f1f1f1f1f1&amp;size=900" \/>/); assert.ok(!html.includes('og:image:width'), 'the old picture size is dropped');
  assert.ok(!/name="robots"/.test(html), 'a real event is not hidden from search');
  const json = /<script type="application\/json" id="event-data">([\s\S]*?)<\/script>/.exec(html)[1]; assert.equal(JSON.parse(json).title, 'Spring Showcase');
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.deepEqual([ld['@type'], ld.name, ld.startDate, ld.location.name, ld.offers.url], ['Event', 'Spring Showcase', '2099-04-04', 'HOME Studios', 'https://www.nrnszn.com/support']);
});

test('nothing typed in /admin can break out of the page: tags, quotes, "</script>" and special characters stay words', () => {
  const nasty = ev({ title: '<script>window.__x=1</script>"><img src=x onerror=alert(1)> &  ', details: '</script><script>window.__y=1</script>\n<b>bold</b>', where: '"><svg onload=alert(1)>', tickets: 'https://x.com/?a=1&b="2"' });
  const html = renderEventPage(TEMPLATE, nasty, 'https://www.nrnszn.com');
  assert.ok(!html.includes('<script>window.__x') && !html.includes('<script>window.__y') && !html.includes('<img src=x') && !html.includes('<svg onload'), 'raw markup got into the page');
  assert.equal((html.match(/<script/g) || []).length, 2, 'only our two script tags exist (JSON-LD and the event data)');
  const data = JSON.parse(/<script type="application\/json" id="event-data">([\s\S]*?)<\/script>/.exec(html)[1]); assert.equal(data.title, nasty.title, 'the event data round-trips exactly'); assert.equal(data.details, nasty.details);
  const head = html.slice(0, html.indexOf('</head>')); assert.ok(!head.includes('"><img') && !head.includes('onerror=alert(1)>'), 'attributes stay closed');
});

test('search data only offers tickets for real https links, and the page works with no flyer', () => {
  assert.equal(eventJsonLd(ev({ tickets: 'javascript:alert(1)' }), 'u', '').offers, undefined); assert.equal(eventJsonLd(ev({ tickets: '' }), 'u', '').offers, undefined); assert.equal(eventJsonLd(ev(), 'u', '').image, undefined);
  assert.match(renderEventPage(TEMPLATE, ev(), 'https://www.nrnszn.com'), /og:image" content="https:\/\/www\.nrnszn\.com\/img\/share\.jpg"/);
});

// ---- the function that serves /events/<slug>/ ----
async function serve(slug, { db, hasTemplate = true, templateOk = true, assets } = {}) {
  let nextCalled = false;
  const env = { ...(db ? { DB: db } : {}), ASSETS: assets || { fetch: async () => (hasTemplate ? new Response(templateOk ? TEMPLATE : 'nope', { status: templateOk ? 200 : 500 }) : (() => { throw new Error('no assets'); })()) } };
  const res = await onRequestGet({ request: new Request(`https://www.nrnszn.com/events/${slug}/`), env, params: { slug }, next: async () => { nextCalled = true; return new Response('static or 404', { status: 404 }); } });
  return { res, nextCalled };
}

test('the function serves a published admin event, redirects an old name to the new one, and passes everything else on untouched', async () => {
  const db = fakeD1(), { id } = await saveEvent(db, { title: 'Spring Showcase', day: '2099-04-04', published: true }), hidden = await saveEvent(db, { title: 'Draft Night', day: '2099-05-05', published: false });
  const ok = await serve(`spring-showcase-${id}`, { db }); assert.equal(ok.res.status, 200); assert.match(ok.res.headers.get('content-type'), /text\/html/); assert.match(await ok.res.text(), /<title>Spring Showcase \| NuRenaissance<\/title>/); assert.equal(ok.nextCalled, false);
  const moved = await serve(`old-name-${id}`, { db }); assert.equal(moved.res.status, 301); assert.equal(moved.res.headers.get('location'), `https://www.nrnszn.com/events/spring-showcase-${id}/`);
  for (const [name, args] of [['an unpublished event', [`draft-night-${hidden.id}`, { db }]], ['an unknown id', ['nothing-aaaaaaaaaaaa', { db }]], ['an older (built) event', ['2026-10-17-certified-lounge-fall-2026', { db }]], ['no database', [`spring-showcase-${id}`, {}]], ['the template missing', [`spring-showcase-${id}`, { db, templateOk: false }]], ['assets throwing', [`spring-showcase-${id}`, { db, hasTemplate: false }]]]) {
    const r = await serve(...args); assert.equal(r.nextCalled, true, name);
  }
});
