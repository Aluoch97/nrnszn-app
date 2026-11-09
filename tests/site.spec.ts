import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Every page in the built site, found automatically, so new pages are checked too.
function routes(dir = 'dist', base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (['_astro', 'widgets', 'icons', 'img'].includes(name)) continue;
    if (statSync(p).isDirectory()) out.push(...routes(p, `${base}/${name}`));
    else if (name === 'index.html') out.push(`${base}/`);
  }
  return out.sort();
}
const ROUTES = existsSync('dist') ? routes() : [];

// Third-party content (YouTube, Google, fonts inside widgets) may be unreachable
// where the check runs; those failures aren't the site's fault.
// "Failed to fetch" = a widget couldn't reach its Google backend from the test machine.
const EXTERNAL_NOISE = /Failed to load resource|Failed to fetch|ERR_|net::|youtube|google|gstatic|wixstatic/i;

async function open(page: Page, route: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !EXTERNAL_NOISE.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  // Keep checks fast and offline-safe: don't wait on third-party media.
  await page.route(/youtube(-nocookie)?\.com|ytimg\.com|googleusercontent|drive\.google|static\.wixstatic/, (r) => r.abort());
  const res = await page.goto(route, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return { res, errors };
}

for (const route of ROUTES) {
  test.describe(route, () => {
    test('loads without errors', async ({ page }) => {
      const { res, errors } = await open(page, route);
      expect(res?.status(), 'page should load').toBeLessThan(400);
      expect(errors, 'no JavaScript errors').toEqual([]);
    });

    test('fits the screen (no sideways scrolling)', async ({ page }) => {
      await open(page, route);
      const over = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= w) return [];
        return [...document.querySelectorAll('body *')]
          .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed')
          .slice(0, 5)
          .map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className || ''}`.slice(0, 80));
      });
      expect(over, 'elements wider than the screen').toEqual([]);
    });

    test('buttons and links are big enough to tap', async ({ page }, info) => {
      test.skip(info.project.name.startsWith('desktop'), 'touch sizes are checked on phones and tablets');
      await open(page, route);
      // WCAG 2.2 target size: at least 24×24 CSS px. Links inside sentences are exempt.
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('a[href], button, summary, [role="button"], input, select, textarea')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return false;
            if (el.closest('p, li > p, .sr-only') && getComputedStyle(el).display === 'inline') return false;
            return r.width < 24 || r.height < 24;
          })
          .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`),
      );
      expect(small, 'tap targets under 24×24px').toEqual([]);
    });

    test('text is readable size', async ({ page }) => {
      await open(page, route);
      // The page itself and the site's own widgets in frames (outside sites like NuDirectory are skipped).
      const origin = new URL(page.url()).origin;
      const tiny: string[] = [];
      for (const frame of page.frames().filter((f) => f.url().startsWith(origin))) {
        tiny.push(...await frame.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()))
            .filter((el) => el.offsetParent && !el.closest('.sr-only') && parseFloat(getComputedStyle(el).fontSize) < 11)
            .slice(0, 5)
            .map((el) => `${location.pathname} ${el.tagName.toLowerCase()} "${el.textContent!.trim().slice(0, 30)}" ${getComputedStyle(el).fontSize}`),
        ).catch(() => []));
      }
      expect(tiny, 'text smaller than 11px').toEqual([]);
    });

    test('has no broken images', async ({ page }) => {
      await open(page, route);
      const broken = await page.evaluate(() =>
        [...document.images]
          .filter((i) => i.src.startsWith(location.origin) && i.complete && i.naturalWidth === 0)
          .map((i) => i.src),
      );
      expect(broken).toEqual([]);
    });

    test('accessibility (WCAG 2.2 AA)', async ({ page }, info) => {
      test.skip(info.project.name !== 'phone-390' && info.project.name !== 'desktop-1280', 'run at one phone and one desktop size');
      await open(page, route);
      // Widget pages are checked including the widget inside the frame.
      // NuDirectory and Certified Lounge are separate sites shown in a frame, so they're left out here.
      const results = await new AxeBuilder({ page }).exclude('.dir-frame').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      expect(serious, 'serious accessibility problems').toEqual([]);
    });

    test('search and sharing basics', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-1280', 'once per page');
      await open(page, route);
      const seo = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
        ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '',
        h1: document.querySelectorAll('h1').length,
      }));
      expect(seo.lang).toBe('en');
      expect(seo.title.length, 'title').toBeGreaterThan(5);
      expect(seo.description.length, 'meta description').toBeGreaterThan(30);
      expect(seo.viewport).toContain('width=device-width');
      expect(seo.canonical, 'canonical link').toMatch(/^https:\/\//);
      expect(seo.ogImage, 'share image').toMatch(/^https:\/\//);
      expect(seo.h1, 'exactly one main heading').toBe(1);
    });

    test('internal links work', async ({ page, request }, info) => {
      test.skip(info.project.name !== 'desktop-1280', 'once per page');
      await open(page, route);
      const hrefs = await page.evaluate(() =>
        [...new Set([...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
          .map((a) => a.href)
          .filter((h) => h.startsWith(location.origin)))],
      );
      const bad: string[] = [];
      for (const h of hrefs) {
        const r = await request.get(h, { maxRedirects: 0 });
        if (r.status() >= 400) bad.push(`${r.status()} ${h}`);
      }
      expect(bad, 'broken internal links').toEqual([]);
    });
  });
}
