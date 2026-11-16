// Each event has its own page. The older events' pages are built with the site; an admin event's page is made from the built template
// (/event-live/) by functions/events/[slug].js, which is run here for real and served through a fake route.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { renderEventPage } from '../src/edge/eventpage.js';

test.use({ serviceWorkers: 'block' });   // the page's service worker would answer before the test's fake route
const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and one desktop size');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const template = () => readFileSync('dist/event-live/index.html', 'utf8');
const ev = (o: Record<string, unknown> = {}) => ({ id: 'a1b2c3d4e5f6', title: 'Spring Showcase', day: '2099-04-04', time: '7 PM', where: 'HOME Studios', details: 'Doors at 6.\nBe early.', tickets: 'https://www.nrnszn.com/support', video: '', watch: '', flyer: 'f1f1f1f1f1f1', ...o });
async function serveEvent(page: import('@playwright/test').Page, e: ReturnType<typeof ev>) {
  const slug = `${String(e.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${e.id}`;
  await page.route(`**/events/${slug}/`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: renderEventPage(template(), e, 'http://localhost:4322') }));
  await page.route('**/api/flyer**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  return `/events/${slug}/`;
}

test('an older event has its own page: title, date, place, flyer, the story and the recap link', async ({ page }, info) => {
  only(info);
  await page.goto('/events/2026-10-17-certified-lounge-fall-2026/');
  await expect(page.locator('h1')).toHaveText('Certified Lounge · Fall 2026');
  await expect(page.locator('.evp-when')).toContainText('Oct 17, 2026'); await expect(page.locator('.evp-where')).toContainText('HOME Studios');
  await expect(page.locator('.evp-flyer img')).toBeVisible(); await expect(page.locator('.evp-text')).toContainText('Certified is back');
  await expect(page.locator('.evp-btn', { hasText: 'Watch the recap' })).toHaveAttribute('href', '#recap');   // played on the page (see the recap tests)
  await expect(page.locator('.evp-note')).toContainText('has passed');
  await expect(page.locator('a', { hasText: 'All events' })).toHaveAttribute('href', '/events');
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://www.nrnszn.com/events/2026-10-17-certified-lounge-fall-2026');
  expect(await page.locator('meta[name="robots"]').count(), 'it can be found in search').toBe(0);
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() || '{}'); expect([ld['@type'], ld.startDate]).toEqual(['Event', '2026-10-17']);
  expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toContain('/img/events/certified-lounge-fall-2026.webp');
});

test('the events list links to every older event page', async ({ page }, info) => {
  only(info);
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events: [] }) }));
  await page.goto('/events/');
  const hrefs = await page.locator('#ev-past a.ev-tile-btn').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
  expect(hrefs.length).toBe(6); for (const h of hrefs) expect(h).toMatch(/^\/events\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\/$/);
  for (const h of hrefs) { const r = await page.request.get(h); expect(r.status(), h).toBe(200); }
});

test('an upcoming admin event page: tickets, details, flyer, share tags, and nothing in it can run as code', async ({ page }, info) => {
  only(info);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const e = ev({ title: 'Spring <Showcase> & "Friends"', details: 'Doors at 6.\n</script><script>window.__owned = 1</script>\n<b>bold</b>' });
  const url = await serveEvent(page, e);
  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('Spring <Showcase> & "Friends"');
  await expect(page.locator('#evp-kicker')).toHaveText('Upcoming event'); await expect(page.locator('#evp-when')).toHaveText('Sun, Apr 4, 2099 · 7 PM'.replace('Sun', 'Sat')); await expect(page.locator('#evp-where')).toHaveText('HOME Studios');
  await expect(page.locator('#evp-text p')).toHaveCount(3); await expect(page.locator('#evp-text')).toContainText('<b>bold</b>');
  expect(await page.evaluate(() => (window as any).__owned), 'text from /admin was run as code').toBeUndefined(); expect(await page.locator('#evp-text b').count()).toBe(0);
  await expect(page.locator('.evp-btn', { hasText: 'Get tickets' })).toHaveAttribute('href', 'https://www.nrnszn.com/support');
  await expect(page.locator('#evp-img')).toHaveAttribute('src', /\/api\/flyer\?id=f1f1f1f1f1f1&size=900/); await expect(page.locator('#evp-note')).toBeHidden();
  expect(await page.title()).toBe('Spring <Showcase> & "Friends" | NuRenaissance'); expect(await page.locator('meta[name="robots"]').count()).toBe(0);
  expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toContain('/api/flyer?id=f1f1f1f1f1f1&size=900');
  const ld = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() || '{}'); expect([ld.name, ld.offers.url]).toEqual(['Spring <Showcase> & "Friends"', 'https://www.nrnszn.com/support']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious).toEqual([]); expect(errors).toEqual([]);
});

test('a past admin event page has no ticket button but shows the recap and the site link; unsafe links are dropped', async ({ page }, info) => {
  only(info);
  const url = await serveEvent(page, ev({ title: 'Old Night', id: 'b1b2b3b4b5b6', day: '2020-02-02', video: 'https://www.youtube.com/watch?v=abc', watch: '/cinema', tickets: 'https://www.nrnszn.com/support', flyer: '' }));
  await page.goto(url);
  await expect(page.locator('#evp-kicker')).toHaveText('Past event'); await expect(page.locator('.evp-btn', { hasText: 'Get tickets' })).toHaveCount(0);
  await expect(page.locator('.evp-btn', { hasText: 'Watch the recap' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc'); await expect(page.locator('.evp-btn', { hasText: 'Watch on this site' })).toHaveAttribute('href', '/cinema');
  await expect(page.locator('#evp-flyer')).toBeHidden(); await expect(page.locator('#evp-note')).toContainText('has passed');
  const bad = await serveEvent(page, ev({ title: 'Bad Links', id: 'c1c2c3c4c5c6', video: 'javascript:alert(1)', watch: '//evil.example', tickets: 'javascript:alert(1)', flyer: '' }));
  await page.goto(bad); await expect(page.locator('#evp-actions')).toBeHidden(); await expect(page.locator('#evp-note')).toContainText('Instagram');
});

test('the template page opened directly says the event was not found and stays out of search', async ({ page }, info) => {
  only(info);
  await page.goto('/event-live/');
  await expect(page.locator('h1')).toHaveText('Event not found'); await expect(page.locator('#evp-note')).toContainText('could not find');
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
});

// ---------- The recap played on the page (src/lib/recap.ts) ----------
const VIDEOS = [{ id: 'aaaaaaaaaa1', title: 'Night one', duration: '3:01' }, { id: 'bbbbbbbbbb2', title: 'Night two', duration: '4:02' }, { id: 'cccccccccc3', title: 'Night three' }];
async function fakeYouTube(page: import('@playwright/test').Page, playlist: 'ok' | 'down' = 'ok') {
  await page.route('**/api/playlist?**', (r) => playlist === 'ok'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, title: 'RC', videos: VIDEOS }) })
    : r.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' }));
  await page.route(/i\.ytimg\.com|youtube-nocookie\.com/, (r) => r.request().resourceType() === 'image'
    ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : r.fulfill({ status: 200, contentType: 'text/html', body: '<p>player</p>' }));
}

test('an older event plays its recap playlist right on the page', async ({ page }, info) => {
  only(info);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await fakeYouTube(page);
  await page.goto('/events/2025-11-08-renaissance-certified-fall-2025/#recap');
  const recap = page.locator('#recap');
  await expect(recap).toBeVisible(); await expect(recap.locator('.evp-count')).toHaveText('3 videos'); await expect(recap.locator('.evp-item')).toHaveCount(3);
  await expect(recap.locator('.evp-yt a')).toHaveAttribute('href', /youtube\.com\/playlist\?list=PLVprhlbgSo1tsyRw4KJUxmPhpQNB9BQAq/);
  expect(await recap.evaluate((s) => s.getBoundingClientRect().top), 'arriving on #recap scrolls to it').toBeLessThan(200);
  await expect(page.locator('.evp-frame')).toHaveCount(0);   // the YouTube player waits for a tap
  await recap.locator('.evp-poster').click();
  await expect(page.locator('.evp-frame')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/aaaaaaaaaa1\?autoplay=1.*list=PLVprhlbgSo1tsyRw4KJUxmPhpQNB9BQAq/);
  await recap.locator('.evp-item', { hasText: 'Night three' }).click();
  await expect(page.locator('.evp-frame')).toHaveAttribute('src', /embed\/cccccccccc3\?/); await expect(recap.locator('.evp-now')).toHaveText('Night three');
  await expect(recap.locator('.evp-item[aria-current="true"]')).toHaveText(/Night three/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const serious = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious).toEqual([]); expect(errors).toEqual([]);
});

test('if the playlist list cannot be read, the recap still plays the whole playlist', async ({ page }, info) => {
  only(info);
  await fakeYouTube(page, 'down');
  await page.goto('/events/2025-11-08-renaissance-certified-fall-2025/');
  await expect(page.locator('#recap .evp-list')).toBeHidden();
  await page.locator('#recap .evp-poster').click();
  await expect(page.locator('.evp-frame')).toHaveAttribute('src', /embed\/videoseries\?list=PLVprhlbgSo1tsyRw4KJUxmPhpQNB9BQAq/);
});

test('tapping a flyer on the events list goes straight to its event page (no pop-up)', async ({ page }, info) => {
  only(info);
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events: [] }) }));
  await page.goto('/events/');
  expect(await page.locator('#ev-past dialog').count(), 'no pop-ups left').toBe(0);
  await page.locator('#ev-past a.ev-tile-btn', { hasText: 'Fall 2025' }).click();
  await expect(page).toHaveURL(/\/events\/2025-11-08-renaissance-certified-fall-2025\/$/);
  await expect(page.locator('h1')).toContainText('Fall 2025');
});

test('an admin event with a YouTube playlist plays it on the page; any other recap link opens in a new tab', async ({ page }, info) => {
  only(info);
  await fakeYouTube(page);
  const url = await serveEvent(page, ev({ title: 'Recap Night', id: 'd1d2d3d4d5d6', day: '2020-03-03', tickets: '', flyer: '', video: 'https://youtube.com/playlist?list=PLabcdefghijklmnop&si=xyz' }));
  await page.goto(url);
  await expect(page.locator('.evp-btn', { hasText: 'Watch the recap' })).toHaveAttribute('href', '#recap');
  await expect(page.locator('#recap .evp-item')).toHaveCount(3);
  await page.locator('#recap .evp-poster').click();
  await expect(page.locator('.evp-frame')).toHaveAttribute('src', /embed\/aaaaaaaaaa1\?.*list=PLabcdefghijklmnop/);
  const other = await serveEvent(page, ev({ title: 'Vimeo Night', id: 'e1e2e3e4e5e6', day: '2020-03-03', tickets: '', flyer: '', video: 'https://vimeo.com/12345' }));
  await page.goto(other);
  await expect(page.locator('.evp-btn', { hasText: 'Watch the recap' })).toHaveAttribute('href', 'https://vimeo.com/12345');
  await expect(page.locator('#recap')).toBeHidden();
});
