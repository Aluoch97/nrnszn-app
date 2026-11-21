// The /admin page: sign-in, the folders, the counts, sign-out. The real /api is not available in the test server, so every answer is faked here.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import zlib from 'node:zlib';

// A real (small, solid colour) PNG made on the spot, so the browser can decode it like a real flyer.
function makePng(w: number, h: number) {
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x9c)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const PASSWORD = 'correct horse battery staple';
const TOKEN = 'fake-session-token';
type Mode = 'not-set-up' | 'ready';

async function fakeApi(page: Page, opts: { mode?: Mode; backupLast?: boolean } = {}) {
  const state = { mode: (opts.mode || 'ready') as Mode, logins: 0, backups: 0, events: [] as any[], saves: [] as any[], ranges: [] as string[] };
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === '/api/admin') {
      const auth = req.headers()['authorization'] || '';
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        if (body.action === 'login') { state.logins += 1; return route.fulfill(body.password === PASSWORD ? json({ ok: true, token: TOKEN, days: 30 }) : json({ ok: false, message: 'That password is not right.' }, 401)); }
        if (body.action === 'event-save') { state.saves.push(body.event); const id = body.event.id || ('ab12cd34ef' + String(state.events.length).padStart(2, '0')); const e = { id, slug: 'winter-showcase-' + id, title: body.event.title, day: body.event.day, time: body.event.time || '', where: body.event.where || '', details: body.event.details || '', tickets: body.event.tickets || '', video: body.event.video || '', watch: body.event.watch || '', flyer: body.event.flyer ? 'f1f1f1f1f1f1' : '', published: body.event.published !== false };
          const at = state.events.findIndex((x) => x.id === e.id); if (at >= 0) state.events[at] = e; else state.events.unshift(e); return route.fulfill(json({ ok: true, id: e.id })); }
        if (body.action === 'event-delete') { state.events = state.events.filter((x) => x.id !== body.id); return route.fulfill(json({ ok: true })); }
        if (body.action === 'backup') { state.backups += 1; return route.fulfill(json({ ok: true, result: 'saved', saved: { surveys: { tabs: 3, rows: 40 }, payments: { tabs: 2, rows: 12 } }, failed: {}, skipped: { cinema: 'no key' } })); }
      }
      if (state.mode === 'not-set-up') return route.fulfill(json({ status: 'ok', mode: 'not-set-up' }));
      if (!auth) return route.fulfill(json({ status: 'ok', mode: 'ready' }));
      if (auth !== `Bearer ${TOKEN}`) return route.fulfill(json({ ok: false }, 401));
      const section = url.searchParams.get('section');
      if (section === 'events') return route.fulfill(json({ ok: true, events: state.events }));
      if (section === 'analytics') {
        const days = Number(url.searchParams.get('days') || 30); state.ranges.push(String(days));
        return route.fulfill(json({ ok: true, days, from: '2026-11-01', to: '2026-11-30', views: 120, visitors: 80, viewsPerVisitor: 1.5, previous: { views: 100, visitors: 90 },
          daily: Array.from({ length: days }, (_, i) => ({ day: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, views: i % 5, visitors: i % 3 })),
          pages: [{ name: '/', views: 60 }, { name: '/events', views: 30 }], referrers: [{ name: 'l.instagram.com', views: 20 }], devices: [{ name: 'phone', views: 90 }, { name: 'computer', views: 30 }], cities: [{ name: 'Nashville, Tennessee', views: 70 }], countries: [] }));
      }
      return route.fulfill(json({ status: 'ok', mode: 'ready', signedIn: true, setup: [
        { group: 'Survey and e-mails', items: [{ name: 'RESEND_API_KEY', label: 'E-mail sending key (Resend)', present: true }, { name: 'RECAP_CRON_TOKEN', label: 'Daily recap job password', present: false }] },
        { group: 'Backups and sign-in', items: [{ name: 'BACKUPS', label: 'Backup storage bucket (R2 binding)', present: false }, { name: 'ADMIN_PASSWORD', label: 'Admin password (this page)', present: true }] },
      ] }));
    }
    if (path === '/api/feed/gallery') return route.fulfill(json({ source: 'drive', categories: [{}, {}] }));
    if (path === '/api/feed/cinema') return route.fulfill(json({ source: 'sheet', films: [{}] }));
    if (path === '/api/feed/services') return route.fulfill(json({ services: [{}, {}, {}] }));   // no "source": the old fallback answered
    if (path === '/api/feed/latest') return route.fulfill(json({ ok: true, music: { publishedAt: '2026-07-31T17:00:06Z' } }));
    if (path === '/api/stripe-webhook') return route.fulfill(json({ status: 'ok', mode: 'ready' }));
    if (path === '/api/account/me') return route.fulfill(json({ on: true, google: true, email: true, user: null }));
    if (path === '/api/survey') return route.fulfill(json({ status: 'ok', mode: 'sheet' }));
    if (path === '/api/survey-recap') return route.fulfill(json({ status: 'ok', mode: 'edge' }));
    if (path === '/api/payment') return route.fulfill(json({ status: 'ok', mode: 'sheet' }));
    if (path === '/api/service-click') return route.fulfill(json({ status: 'ok', mode: 'sheet' }));
    if (path === '/api/service-lead') return route.fulfill(json({ status: 'ok', mode: 'apps-script' }));
    if (path === '/api/backup') return route.fulfill(json(opts.backupLast ? { status: 'ok', mode: 'r2', last: { at: new Date().toISOString(), kept: 3 } } : { status: 'ok', mode: 'not-set-up' }));
    return route.fulfill({ status: 404, body: '' });
  });
  return state;
}
const only = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'one phone and one desktop size');

test('before sign-in set up: it explains how to switch it on, with no password box', async ({ page }, info) => {
  only(info);
  await fakeApi(page, { mode: 'not-set-up' });
  await page.goto('/admin/');
  await expect(page.locator('#not-set-up')).toBeVisible(); await expect(page.locator('#not-set-up')).toContainText('ADMIN_PASSWORD');
  await expect(page.locator('#login')).toBeHidden(); await expect(page.locator('#dash')).toBeHidden();
});

test('signed out: a password box and nothing else; a wrong password says so; the right one opens the settings and stays signed in', async ({ page }, info) => {
  only(info);
  const state = await fakeApi(page);
  await page.goto('/admin/');
  await expect(page.locator('#login')).toBeVisible(); await expect(page.locator('#dash')).toBeHidden();
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
  await page.fill('#pw', 'nope'); await page.click('#login button');
  await expect(page.locator('#login-error')).toContainText('not right'); await expect(page.locator('#dash')).toBeHidden();
  await page.fill('#pw', PASSWORD); await page.click('#login button');
  await expect(page.locator('#dash')).toBeVisible(); await expect(page.locator('#login')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('nrn_admin'))).toBe(TOKEN);
  expect(await page.locator('#pw').inputValue(), 'the password is cleared from the box').toBe('');
  await page.reload(); await expect(page.locator('#dash')).toBeVisible();   // still signed in
  expect(state.logins).toBe(2);
});

test('a session the server no longer accepts sends you back to the password box', async ({ page }, info) => {
  only(info);
  await fakeApi(page);
  await page.addInitScript(() => localStorage.setItem('nrn_admin', 'an-old-token'));
  await page.goto('/admin/');
  await expect(page.locator('#login')).toBeVisible(); await expect(page.locator('#login-error')).toContainText('sign in again');
  expect(await page.evaluate(() => localStorage.getItem('nrn_admin'))).toBeNull();
});

test('the settings: nine folders in four groups, honest counts, the setup checklist, back up now, and sign out', async ({ page }, info) => {
  only(info);
  const state = await fakeApi(page);
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await expect(page.locator('#banner')).toContainText('3 of 12 need attention', { timeout: 10000 });
  await expect(page.locator('#banner')).toContainText('Services, Service requests, Nightly sheet backup');
  await expect.poll(async () => page.locator('#n-ok, #n-old, #n-todo').allTextContents()).toEqual(['9', '2', '1']);   // new, old fallback, to do
  expect(await page.locator('details.folder').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.folder))).toEqual(['events', 'push', 'clients', 'analytics', 'send', 'feeds', 'keep', 'setup', 'account']);   // in the order of their groups
  // laid out like Soul Vault's Settings: coloured groups, one hero folder, an icon tile on every folder
  expect(await page.locator('.grp > h2').allTextContents()).toEqual(['Create & send', 'Visitors & activity', 'Health & data', 'Account']);
  expect(await page.locator('details.folder.hero').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.folder))).toEqual(['events']);
  expect(await page.locator('details.folder > summary .si svg').count()).toBe(9);
  await expect(page.locator('#b-feeds')).toHaveText('1'); await expect(page.locator('#b-send')).toHaveText('1'); await expect(page.locator('#b-keep')).toHaveText('1');
  // the setup checklist says Set / Missing, never a value
  await page.locator('details[data-folder="setup"] > summary').click();
  await expect(page.locator('#b-setup')).toHaveText('2');
  await expect(page.locator('#setup-list')).toContainText('E-mail sending key'); await expect(page.locator('#setup-list')).toContainText('Missing');
  // back up now
  await page.locator('details[data-folder="keep"] > summary').click();
  await page.click('#backup-now');
  await expect(page.locator('#backup-result')).toContainText('surveys: 40 rows'); await expect(page.locator('#backup-result')).toContainText('cinema skipped');
  expect(state.backups).toBe(1);
  // sign out
  await page.locator('details[data-folder="account"] > summary').click();
  await page.click('#sign-out');
  await expect(page.locator('#login')).toBeVisible(); await expect(page.locator('#dash')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('nrn_admin'))).toBeNull();
});

test('signed in: fits the screen, big enough to tap, and passes the accessibility check', async ({ page }, info) => {
  only(info);
  await fakeApi(page, { backupLast: true });
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await expect(page.locator('#banner')).toContainText('need attention', { timeout: 10000 });
  for (const f of ['keep', 'events', 'analytics', 'setup', 'account']) await page.locator(`details[data-folder="${f}"] > summary`).click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'sideways scrolling').toBeLessThanOrEqual(0);
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.admin button, .admin summary, .admin input')].filter((e) => e.offsetParent !== null).map((e) => ({ t: (e.textContent || e.id).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44));
  expect(small, 'buttons and folders at least 44px tall').toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious, 'serious accessibility problems').toEqual([]);
  if (process.env.SHOT_ADMIN) await page.screenshot({ path: process.env.SHOT_ADMIN, fullPage: true });
});

test('events: add one with a flyer, see it listed, edit it, hide it, delete it', async ({ page }, info) => {
  only(info);
  const state = await fakeApi(page);
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await page.locator('details[data-folder="events"] > summary').click();
  await expect(page.locator('#ev-msg')).toContainText('No events added here yet');
  await page.click('#ev-add');
  await expect(page.locator('#ev-form')).toBeVisible();
  // a name and a date are needed
  await page.fill('#ev-title', 'Winter Showcase <b>1</b>'); await page.fill('#ev-day', '2027-02-13'); await page.fill('#ev-time', '7–11 PM'); await page.fill('#ev-where', 'HOME Studios');
  await page.fill('#ev-details', 'Doors at 6.'); await page.fill('#ev-tickets', 'https://www.nrnszn.com/support');
  // a flyer picture: made into two sizes in the browser before it is sent
  const png = makePng(40, 30);
  await page.setInputFiles('#ev-flyer', { name: 'flyer.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#ev-preview')).toBeVisible();
  await page.click('#ev-save');
  await expect(page.locator('#ev-list')).toContainText('Winter Showcase <b>1</b>');   // shown as plain text, never as markup
  expect(await page.locator('#ev-list b').count(), 'event names are shown as text, not HTML').toBe(0);
  expect(state.saves[0].flyer.big).toMatch(/^data:image\/(webp|jpeg);base64,/); expect(state.saves[0].flyer.small).toMatch(/^data:image\/(webp|jpeg);base64,/);
  expect(state.saves[0]).toMatchObject({ day: '2027-02-13', tickets: 'https://www.nrnszn.com/support', published: true });
  await expect(page.locator('#b-events')).toHaveText('1');
  await expect(page.locator('#ev-list a', { hasText: 'View page' })).toHaveAttribute('href', /^\/events\/winter-showcase-ab12cd34ef00\/$/);
  // edit: rename and hide
  await page.click('#ev-list [data-edit]'); await expect(page.locator('#ev-form-title')).toHaveText('Edit event'); await expect(page.locator('#ev-title')).toHaveValue('Winter Showcase <b>1</b>');
  await page.fill('#ev-title', 'Winter Showcase (moved)'); await page.uncheck('#ev-pub'); await page.click('#ev-save');
  await expect(page.locator('#ev-list')).toContainText('Winter Showcase (moved)'); await expect(page.locator('#ev-list .tag')).toHaveText('Hidden'); await expect(page.locator('#ev-list a', { hasText: 'View page' }), 'a hidden event has no public page to view').toHaveCount(0);
  expect(state.saves[1].id).toBeTruthy(); expect(state.saves[1].flyer, 'a text edit does not re-send the flyer').toBeUndefined(); expect(state.saves[1].published).toBe(false);
  // delete (asks first)
  page.once('dialog', (d) => d.dismiss()); await page.click('#ev-list [data-edit]'); await page.click('#ev-delete'); expect(state.events.length, 'cancelled: still there').toBe(1);
  page.once('dialog', (d) => d.accept()); await page.click('#ev-delete');
  await expect(page.locator('#ev-msg')).toContainText('Saved'); await expect.poll(() => state.events.length).toBe(0);
});

test('analytics: the numbers, the comparison, the lists, and a different time range', async ({ page }, info) => {
  only(info);
  const state = await fakeApi(page);
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await page.locator('details[data-folder="analytics"] > summary').click();
  await expect(page.locator('#an-out .strip b').first()).toHaveText('120');
  await expect(page.locator('#an-out')).toContainText('+20% vs the period before');
  await expect(page.locator('#an-out')).toContainText('Top pages'); await expect(page.locator('#an-out')).toContainText('/events'); await expect(page.locator('#an-out')).toContainText('l.instagram.com'); await expect(page.locator('#an-out')).toContainText('Phone'); await expect(page.locator('#an-out')).toContainText('Nashville, Tennessee');
  await expect(page.locator('#an-out')).toContainText('counted once per day');
  expect(await page.locator('#an-out .bars i').count()).toBe(30);
  await page.selectOption('#an-days', '90'); await expect.poll(() => page.locator('#an-out .bars i').count()).toBe(90);
  expect(state.ranges).toContain('90'); await expect(page.locator('#b-analytics')).toHaveText('120');
});

test('without the database, events and analytics explain how to connect it instead of failing', async ({ page }, info) => {
  only(info);
  await fakeApi(page);
  await page.route('**/api/admin?section=*', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, result: 'no-db', message: 'not connected' }) }));
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await page.locator('details[data-folder="events"] > summary').click(); await page.locator('details[data-folder="analytics"] > summary').click();
  await expect(page.locator('#ev-msg')).toContainText('database is not connected'); await expect(page.locator('#ev-add')).toBeHidden();
  await expect(page.locator('#an-out')).toContainText('database is not connected');
});

test('the Account folder: the version line, then three full-width buttons that line up, and the version history has a way back to admin', async ({ page }, info) => {
  only(info);
  await fakeApi(page);
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await expect(page.locator('#banner')).toContainText('need attention', { timeout: 10000 });
  await page.locator('details[data-folder="account"] > summary').click();
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const link = page.locator('details[data-folder="account"] a.btn');
  const [a, b, c] = [await box('details[data-folder="account"] a.btn'), await box('details[data-folder="account"] [data-refresh]'), await box('#sign-out')];
  for (const x of [a, b, c]) expect(x.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(a.width - b.width)).toBeLessThan(2); expect(Math.abs(b.width - c.width)).toBeLessThan(2);   // same width, so they line up
  expect(a.y).toBeLessThan(b.y); expect(b.y).toBeLessThan(c.y);   // What's new, Refresh, Sign out
  expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');   // a button, not an underlined link
  const ver = await box('#ver-line'); expect(ver.y).toBeLessThan(a.y);   // the version is the line above the buttons
  // the version history can be left again
  await link.click();
  await expect(page).toHaveURL(/\/whats-new\/?$/);
  const back = page.locator('a.wn-backbtn');
  await expect(back).toBeVisible(); await expect(back).toHaveAttribute('href', '/admin'); await expect(back).toContainText('Back to admin');
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(page).toHaveURL(/\/admin\/?$/);
});


test('clients & projects: add a project, record a payment, see the balance; without the accounts database it explains', async ({ page }, info) => {
  only(info);
  await fakeApi(page);
  const projects: any[] = []; const saves: any[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const view = () => ({ ok: true, projects: projects.map((p) => { const paid = p.payments.reduce((s: number, x: any) => s + x.amount, 0); return { ...p, paid, balance: p.total - paid }; }), totals: { projects: projects.length, open: projects.length, owed: projects.reduce((s, p) => s + p.total - p.payments.reduce((t: number, x: any) => t + x.amount, 0), 0), accounts: 0 } });
  await page.route('**/api/admin**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'GET' && url.searchParams.get('section') === 'clients') return route.fulfill(json(view()));
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.action === 'client-save') { saves.push(b.project); projects.push({ id: 'c1', email: b.project.email, clientName: '', title: b.project.title, service: '', status: b.project.status, statusLabel: 'Booked', total: Math.round(Number(b.project.total) * 100), due: '', note: '', link: '', hasAccount: false, payments: [] }); return route.fulfill(json({ ok: true, id: 'c1' })); }
      if (b.action === 'client-pay') { projects[0].payments.unshift({ id: 'x1', amount: Math.round(Number(b.payment.amount) * 100), method: b.payment.method, paidOn: b.payment.paidOn, note: '' }); return route.fulfill(json({ ok: true })); }
    }
    return route.fallback();
  });
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await page.locator('details[data-folder="clients"] > summary').click();
  await expect(page.locator('#cl-msg')).toContainText('No client projects yet');
  await page.click('#cl-add');
  await page.fill('#cl-email', 'jo@example.com'); await page.fill('#cl-title', 'Music video'); await page.fill('#cl-total', '1200');
  await page.click('#cl-save');
  await expect(page.locator('#cl-list .row')).toHaveCount(1);
  expect(saves[0]).toMatchObject({ email: 'jo@example.com', title: 'Music video', total: '1200', status: 'booked' });
  await page.locator('#cl-list button', { hasText: 'Add payment' }).click();
  await expect(page.locator('#cp-amount')).toHaveValue('1200');
  await page.fill('#cp-amount', '400'); await page.selectOption('#cp-method', 'zelle');
  await page.locator('#cp-form button[type="submit"]').click();
  await expect(page.locator('#cl-list .row')).toContainText('Balance $800.00');
  await expect(page.locator('#cl-list .row')).toContainText('by Zelle');
});

test('forgot the password: the help explains how to reset it, and an admin signed in to their account gets in with one tap', async ({ page }, info) => {
  only(info);
  await fakeApi(page);
  let door = 0;
  await page.route('**/api/admin', async (route) => {
    const req = route.request();
    if (req.method() === 'GET' && !req.headers()['authorization']) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', mode: 'ready', accountLogin: true }) });
    if (req.method() === 'POST' && JSON.parse(req.postData() || '{}').action === 'account-login') { door++; return route.fulfill(door === 1 ? { status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, result: 'not-admin-yet' }) } : { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: TOKEN, days: 30 }) }); }
    return route.fallback();
  });
  await page.goto('/admin/');
  await expect(page.locator('#login')).toBeVisible();
  expect(door).toBe(1);   // tried quietly once; not signed in to an admin account, so the password box stays
  await page.locator('#forgot > summary').click();
  await expect(page.locator('#forgot')).toContainText('ADMIN_PASSWORD');
  await expect(page.locator('#acct-door')).toBeVisible(); await expect(page.locator('#acct-door-off')).toBeHidden();
  await page.click('#acct-login');
  await expect(page.locator('#dash')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nrn_admin'))).toBe(TOKEN);
});
