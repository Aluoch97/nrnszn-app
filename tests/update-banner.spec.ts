// "A new version is ready. Tap to update." (public/update-banner.js): silent while the version is the same, shows when it changes, and the tap reloads.
import { test, expect } from '@playwright/test';
const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and one desktop size');

async function versions(page: import('@playwright/test').Page) {
  const state = { v: 'nrn-aaaa1111' };
  await page.route('**/version.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: state.v }) }));
  return state;
}
const recheck = (page: import('@playwright/test').Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('no pop-up while the version is the same; a new version shows "Tap to update", and tapping reloads', async ({ page }, info) => {
  only(info);
  const state = await versions(page);
  await page.goto('/about/'); await page.waitForTimeout(500);
  await recheck(page); await page.waitForTimeout(400);
  await expect(page.locator('[data-update-banner]')).toHaveCount(0);
  state.v = 'nrn-bbbb2222';
  await recheck(page);
  const bar = page.locator('[data-update-banner]'); await expect(bar).toBeVisible();
  await expect(bar).toContainText('A new version is ready.');
  const box = await bar.getByRole('button', { name: 'Tap to update' }).boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await Promise.all([page.waitForURL(/[?&]r=\d+/), bar.getByRole('button', { name: 'Tap to update' }).click()]);
});

test('"×" hides it, and a broken /version.json never shows anything or breaks the page', async ({ page }, info) => {
  only(info);
  const state = await versions(page); const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/about/'); await page.waitForTimeout(500);
  state.v = 'nrn-cccc3333'; await recheck(page);
  await page.getByRole('button', { name: 'Not now' }).click(); await expect(page.locator('[data-update-banner]')).toHaveCount(0);
  await page.unroute('**/version.json'); await page.route('**/version.json', (r) => r.abort());
  await recheck(page); await page.waitForTimeout(400);
  expect(errors).toEqual([]);
});

test('never shown on /admin', async ({ page }, info) => {
  only(info);
  const state = await versions(page);
  await page.goto('/admin/'); await page.waitForTimeout(500); state.v = 'nrn-dddd4444'; await recheck(page); await page.waitForTimeout(400);
  await expect(page.locator('[data-update-banner]')).toHaveCount(0);
});
