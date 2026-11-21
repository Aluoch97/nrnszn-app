// The Apps page: every card opens its app, and "Add to Home Screen" shows the steps for this phone with a link to the
// app's own address (a Home Screen icon opens the address it was added from).
import { test, expect, devices } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and one desktop size');
const IPHONE = devices['iPhone 13'].userAgent;
const ANDROID = devices['Pixel 7'].userAgent;
const INSTAGRAM = `${IPHONE} Instagram 300.0`;

test('each app card opens the app and has an Add to Home Screen button', async ({ page }, info) => {
  only(info);
  await page.goto('/apps/');
  const cards = page.locator('.app');
  await expect(cards).toHaveCount(5);
  await expect(page.locator('.app-open', { hasText: 'Open Certified' })).toHaveAttribute('href', '/play');
  await expect(page.locator('.app-add')).toHaveCount(5);
  await expect(page.locator('.app-open', { hasText: 'Open NuRenaissance' })).toHaveAttribute('href', '/');
  expect(await page.locator('.app-add').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.home))).toEqual([
    'https://www.nrnszn.com/', 'https://play.nrnszn.com/?install=1', 'https://directory.nrnszn.com/', 'https://luoh.nrnszn.com/', 'https://soulnicolas.com/',
  ]);
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: IPHONE });
  test('the sheet shows the Share steps and opens the app at its own address', async ({ page }, info) => {
    only(info);
    await page.goto('/apps/');
    await page.locator('.app-add').nth(2).click();
    const dlg = page.locator('#a2hs');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.a2hs-title')).toHaveText('Add NuDirectory to your Home Screen');
    await expect(dlg.locator('[data-os="ios"]')).toBeVisible(); await expect(dlg.locator('[data-os="ios"]')).toContainText('Add to Home Screen');
    await expect(dlg.locator('[data-os="android"]')).toBeHidden(); await expect(dlg.locator('[data-os="inapp"]')).toBeHidden();
    await expect(dlg.locator('#a2hs-go')).toHaveAttribute('href', 'https://directory.nrnszn.com/'); await expect(dlg.locator('#a2hs-go')).toHaveText(/Open NuDirectory/);
    const serious = (await new AxeBuilder({ page }).include('#a2hs').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
    expect(serious).toEqual([]);
    await dlg.locator('[data-close]').click(); await expect(dlg).toBeHidden();
  });
});

test.describe('on Android', () => {
  test.use({ userAgent: ANDROID });
  test('Certified gets the one-tap Install steps; the others the menu steps', async ({ page }, info) => {
    only(info);
    await page.goto('/apps/');
    const dlg = page.locator('#a2hs');
    await page.locator('.app-add').nth(1).click();
    await expect(dlg.locator('[data-os="android-onetap"]')).toBeVisible(); await expect(dlg.locator('[data-os="android"]')).toBeHidden();
    await expect(dlg.locator('#a2hs-go')).toHaveAttribute('href', 'https://play.nrnszn.com/?install=1');
    await dlg.locator('[data-close]').click();
    await page.locator('.app-add').nth(3).click();
    await expect(dlg.locator('.a2hs-title')).toHaveText('Add luoh to your Home Screen');
    await expect(dlg.locator('[data-os="android"]')).toBeVisible(); await expect(dlg.locator('#a2hs-desktop')).toBeHidden();   // luoh works on phones now
  });
});

test.describe('inside Instagram', () => {
  test.use({ userAgent: INSTAGRAM });
  test('it says to open the page in a real browser first', async ({ page }, info) => {
    only(info);
    await page.goto('/apps/');
    await page.locator('.app-add').nth(1).click();
    await expect(page.locator('#a2hs [data-os="inapp"]')).toBeVisible();
  });
});

test('on a computer the sheet gives the phone and computer steps', async ({ page }, info) => {
  only(info);
  await page.goto('/apps/');
  await page.locator('.app-add').last().click();
  await expect(page.locator('#a2hs [data-os="other"]')).toBeVisible();
  await expect(page.locator('#a2hs-go')).toHaveAttribute('href', 'https://soulnicolas.com/');
});

// ---------- NuRenaissance itself: installed right on this page ----------
test.describe('NuRenaissance on an iPhone', () => {
  test.use({ userAgent: IPHONE });
  test('its sheet shows the Share steps for this page and no Open button', async ({ page }, info) => {
    only(info);
    await page.goto('/apps/');
    await page.locator('.app-add').first().click();
    const dlg = page.locator('#a2hs');
    await expect(dlg.locator('.a2hs-title')).toHaveText('Add NuRenaissance to your Home Screen');
    await expect(dlg.locator('[data-os="ios-self"]')).toBeVisible(); await expect(dlg.locator('[data-os="ios"]')).toBeHidden();
    await expect(dlg.locator('#a2hs-go')).toBeHidden(); await expect(dlg.locator('#a2hs-install')).toBeHidden();
  });
});

test.describe('NuRenaissance on Android', () => {
  test.use({ userAgent: ANDROID });
  test('when Chrome offers it, one tap on Install installs the site', async ({ page }, info) => {
    only(info);
    await page.goto('/apps/');
    const dlg = page.locator('#a2hs');
    await page.locator('.app-add').first().click();
    await expect(dlg.locator('[data-os="android-self"]')).toBeVisible(); await expect(dlg.locator('#a2hs-install')).toBeHidden();   // Chrome hasn't offered yet
    await page.evaluate(() => { const e: any = new Event('beforeinstallprompt'); e.prompt = () => { (window as any).__prompted = 1; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); });
    await expect(dlg.locator('#a2hs-install')).toBeVisible(); await expect(dlg.locator('[data-os="android-self"]')).toBeHidden();
    await dlg.locator('#a2hs-install').click();
    expect(await page.evaluate(() => (window as any).__prompted)).toBe(1);
    await expect(dlg).toBeHidden();
  });
});

test('NuRenaissance already on the Home Screen: the sheet says so', async ({ page }, info) => {
  only(info);
  await page.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as any) : mm(q)); });
  await page.goto('/apps/');
  await page.locator('.app-add').first().click();
  await expect(page.locator('#a2hs [data-os="installed"]')).toBeVisible();
});
