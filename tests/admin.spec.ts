// The /admin page: sign-in, the folders, the counts, sign-out. The real /api is not available in the test server, so every answer is faked here.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PASSWORD = 'correct horse battery staple';
const TOKEN = 'fake-session-token';
type Mode = 'not-set-up' | 'ready';

async function fakeApi(page: Page, opts: { mode?: Mode; backupLast?: boolean } = {}) {
  const state = { mode: (opts.mode || 'ready') as Mode, logins: 0, backups: 0 };
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path === '/api/admin') {
      const auth = req.headers()['authorization'] || '';
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        if (body.action === 'login') { state.logins += 1; return route.fulfill(body.password === PASSWORD ? json({ ok: true, token: TOKEN, days: 30 }) : json({ ok: false, message: 'That password is not right.' }, 401)); }
        if (body.action === 'backup') { state.backups += 1; return route.fulfill(json({ ok: true, result: 'saved', saved: { surveys: { tabs: 3, rows: 40 }, payments: { tabs: 2, rows: 12 } }, failed: {}, skipped: { cinema: 'no key' } })); }
      }
      if (state.mode === 'not-set-up') return route.fulfill(json({ status: 'ok', mode: 'not-set-up' }));
      if (!auth) return route.fulfill(json({ status: 'ok', mode: 'ready' }));
      if (auth !== `Bearer ${TOKEN}`) return route.fulfill(json({ ok: false }, 401));
      return route.fulfill(json({ status: 'ok', mode: 'ready', signedIn: true, setup: [
        { group: 'Survey and e-mails', items: [{ name: 'RESEND_API_KEY', label: 'E-mail sending key (Resend)', present: true }, { name: 'RECAP_CRON_TOKEN', label: 'Daily recap job password', present: false }] },
        { group: 'Backups and sign-in', items: [{ name: 'BACKUPS', label: 'Backup storage bucket (R2 binding)', present: false }, { name: 'ADMIN_PASSWORD', label: 'Admin password (this page)', present: true }] },
      ] }));
    }
    if (path === '/api/feed/gallery') return route.fulfill(json({ source: 'drive', categories: [{}, {}] }));
    if (path === '/api/feed/cinema') return route.fulfill(json({ source: 'sheet', films: [{}] }));
    if (path === '/api/feed/services') return route.fulfill(json({ services: [{}, {}, {}] }));   // no "source": the old fallback answered
    if (path === '/api/feed/latest') return route.fulfill(json({ ok: true, music: { publishedAt: '2026-07-31T17:00:06Z' } }));
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

test('the settings: five folders, honest counts, the setup checklist, back up now, and sign out', async ({ page }, info) => {
  only(info);
  const state = await fakeApi(page);
  await page.addInitScript((t) => localStorage.setItem('nrn_admin', t), TOKEN);
  await page.goto('/admin/');
  await expect(page.locator('#banner')).toContainText('3 of 10 need attention', { timeout: 10000 });
  await expect(page.locator('#banner')).toContainText('Services, Service requests, Nightly sheet backup');
  await expect.poll(async () => page.locator('.strip b').allTextContents()).toEqual(['7', '2', '1']);   // new, old fallback, to do
  expect(await page.locator('details.folder').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.folder))).toEqual(['feeds', 'send', 'keep', 'setup', 'account']);
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
  for (const f of ['keep', 'setup', 'account']) await page.locator(`details[data-folder="${f}"] > summary`).click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'sideways scrolling').toBeLessThanOrEqual(0);
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.admin button, .admin summary, .admin input')].filter((e) => e.offsetParent !== null).map((e) => ({ t: (e.textContent || e.id).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 44));
  expect(small, 'buttons and folders at least 44px tall').toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious, 'serious accessibility problems').toEqual([]);
  if (process.env.SHOT_ADMIN) await page.screenshot({ path: process.env.SHOT_ADMIN, fullPage: true });
});
