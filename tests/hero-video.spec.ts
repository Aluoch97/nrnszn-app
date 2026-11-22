// Page videos: /admin > Page videos makes a real video on this device (mediabunny) and uploads three files; a page with a
// video fades it in over its pictures. The real /api is not in the test server, so it is faked here.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

// clip.mp4 has a second (thumbnail) video track, like DJI and some phone files, which the upload must leave out.
const CLIP = fs.readFileSync(new URL('./fixtures/clip.mp4', import.meta.url));
const tracks = (b: Buffer) => { let n = 0, i = -1; while ((i = b.indexOf('trak', i + 1)) !== -1) n++; return n; };
const TOKEN = 'fake-session-token';
// a tiny real JPEG (1x1) for the still picture
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fakeAdmin(page: Page) {
  const st = { puts: [] as { q: string; size: number; head: number[]; tracks: number }[], sets: [] as any[], removes: [] as any[], frames: [] as any[], videos: { media: { v: 'oldone12', at: Date.UTC(2026, 10, 1) } } as Record<string, any> };
  await page.addInitScript((t) => { try { localStorage.setItem('nrn_admin', t); } catch { /* ignore */ } }, TOKEN);
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/hero') {
      if (req.headers()['authorization'] !== `Bearer ${TOKEN}`) return route.fulfill(json({ ok: false }, 401));
      if (req.method() === 'PUT') { const b = req.postDataBuffer() || Buffer.alloc(0); st.puts.push({ q: url.search, size: b.length, head: [...b.subarray(0, 8)], tracks: tracks(b) }); return route.fulfill(json({ ok: true })); }
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'list') return route.fulfill(json({ ok: true, videos: st.videos }));
      if (b.action === 'set') { st.sets.push(b); st.videos[b.page] = { v: b.v, at: Date.now() }; return route.fulfill(json({ ok: true })); }
      if (b.action === 'frame') { st.frames.push(b); st.videos[b.page].frame = b.frame; return route.fulfill(json({ ok: true, frame: b.frame })); }
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
  await expect(page.locator('#hv-framing')).toBeVisible();
  await expect(page.locator('#hv-auto-t')).not.toHaveText(/Looking|^$/, { timeout: 20_000 });   // the automatic placement is done
  const autoX = Number(await page.locator('#hv-x').inputValue());
  await page.locator('#hv-y').fill('20'); await page.locator('#hv-z').fill('1.5');
  await expect(page.locator('#hv-y-t')).toContainText('top');
  expect(await page.locator('#hv-box-desk video').evaluate((v) => [v.style.objectPosition, v.style.transform])).toEqual([`${autoX}% 20%`, 'scale(1.5)']);
  await page.selectOption('#hv-len', '8');
  const serious = (await new AxeBuilder({ page }).include('details[data-folder="videos"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious).toEqual([]);
  await page.click('#hv-save');
  await expect(page.locator('#hv-msg')).toContainText('Saved', { timeout: 90_000 });
  expect(st.puts.map((p) => new URLSearchParams(p.q).get('part'))).toEqual(['large.mp4', 'small.mp4', 'poster.jpg']);
  for (const p of st.puts.slice(0, 2)) { expect(String.fromCharCode(...p.head.slice(4, 8))).toBe('ftyp'); expect(p.tracks).toBe(1); }   // one picture track, no thumbnail, no sound
  expect(st.puts[2].head.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
  expect(st.puts[0].size).toBeGreaterThan(st.puts[1].size);
  expect(st.sets).toHaveLength(1); expect(st.sets[0].page).toBe('services'); expect(st.sets[0].frame).toEqual({ x: autoX, y: 20, z: 1.5 });
  await expect(rows.filter({ hasText: 'Services' }).locator('.tag')).toHaveText('Video');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // move the video already on Media down, without uploading again
  await page.getByRole('button', { name: 'Adjust the position of the video on Media' }).click();
  await expect(page.locator('#hv-file')).toBeHidden(); await expect(page.locator('#hv-save')).toHaveText('Save position');
  await page.locator('#hv-y').fill('85'); await page.click('#hv-save');
  await expect(page.locator('#hv-msg')).toContainText('Position saved'); expect(st.frames).toEqual([{ action: 'frame', page: 'media', frame: { x: 50, y: 85, z: 1 } }]);
  expect(st.puts).toHaveLength(3);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remove the video on Media' }).click();
  await expect(rows.filter({ hasText: 'Media' }).locator('.tag')).toHaveText('Pictures'); expect(st.removes).toEqual([{ action: 'remove', page: 'media' }]);
});

async function fakePage(page: Page, videos: Record<string, string>, frames: Record<string, any> = {}) {
  await page.route('**/api/hero**', (route) => {
    const url = new URL(route.request().url()), file = url.searchParams.get('file');
    if (!file) return route.fulfill(json({ on: true, videos, frames }));
    if (file.endsWith('.mp4')) return route.fulfill({ status: 200, contentType: 'video/mp4', body: CLIP });
    return route.fulfill({ status: 404, body: '' });
  });
}

test('a page with a video fades it in over its pictures; a page without one is unchanged', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and the computer');
  await fakePage(page, { services: 'abcdef12' }, { services: { x: 30, y: 10, z: 1.2 } });
  await page.goto('/services/');
  const v = page.locator('.ph .ph-bg video.hv');
  await expect(v).toHaveCSS('object-position', '30% 10%');
  await expect(v).toHaveCount(1);
  await expect(v).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => v.evaluate((el: HTMLVideoElement) => el.muted && el.loop && (el.closest('.ph-bg') as HTMLElement).dataset.video)).toBe('playing');
  expect(await v.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');   // never hidden (iPhones may not autoplay a hidden video)
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

test('an iPhone that refuses to start the video (Low Power Mode) still gets the still picture in the header', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'one size');
  await page.addInitScript(() => { HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('not allowed', 'NotAllowedError')); }; });
  await page.route('**/api/hero**', (route) => {
    const url = new URL(route.request().url()), file = url.searchParams.get('file');
    if (!file) return route.fulfill(json({ on: true, videos: { events: 'abcdef12' }, frames: {} }));
    if (file.endsWith('.jpg')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG });
    return route.abort();   // the video itself never arrives / never starts
  });
  await page.goto('/events/');
  const v = page.locator('.ph video.hv');
  await expect.poll(() => v.evaluate((el) => (el.closest('.ph-bg') as HTMLElement).dataset.video)).toBe('on');   // the still shows
  expect(await v.evaluate((el: HTMLVideoElement) => [el.paused, el.hasAttribute('muted'), el.hasAttribute('playsinline'), el.hasAttribute('autoplay'), el.poster.includes('poster.jpg')])).toEqual([true, true, true, true, true]);
});

test('a new video is placed on the action by itself (here: a box moving in the top-left corner)', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'one size');
  await fakeAdmin(page);
  await page.goto('/admin/');
  await page.locator('details[data-folder="videos"] > summary').click();
  await page.getByRole('button', { name: 'Add a video for Events' }).click();
  await page.setInputFiles('#hv-file', { name: 'action.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(new URL('./fixtures/action.mp4', import.meta.url)) });
  await expect(page.locator('#hv-auto-t')).toContainText('Placed on the action', { timeout: 20_000 });
  const x = Number(await page.locator('#hv-x').inputValue()), y = Number(await page.locator('#hv-y').inputValue());
  expect(x).toBeLessThan(35); expect(y).toBeLessThan(40);
  expect(await page.locator('#hv-box-phone video').evaluate((v) => v.style.objectPosition)).toBe(`${x}% ${y}%`);
});
