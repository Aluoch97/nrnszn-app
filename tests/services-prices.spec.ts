// The Services calculator honours the sheet's minimums: web design starts at its minimum pages (MinHours column), livestream at its
// minimum hours. The feed is faked here.
import { test, expect } from '@playwright/test';

const svc = (o: Record<string, unknown>) => ({ icon: 'code', tag: '', description: '', clicks: 1, hourlyRate: 0, facilityHourlyRate: 0, minHours: 1, pageRate: 0, deposit: 50, depositCredited: true, musicVideoDeposit: 0, tiers: [], startingPrice: 0, mostBooked: false, ...o });
const FEED = { source: 'sheet', bundles: [], services: [
  svc({ id: 'web', name: 'Web design', pricingModel: 'per_page', pageRate: 200, minHours: 3, startingPrice: 250 }),
  svc({ id: 'live', name: 'Livestream', icon: 'broadcast', pricingModel: 'hourly', hourlyRate: 175, minHours: 2, startingPrice: 400 }),
] };

test('web design starts at 3 pages ($650 with the deposit) and livestream at 2 hours ($400)', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'one size');
  await page.route('**/api/feed/services**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) }));
  await page.route('**/script.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) }));
  await page.goto('/services/');
  const web = page.locator('.nrn-card[data-id="web"]'), live = page.locator('.nrn-card[data-id="live"]');
  await expect(web).toContainText('$650+'); await expect(live).toContainText('$400+');
  await web.click();
  await expect(page.locator('#nrn-pages-web')).toHaveValue('3'); await expect(page.locator('#nrn-pages-web')).toHaveAttribute('min', '3');
  await expect(web).toContainText('3 page(s) @ $200/page: $600');
  await page.fill('#nrn-pages-web', '1'); await page.locator('#nrn-pages-web').dispatchEvent('change');
  await expect(page.locator('#nrn-pages-web')).toHaveValue('3');   // cannot go under the minimum
});
