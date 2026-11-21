// Page videos: /admin > Page videos makes a real video on this device (mediabunny) and uploads three files; a page with a
// video fades it in over its pictures. The real /api is not in the test server, so it is faked here.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

const CLIP = fs.readFileSync(new URL('./fixtures/clip.mp4', import.meta.url));
const TOKEN = 'fake-session-token';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fakeAdmin(page: Page) {
  const st = { puts: [] as { q: string; size: number; head: number[] }[], sets: [] as any[], removes: [] as any[], videos: { media: { v: 'oldone12', at: Date.UTC(2026, 10, 1) } } as Record<string, any> };
  await page.addInitScript((t) => { try { localStorage.setItem('nrn_admin', t); } catch { /* ignore */ } }, TOKEN);
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/hero') {
      if (req.headers()['authorization'] !== `Bearer ${TOKEN}`) return route.fulfill(json({ ok: false }, 401));
      if (req.method() === 'PUT') { const b = req.postDataBuffer() || Buffer.alloc(0); st.puts.push({ q: url.search, size: b.length, head: [...b.subarray(0, 8)] }); return route.fulfill(json({ ok: true })); }
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'list') return route.fulfill(json({ ok: true, videos: st.videos }));
      if (b.action === 'set') { st.sets.push(b); st.videos[b.page] = { v: b.v, at: Date.now() }; return route.fulfill(json({ ok: true })); }
      if (b.action === 'remove') { st.removes.push(b); delete st.videos[b.page]; return route.fulfill(json({ ok: true })); }
    }
    if (url.pathname === '/api/admin') return route.fulfill(json(req.headers()['authorization'] ? { status: 'ok', mode: 'ready', signedIn: true, setup: [] } : { status: 'ok', mode: 'ready' }));
    return route.fulfill(json({ ok: true, events: [], projects: [], status: 'ok' }));
  });
  return st;
}

test('/admin > Page videos: pick a video, choose the start, and it is made smaller here and uploaded (computer + phone size + still)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280' && info.project.name !== 'phone-390', 'one phone and the computer');
  test.setTimeout(120_000);
  const st = await fakeAdmin(page);
  await page.goto('/admin/');
  await page.locator('details[data-folder="videos"] > summary').click();
  const rows = page.locator('#hv-list .hv-row'); await expect(rows).toHaveCount(7);
  await expect(rows.filter({ hasText: 'Media' }).locator('.tag')).toHaveText('Video');
  await expect(rows.filter({ hasText: 'Services' }).locator('.tag')).toHaveText('Pictures');
  await page.getByRole('button', { name: 'Add a video for Services' }).click();
  await expect(page.locator('#hv-form-title')).toHaveText('Video for Services');
  await page.setInputFiles('#hv-file', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: CLIP });
  await expect(page.locator('#hv-trim')).toBeVisible();
  await page.locator('#hv-start').fill('1');
  await page.selectOption('#hv-len', '8');
  const serious = (await new AxeBuilder({ page }).include('details[data-folder="videos"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious).toEqual([]);
  await page.click('#hv-save');
  await expect(page.locator('#hv-msg')).toContainText('Saved', { timeout: 90_000 });
  expect(st.puts.map((p) => new URLSearchParams(p.q).get('part'))).toEqual(['large.mp4', 'small.mp4', 'poster.jpg']);
  for (const p of st.puts.slice(0, 2)) expect(String.fromCharCode(...p.head.slice(4, 8))).toBe('ftyp');
  expect(st.puts[2].head.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
  expect(st.puts[0].size).toBeGreaterThan(st.puts[1].size);
  expect(st.sets).toHaveLength(1); expect(st.sets[0].page).toBe('services');
  await expect(rows.filter({ hasText: 'Services' }).locator('.tag')).toHaveText('Video');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remove the video on Media' }).click();
  await expect(rows.filter({ hasText: 'Media' }).locator('.tag')).toHaveText('Pictures'); expect(st.removes).toEqual([{ action: 'remove', page: 'media' }]);
});

async function fakePage(page: Page, videos: Record<string, string>) {
  await page.route('**/api/hero**', (route) => {
    const url = new URL(route.request().url()), file = url.searchParams.get('file');
    if (!file) return route.fulfill(json({ on: true, videos }));
    if (file.endsWith('.mp4')) return route.fulfill({ status: 200, contentType: 'video/mp4', body: CLIP });
    return route.fulfill({ status: 404, body: '' });
  });
}

test('a page with a video fades it in over its pictures; a page without one is unchanged', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and the computer');
  await fakePage(page, { services: 'abcdef12' });
  await page.goto('/services/');
  const v = page.locator('.ph .ph-bg video.hv');
  await expect(v).toHaveCount(1);
  await expect(v).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => v.evaluate((el: HTMLVideoElement) => el.muted && el.loop && getComputedStyle(el).opacity)).toBe('1');
  expect(await v.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  await page.goto('/events/');
  await page.waitForTimeout(500);
  await expect(page.locator('.ph video.hv')).toHaveCount(0);
});

test('with less motion asked for, only the still picture shows (nothing plays)', async ({ browser }, info) => {
  test.skip(info.project.name !== 'phone-390', 'one size');
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  await fakePage(page, { media: 'abcdef12' });
  await page.goto('/media/');
  const v = page.locator('.ph video.hv'); await expect(v).toHaveCount(1);
  await page.waitForTimeout(600);
  expect(await v.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  await ctx.close();
});
