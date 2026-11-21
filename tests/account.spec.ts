// /account: the one NuRenaissance account. The real /api is not in the test server, so every answer is faked here.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-320' && info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'two phones and one desktop size');
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const PROJECTS = [
  { id: 'a1', title: 'Music video: <b>SIN CITY</b>', service: 'Music video', status: 'in-progress', statusLabel: 'In progress', total: 120000, paid: 40000, balance: 80000, due: '2026-12-15', note: 'Rough cut next week.', link: 'https://drive.google.com/x', payments: [{ id: 'p1', amount: 40000, method: 'cash-app', paidOn: '2026-11-02', note: 'Deposit' }] },
  { id: 'a2', title: 'Event photos', service: 'Photography', status: 'done', statusLabel: 'Done', total: 30000, paid: 30000, balance: 0, due: '', note: '', link: '', payments: [] },
];

async function fake(page: Page, opts: { on?: boolean; user?: boolean; email?: boolean } = {}) {
  const state = { mails: [] as any[], signedIn: !!opts.user, logouts: 0 };
  await page.route('**/api/account/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/account/', '');
    if (path === 'me') return route.fulfill(json({ on: opts.on !== false, google: false, email: opts.email !== false, clientId: '', user: state.signedIn ? { email: 'client@example.com', name: 'Jo Client', since: 1 } : null, ...(state.signedIn ? { projects: PROJECTS, payments: [{ amount: 40000, currency: 'usd', what: 'Music video', at: Date.UTC(2026, 10, 2) }], payLink: 'https://buy.stripe.com/test_link' } : {}) }));
    if (path === 'email') { state.mails.push(JSON.parse(req.postData() || '{}')); return route.fulfill(json({ ok: true, sent: true })); }
    if (path === 'logout') { state.signedIn = false; state.logouts++; return route.fulfill(json({ ok: true })); }
    return route.fulfill(json({ ok: false }, 404));
  });
  return state;
}

test('not switched on yet: it says so, no sign-in form', async ({ page }, info) => {
  only(info); await fake(page, { on: false });
  await page.goto('/account/');
  await expect(page.locator('#acct-off')).toBeVisible(); await expect(page.locator('#mail-form')).toBeHidden();
});

test('signed out: the e-mail link form sends a link and keeps where to go back to', async ({ page }, info) => {
  only(info); const st = await fake(page);
  await page.goto('/account/?return=' + encodeURIComponent('https://play.nrnszn.com/'));
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#mail-form')).toBeVisible(); await expect(page.locator('#g-wrap')).toBeHidden();   // no Google client id in this fake
  await page.fill('#mail', 'fan@example.com'); await page.click('#mail-go');
  await expect(page.locator('#mail-sent')).toContainText('fan@example.com');
  expect(st.mails).toEqual([{ email: 'fan@example.com', return: 'https://play.nrnszn.com/' }]);
  const serious = (await new AxeBuilder({ page }).include('.acct').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious).toEqual([]);
});

test('an old or used link says so', async ({ page }, info) => {
  only(info); await fake(page);
  await page.goto('/account/?expired=1');
  await expect(page.locator('#acct-msg')).toContainText('expired');
});

test('signed in: name, projects with total / paid / balance (drawn as text), the apps, and sign out of every app', async ({ page }, info) => {
  only(info); const st = await fake(page, { user: true });
  await page.goto('/account/');
  await expect(page.locator('#me-name')).toHaveText('Jo Client'); await expect(page.locator('#me-email')).toHaveText('client@example.com');
  const cards = page.locator('.proj'); await expect(cards).toHaveCount(2);
  await expect(cards.first().locator('h3')).toHaveText('Music video: <b>SIN CITY</b>');   // text, not HTML
  await expect(cards.first().locator('.nums')).toContainText('$1,200'); await expect(cards.first().locator('.nums')).toContainText('$400'); await expect(cards.first().locator('.owe dd')).toHaveText('$800');
  await expect(cards.first().locator('.chip')).toHaveText('In progress');
  await expect(cards.first().locator('a', { hasText: 'Open the files' })).toHaveAttribute('rel', /noopener/);
  await expect(cards.nth(1).locator('a', { hasText: 'Pay by card' })).toHaveCount(0);
  const pay = cards.first().locator('a', { hasText: 'Pay by card' });
  await expect(pay).toHaveAttribute('href', 'https://buy.stripe.com/test_link?prefilled_email=client%40example.com&client_reference_id=a1');
  await expect(cards.first().locator('a', { hasText: 'Other ways to pay' })).toHaveAttribute('href', '/support');
  await expect(page.locator('#pay-wrap')).toBeVisible(); await expect(page.locator('#pay-list .pay')).toHaveCount(1); await expect(page.locator('#pay-list')).toContainText('$400');
  await expect(page.locator('.apps a')).toHaveCount(4);
  await expect(page.locator('.apps a', { hasText: 'Soul Vault' })).toHaveAttribute('href', '/api/account/connect?return=' + encodeURIComponent('https://soulnicolas.com/'));
  // fits the phone, tap targets, accessibility
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const b of await page.locator('.acct a.btn, .acct button.btn, .apps a').all()) { const box = await b.boundingBox(); if (box && box.width) expect(box.height).toBeGreaterThanOrEqual(44); }
  const serious = (await new AxeBuilder({ page }).include('.acct').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious).toEqual([]);
  await page.click('#sign-out');
  await expect(page.locator('#mail-form')).toBeVisible(); expect(st.logouts).toBe(1);
});

test('already signed in and sent here by an app: it goes straight on through the connect step', async ({ page }, info) => {
  only(info); await fake(page, { user: true });
  let hop = '';
  await page.route('**/api/account/connect**', (route) => { hop = route.request().url(); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>back</title>' }); });
  await page.goto('/account/?return=' + encodeURIComponent('https://soulnicolas.com/'));
  await expect.poll(() => hop).toContain('/api/account/connect?return=' + encodeURIComponent('https://soulnicolas.com/'));
});
