// The public Events page with events added in /admin (faked here): upcoming cards, flyer tiles in date order (each a link to its event page), safe text.
import { test, expect } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const events = [
  { id: 'aaaaaaaaaaaa', slug: 'spring-showcase-2099-aaaaaaaaaaaa', title: 'Spring Showcase <i>2099</i>', day: '2099-04-04', time: '7 PM', where: 'HOME Studios', details: 'Doors at 6.\nBe early.', tickets: 'https://www.nrnszn.com/support', video: '', watch: '', flyer: 'f1f1f1f1f1f1' },
  { id: 'bbbbbbbbbbbb', slug: 'no-flyer-night-bbbbbbbbbbbb', title: 'No Flyer Night', day: '2099-05-05', time: '', where: '', details: '', tickets: 'javascript:alert(1)', video: '', watch: '//evil.example', flyer: '' },
  { id: 'cccccccccccc', slug: 'mid-2025-show-cccccccccccc', title: 'Mid 2025 Show', day: '2025-06-01', time: '', where: 'The Room', details: 'A past show.', tickets: '', video: 'https://www.youtube.com/watch?v=abc', watch: '/cinema', flyer: 'f2f2f2f2f2f2' },
  { id: 'dddddddddddd', slug: 'plain-old-show-dddddddddddd', title: 'Plain Old Show', day: '2025-01-01', time: '', where: '', details: '', tickets: '', video: '', watch: '', flyer: '' },
];
const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and one desktop size');

test('events from /admin appear: upcoming as cards, past on the flyer wall in date order, text and links made safe', async ({ page }, info) => {
  only(info);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events }) }));
  await page.route('**/api/flyer**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/api/**', (r) => (r.request().url().includes('/api/events') || r.request().url().includes('/api/flyer') ? r.fallback() : r.fulfill({ status: 404, body: '' })));
  await page.goto('/events/');
  const cards = page.locator('#ev-more .ev-dyn-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Spring Showcase <i>2099</i>'); expect(await page.locator('#ev-more i:not(.x)').count(), 'a title with markup in it is shown as words').toBe(0);
  await expect(cards.nth(0)).toContainText('Doors at 6.'); await expect(cards.nth(0).locator('a', { hasText: 'Get tickets' })).toHaveAttribute('href', 'https://www.nrnszn.com/support');
  await expect(cards.nth(1)).toContainText('No Flyer Night');
  await expect(cards.nth(0).locator('a', { hasText: 'Details & tickets' })).toHaveAttribute('href', '/events/spring-showcase-2099-aaaaaaaaaaaa/');
  expect(await cards.nth(1).locator('a').count(), 'only the details link: a javascript: tickets link and a //other-site watch link are dropped').toBe(1);
  await expect(cards.nth(1).locator('a')).toHaveAttribute('href', '/events/no-flyer-night-bbbbbbbbbbbb/');
  // past wall: static events keep their order, the added ones slot in by date, newest first
  const days = await page.locator('#ev-past > li').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.day));
  expect(days.filter(Boolean)).toEqual([...days.filter(Boolean)].sort().reverse());
  expect(days).toContain('2025-06-01'); expect(days).toContain('2025-01-01');
  expect(days.indexOf('2025-06-01')).toBeLessThan(days.indexOf('2025-01-01'));
  // an added past event with a flyer is a tile that links straight to its event page (no pop-up)
  const tile = page.locator('#ev-past li[data-day="2025-06-01"] a.ev-tile-btn'); await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute('href', '/events/mid-2025-show-cccccccccccc/'); await expect(tile).toContainText('Mid 2025 Show');
  expect(await page.locator('#ev-past dialog').count(), 'no pop-ups').toBe(0);
  await expect(page.locator('#ev-past li[data-day="2025-01-01"]')).toContainText('Plain Old Show');   // no flyer: a plain tile
  await expect(page.locator('#ev-past li[data-day="2025-01-01"] a')).toHaveAttribute('href', '/events/plain-old-show-dddddddddddd/');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); expect(over).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('with no added events (or no database) the page is exactly as before', async ({ page }, info) => {
  only(info);
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events: [] }) }));
  await page.goto('/events/');
  await expect(page.locator('#ev-more .ev-dyn-card')).toHaveCount(0); await expect(page.locator('#ev-past > li').first()).toBeVisible();
  expect(await page.locator('#ev-past > li.ev-dyn').count()).toBe(0);
});

test('offline: the events this phone last saw still show (the page does not go blank when the list cannot load)', async ({ page }, info) => {
  only(info);
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events }) }));
  await page.route('**/api/flyer**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.goto('/events/');
  await expect(page.locator('#ev-more .ev-dyn-card')).toHaveCount(2);
  await page.waitForTimeout(500);   // the copy is saved after the live answer arrives
  await page.unroute('**/api/events');
  await page.route('**/api/events', (r) => r.abort('internetdisconnected'));   // now offline
  await page.goto('/events/');
  await expect(page.locator('#ev-more .ev-dyn-card')).toHaveCount(2);
  await expect(page.locator('#ev-more .ev-dyn-card').first()).toContainText('Spring Showcase');
});

test('a bad answer (an error page, no list) is never saved over the good copy', async ({ page }, info) => {
  only(info);
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events }) }));
  await page.goto('/events/'); await expect(page.locator('#ev-more .ev-dyn-card')).toHaveCount(2); await page.waitForTimeout(500);
  await page.unroute('**/api/events');
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'db down' }) }));
  await page.goto('/events/'); await page.waitForTimeout(500);
  await page.unroute('**/api/events');
  await page.route('**/api/events', (r) => r.abort('internetdisconnected'));
  await page.goto('/events/');
  await expect(page.locator('#ev-more .ev-dyn-card')).toHaveCount(2);
});
