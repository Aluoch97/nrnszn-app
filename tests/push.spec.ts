// Phone notifications in the browser: the footer link (hidden until switched on), the dialog with a pretend phone, and the Send folder in /admin. The real /api is faked.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-320' && info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'phones and desktop');
const KEY = 'B' + 'A'.repeat(86);   // 87 characters: a public key the page can turn into 65 bytes
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fakePhone(page: Page, answer = 'granted') {
  await page.addInitScript((ans) => {
    let subbed: any = null; const perm = { v: 'default' };
    const sub = () => ({ endpoint: 'https://push.test/phone1-abcdefghijkl', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } }; }, async unsubscribe() { subbed = null; (window as any).__unsub = true; return true; } });
    const reg = { pushManager: { async getSubscription() { return subbed; }, async subscribe(o: any) { (window as any).__keyLen = o.applicationServerKey.length; subbed = sub(); return subbed; } }, update: async () => {} };
    Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true });
    Object.defineProperty(window, 'Notification', { value: { get permission() { return perm.v; }, requestPermission: async () => (perm.v = ans) }, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg), getRegistrations: async () => [reg], addEventListener() {} }, configurable: true });
  }, answer);
}
async function fakePush(page: Page, on: boolean) {
  const posts: any[] = [];
  await page.route('**/api/push', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json(on ? { ok: true, on: true, key: KEY } : { ok: true, on: false }));
    posts.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill(json({ ok: true }));
  });
  return posts;
}
const link = (page: Page) => page.locator('footer [data-push-open], .sheet-tools [data-push-open]').first();

test('the footer link stays hidden while notifications are switched off', async ({ page }, info) => {
  only(info); await fakePhone(page); await fakePush(page, false);
  await page.goto('/about/'); await page.waitForTimeout(700);
  await expect(page.locator('[data-push-open]:visible')).toHaveCount(0);
});
test('a visitor turns notifications on and off from the footer; nothing sideways; accessible', async ({ page }, info) => {
  only(info); await fakePhone(page); const posts = await fakePush(page, true);
  await page.goto('/about/');
  const open = info.project.name === 'desktop-1280' ? page.locator('footer [data-push-open]') : page.locator('[data-push-open]:visible').first();
  if (info.project.name !== 'desktop-1280') { const more = page.getByRole('button', { name: /more/i }).first(); if (!(await open.isVisible().catch(() => false))) await more.click({ timeout: 3000 }).catch(() => {}); }
  await expect(open).toBeVisible(); const h = (await open.boundingBox())!.height; expect(h).toBeGreaterThanOrEqual(44);
  await open.click();
  const dlg = page.locator('dialog[open]:has(#push-go)'); await expect(dlg).toBeVisible();
  await expect(dlg.locator('#push-msg')).toContainText('Get a notification on your phone');
  expect((await dlg.locator('#push-go').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const axe = await new AxeBuilder({ page }).include('dialog[open]:has(#push-go)').analyze(); expect(axe.violations.map((v) => v.id + ': ' + v.nodes.length)).toEqual([]);
  await dlg.locator('#push-go').click(); await expect(dlg.locator('#push-msg')).toContainText("You're on");
  expect(await page.evaluate(() => (window as any).__keyLen)).toBe(65);
  expect(posts[0]).toMatchObject({ action: 'subscribe', subscription: { endpoint: expect.stringMatching(/^https:\/\//) } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await dlg.locator('#push-go').click(); await expect(dlg.locator('#push-msg')).toContainText('Get a notification on your phone');
  expect(posts[1]).toMatchObject({ action: 'unsubscribe', endpoint: expect.stringMatching(/^https:\/\//) }); expect(await page.evaluate(() => (window as any).__unsub)).toBe(true);
  await dlg.locator('#push-close').click(); await expect(dlg).toHaveCount(0);
});
test('a "no" from the phone saves nothing', async ({ page }, info) => {
  only(info); await fakePhone(page, 'denied'); const posts = await fakePush(page, true);
  await page.goto('/about/');
  const open = info.project.name === 'desktop-1280' ? page.locator('footer [data-push-open]') : page.locator('[data-push-open]:visible').first();
  if (info.project.name !== 'desktop-1280') { const more = page.getByRole('button', { name: /more/i }).first(); if (!(await open.isVisible().catch(() => false))) await more.click({ timeout: 3000 }).catch(() => {}); }
  await open.click(); await page.locator('dialog[open] #push-go').click(); await expect(page.locator('dialog[open] #push-msg')).toContainText(/blocked|not allowed/i);
  expect(posts).toEqual([]);
});

// ---- /admin: the Phone notifications folder ----
test('/admin: the Send form shows the numbers, asks first, and sends what was written', async ({ page }, info) => {
  only(info); if (info.project.name === 'phone-320') test.skip(true, 'one phone size is enough here');
  const sent: any[] = []; let subscribers = 2, sentToday = 0; page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => localStorage.setItem('nrn_admin', 'fake-session-token'));
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/admin') {
      if (req.method() === 'POST') { const b = JSON.parse(req.postData() || '{}'); if (b.action === 'push-send') { sent.push(b.push); sentToday += 1; return route.fulfill(json({ ok: true, sent: subscribers, failed: 0, removed: 0 })); } return route.fulfill(json({ ok: true })); }
      if (url.searchParams.get('section') === 'push') return route.fulfill(json({ ok: true, on: true, subscribers, sentToday, cap: 3, last: sentToday ? [{ at: Date.now(), title: sent[sent.length - 1].title, body: '', sent: subscribers }] : [] }));
      if (url.searchParams.get('section')) return route.fulfill(json({ ok: true, events: [], days: 30, views: 0, visitors: 0, viewsPerVisitor: 0, previous: { views: 0, visitors: 0 }, daily: [], pages: [], referrers: [], devices: [], places: [], newReturning: {} }));
      return route.fulfill(json({ status: 'ok', mode: 'ready', signedIn: true, setup: [], backup: null }));
    }
    return route.fulfill(json({ ok: false }, 404));
  });
  await page.goto('/admin/'); await page.locator('details[data-folder="push"] summary').click();
  await expect(page.locator('#push-msg')).toContainText('2 phones have notifications on. You have sent 0 of 3');
  await expect(page.locator('#push-send')).toHaveText('Send to 2 phones');
  await page.fill('#push-title', 'New episode'); await page.fill('#push-body', 'Certified Lounge S2E4 is up'); await page.selectOption('#push-url', '/cinema');
  await expect(page.locator('#push-preview')).toContainText('New episode');
  await page.click('#push-send');
  await expect(page.locator('#push-done')).toContainText('Sent to 2 phones'); await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ title: 'New episode', body: 'Certified Lounge S2E4 is up', url: '/cinema' });
});
