// The page-view counter script (public/hit.js): what it sends, and when it stays silent. The real /api is not available here, so it is faked.
import { test, expect, type Page } from '@playwright/test';

async function watch(page: Page) {
  const hits: any[] = [];
  await page.route('**/api/hit', async (route) => { hits.push({ body: JSON.parse(route.request().postData() || '{}'), type: route.request().headers()['content-type'] }); await route.fulfill({ status: 204 }); });
  return hits;
}
const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and one desktop size');

test('a normal visit sends one page view: the page, where you came from and your screen width, and nothing else', async ({ page }, info) => {
  only(info);
  const hits = await watch(page);
  await page.goto('/events/?utm=1#top');
  await expect.poll(() => hits.length).toBe(1);
  expect(Object.keys(hits[0].body).sort()).toEqual(['p', 'r', 'w']); expect(hits[0].body.p).toBe('/events/'); expect(hits[0].body.w).toBe(info.project.name === 'phone-390' ? 390 : 1280);
});

test('it stays silent for Do Not Track, Global Privacy Control, the owner signed in on this device, and the /admin pages', async ({ page, browser }, info) => {
  only(info);
  const hits = await watch(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { value: '1' }));
  await page.goto('/about/'); await page.waitForTimeout(1200); expect(hits, 'Do Not Track').toEqual([]);
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage(); const h2 = await watch(p2);
  await p2.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
  await p2.goto('/about/'); await p2.waitForTimeout(1200); expect(h2, 'Global Privacy Control').toEqual([]);
  const ctx3 = await browser.newContext(); const p3 = await ctx3.newPage(); const h3 = await watch(p3);
  await p3.addInitScript(() => localStorage.setItem('nrn_admin', 'token'));
  await p3.goto('/about/'); await p3.waitForTimeout(1200); expect(h3, 'the signed-in owner').toEqual([]);
  const ctx4 = await browser.newContext(); const p4 = await ctx4.newPage(); const h4 = await watch(p4);
  await p4.goto('/admin/'); await p4.waitForTimeout(1200); expect(h4, 'the admin page itself').toEqual([]);
  await Promise.all([ctx2.close(), ctx3.close(), ctx4.close()]);
});

test('a failing counter never breaks the page', async ({ page }, info) => {
  only(info);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/hit', (r) => r.abort());
  await page.goto('/about/'); await page.waitForTimeout(800);
  expect(errors).toEqual([]); await expect(page.locator('h1')).toBeVisible();
});
