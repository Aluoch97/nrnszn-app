// /account: the one NuRenaissance account. The real /api is not in the test server, so every answer is faked here.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-320' && info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'two phones and one desktop size');
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const PROJECTS = [
  { id: 'a1', title: 'Music video: <b>SIN CITY</b>', service: 'Music video', status: 'in-progress', statusLabel: 'In progress', total: 120000, paid: 40000, balance: 80000, due: '2026-12-15', note: 'Rough cut next week.', link: 'https://drive.google.com/x', payments: [{ id: 'p1', amount: 40000, method: 'cash-app', paidOn: '2026-11-02', note: 'Deposit' }] },
  { id: 'a2', title: 'Event photos', service: 'Photography', status: 'done', statusLabel: 'Done', total: 30000, paid: 30000, balance: 0, due: '', note: '', link: '', payments: [] },
];

const SAVED = { vault: [{ kind: 'song', id: 'trk_1', title: 'SIN <i>CITY</i>', url: '/vault/2024-sin-city', at: Date.UTC(2026, 10, 3) }], directory: [{ kind: 'listing', id: 'abc-1', title: 'Open mic at Jo\'s', url: '', at: Date.UTC(2026, 10, 4) }] };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LUOH = { count: 2, recent: [{ id: 'p1', name: 'Lounge recap', at: Date.UTC(2026, 10, 10) }, { id: 'p2', name: 'Music video cut', at: Date.UTC(2026, 10, 1) }] };

// "‹ Your account" only exists on a phone (a computer shows the list beside the page).
const toList = async (page: Page) => { if (await page.locator('#app-back').isVisible()) await page.click('#app-back'); };

async function fake(page: Page, opts: { on?: boolean; user?: boolean; email?: boolean } = {}) {
  const state = { mails: [] as any[], signedIn: !!opts.user, logouts: 0, unsaved: [] as any[], pics: [] as any[], avatar: null as number | null };
  await page.route('**/api/account/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/account/', '');
    if (path === 'me') return route.fulfill(json({ on: opts.on !== false, google: false, email: opts.email !== false, clientId: '', user: state.signedIn ? { email: 'client@example.com', name: 'Jo Client', since: Date.UTC(2026, 10, 1) } : null, ...(state.signedIn ? { projects: PROJECTS, payments: [{ amount: 40000, currency: 'usd', what: 'Music video', at: Date.UTC(2026, 10, 2) }], payLink: 'https://buy.stripe.com/test_link', saved: JSON.parse(JSON.stringify(SAVED)), luoh: LUOH, avatar: state.avatar } : {}) }));
    if (path === 'avatar' && req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') });
    if (path === 'avatar') { const b = JSON.parse(req.postData() || '{}'); state.pics.push(b); state.avatar = b.image ? 1700000000000 : null; return route.fulfill(json({ ok: true, avatar: state.avatar })); }
    if (path === 'passport') return route.fulfill(json({ ok: true, linked: true, stamps: [{ day: '2025-04-26', method: 'game' }, { day: '2025-11-08', method: 'door' }], today: null }));
    if (path === 'listings') return route.fulfill(json({ ok: true, listings: [{ title: 'Jo: <b>Live</b> set', kind: 'Show', status: 'Live', sent: '2026-11-05T12:00:00Z' }, { title: 'New studio', kind: 'Feature', status: 'Waiting for review', sent: '2026-11-20T12:00:00Z' }] }));
    if (path === 'saved') { state.unsaved.push(JSON.parse(req.postData() || '{}')); return route.fulfill(json({ ok: true, on: false })); }
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
  await expect(page.locator('[data-sum="nrn"]')).toHaveText('1 open project · $800 due');
  await page.click('[data-app="nrn"]');
  await expect(page).toHaveURL(/#nrn$/); await expect(page.locator('#app-name')).toHaveText('NuRenaissance');
  await expect(page.locator('#nrn-stats')).toContainText('$800');
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
  // fits the phone, tap targets, accessibility (app page, then the home of the dashboard)
  const check = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const b of await page.locator('.acct a.btn, .acct button.btn, .acct .tile, .acct .back').all()) { const box = await b.boundingBox(); if (box && box.width) expect(box.height).toBeGreaterThanOrEqual(44); }
    const serious = (await new AxeBuilder({ page }).include('.acct').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
    expect(serious).toEqual([]);
  };
  await check();
  await page.goBack(); await expect(page.locator('#dash-home')).toBeVisible(); await expect(page.locator('.tile')).toHaveCount(5);
  if (info.project.name !== 'desktop-1280') await expect(page.locator('[data-app="nrn"]')).toBeFocused();
  await check();
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

test('the dashboard: each app tile shows a summary and opens that app\'s page with its own info (all drawn as text)', async ({ page }, info) => {
  only(info); const st = await fake(page, { user: true });
  await page.goto('/account/');
  await expect(page.locator('[data-sum="certified"]')).toHaveText('2 Passport stamps');
  await expect(page.locator('[data-sum="directory"]')).toHaveText('1 saved · 2 sent');
  await expect(page.locator('[data-sum="vault"]')).toHaveText('1 saved song');
  await expect(page.locator('[data-sum="luoh"]')).toHaveText('2 saved projects');
  await expect(page.locator('#me-since')).toContainText('Member since');

  await page.click('[data-app="certified"]');
  await expect(page.locator('#cert-stats')).toContainText('2'); const stamps = page.locator('.stamp'); await expect(stamps).toHaveCount(2);
  await expect(stamps.first()).toContainText('Renaissance Certified · Fall 2025'); await expect(stamps.first()).toContainText('checked in at the door');
  await expect(page.locator('#app-open')).toHaveAttribute('href', 'https://play.nrnszn.com/?tab=about');
  await toList(page); await expect(page.locator('#dash-home')).toBeVisible();

  await page.click('[data-app="directory"]');
  await expect(page.locator('#dir-mine .row')).toHaveCount(2); await expect(page.locator('#dir-mine .row').first().locator('b')).toHaveText('Jo: <b>Live</b> set');
  await expect(page.locator('#dir-mine .chip').first()).toHaveText('Live');
  await expect(page.locator('#dir-saved a.row-main')).toHaveAttribute('href', 'https://directory.nrnszn.com/?l=abc-1');
  await page.click('#dir-saved .rm');
  await expect(page.locator('#dir-saved .empty')).toBeVisible(); expect(st.unsaved).toEqual([{ app: 'directory', kind: 'listing', id: 'abc-1', on: false }]);
  await toList(page);

  await page.click('[data-app="vault"]');
  await expect(page.locator('#vault-saved a.row-main b')).toHaveText('SIN <i>CITY</i>');
  await expect(page.locator('#vault-saved a.row-main')).toHaveAttribute('href', 'https://soulnicolas.com/vault/2024-sin-city');
  await expect(page.locator('#app-open')).toHaveAttribute('href', '/api/account/connect?return=' + encodeURIComponent('https://soulnicolas.com/'));
  await toList(page);

  await page.click('[data-app="luoh"]');
  await expect(page.locator('#luoh-list .row')).toHaveCount(2); await expect(page.locator('#luoh-list .row').first()).toContainText('Lounge recap');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // a link straight to one app's page works too
  await page.goto('/account/#luoh'); await expect(page.locator('#app-name')).toHaveText('luoh');
});

test('Account settings: upload a profile picture (shrunk to a square JPEG on the device), see it, remove it', async ({ page }, info) => {
  only(info); const st = await fake(page, { user: true });
  await page.goto('/account/');
  await expect(page.locator('#me-initial')).toHaveText('J'); await expect(page.locator('#me-pic')).toBeHidden();
  await page.click('[data-app="settings"]');
  await expect(page.locator('#app-name')).toHaveText('Account settings'); await expect(page.locator('#app-open')).toBeHidden();
  await page.setInputFiles('#pic-in', { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await expect(page.locator('#pic-st')).toContainText('Saved');
  expect(st.pics[0].image).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.locator('#pic-prev')).toBeVisible(); await expect(page.locator('#pic-prev')).toHaveAttribute('src', '/api/account/avatar?v=1700000000000');
  await expect(page.locator('#me-pic')).toHaveAttribute('src', '/api/account/avatar?v=1700000000000'); await expect(page.locator('#me-initial')).toBeHidden();
  await page.click('#pic-rm');
  await expect(page.locator('#pic-prev')).toBeHidden(); await expect(page.locator('#me-pic')).toHaveAttribute('hidden', ''); expect(st.pics[1]).toEqual({ image: null });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const serious = (await new AxeBuilder({ page }).include('.acct').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  expect(serious).toEqual([]);
});

test('on a computer the list and the page sit side by side; picking an app swaps the right side', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'computer only'); await fake(page, { user: true });
  await page.goto('/account/');
  await expect(page.locator('#dash-home')).toBeVisible(); await expect(page.locator('#dash-app')).toBeVisible();
  await expect(page.locator('#app-name')).toHaveText('NuRenaissance'); await expect(page.locator('[data-app="nrn"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#app-back')).toBeHidden();
  await page.click('[data-app="certified"]');
  await expect(page.locator('#app-name')).toHaveText('Certified'); await expect(page.locator('#dash-home')).toBeVisible();
  await expect(page.locator('[data-app="certified"]')).toHaveAttribute('aria-current', 'page'); await expect(page.locator('[data-app="nrn"]')).not.toHaveAttribute('aria-current', 'page');
  const side = await page.locator('#dash-home').boundingBox(), main = await page.locator('#dash-app').boundingBox();
  expect(side!.x + side!.width).toBeLessThanOrEqual(main!.x);
});

test('on a phone the list comes first and one page shows at a time', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'phone only'); await fake(page, { user: true });
  await page.goto('/account/');
  await expect(page.locator('#dash-home')).toBeVisible(); await expect(page.locator('#dash-app')).toBeHidden();
  await page.click('[data-app="vault"]');
  await expect(page.locator('#dash-home')).toBeHidden(); await expect(page.locator('#app-name')).toHaveText('Soul Vault');
  await page.click('#app-back'); await expect(page.locator('#dash-app')).toBeHidden();
});
