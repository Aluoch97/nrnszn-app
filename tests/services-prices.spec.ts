// The Services calculator honours the sheet's minimums: web design starts at its minimum pages (MinHours column), livestream at its
// minimum hours. The feed is faked here.
import { test, expect } from '@playwright/test';

const svc = (o: Record<string, unknown>) => ({ icon: 'code', tag: '', description: '', clicks: 1, hourlyRate: 0, facilityHourlyRate: 0, minHours: 1, pageRate: 0, deposit: 50, depositCredited: true, musicVideoDeposit: 0, tiers: [], startingPrice: 0, mostBooked: false, ...o });
const FEED = { source: 'sheet', bundles: [], services: [
  svc({ id: 'web', name: 'Web design', pricingModel: 'per_page', pageRate: 200, minHours: 3, startingPrice: 250 }),
  svc({ id: 'live', name: 'Livestream', icon: 'broadcast', pricingModel: 'hourly', hourlyRate: 175, minHours: 2, startingPrice: 400 }),
  svc({ id: 'video', name: 'Video production', icon: 'video', pricingModel: 'hourly_plus_edit', hourlyRate: 60, minHours: 2, startingPrice: 270 }),
] };

test('web design starts at 3 pages ($600, the deposit is part of it) and livestream at 2 hours ($350)', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'one size');
  await page.route('**/api/feed/services**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) }));
  await page.route('**/script.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) }));
  await page.goto('/services/');
  const web = page.locator('.nrn-card[data-id="web"]'), live = page.locator('.nrn-card[data-id="live"]');
  await expect(web).toContainText('$600+'); await expect(live).toContainText('$350+');
  await web.click();
  await expect(page.locator('#nrn-pages-web')).toHaveValue('3'); await expect(page.locator('#nrn-pages-web')).toHaveAttribute('min', '3');
  await expect(web).toContainText('3 page(s) @ $200/page: $600');
  await page.fill('#nrn-pages-web', '1'); await page.locator('#nrn-pages-web').dispatchEvent('change');
  await expect(page.locator('#nrn-pages-web')).toHaveValue('3');   // cannot go under the minimum
});

test('each kind of video has its own price; the $50 deposit is part of the total, never added on top', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'one size');
  await page.route('**/api/feed/services**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) }));
  await page.route('**/script.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) }));
  await page.goto('/services/');
  const card = page.locator('.nrn-card[data-id="video"]');
  await expect(card).toContainText('$500+');   // the cheapest kind: a podcast episode
  await card.click();
  const pick = async (type: string) => { await card.locator(`[data-field="videoType"][data-value="${type}"]`).click(); };
  const total = () => card.locator('.nrn-config-total');
  for (const [type, t] of [['music', '$900'], ['podcast', '$500'], ['recap', '$750'], ['promo', '$700'], ['interview', '$600'], ['raisethebar', '$150']] as const) {
    await pick(type); await expect(total()).toHaveText(`Total: ${t}`);
  }
  await card.locator('[data-field="vertical"]').click(); await expect(total()).toHaveText('Total: $200');
  await expect(card).toContainText('Vertical cut for Reels/TikTok: $50');
  await pick('podcast'); await expect(card).toContainText('Episode length');
  await card.locator('[data-field="tierIndex"][data-value="2"]').click(); await expect(total()).toHaveText('Total: $700');   // over 60 min
  await pick('music');
  await expect(card).toContainText('$50 deposit to book (part of this total)'); await expect(total()).toHaveText('Total: $900');
  await expect(card.locator('.nrn-deposit-note')).toContainText('part of this total');
});
