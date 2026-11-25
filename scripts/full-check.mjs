// The scripted case check of the LIVE site (part of the "full check", see CLAUDE.md). Read-only: it only opens pages.
//   node scripts/full-check.mjs [base]      (default https://www.nrnszn.com; PW_CHROMIUM = a Chrome if Playwright has none)
// Every page in the sitemap (+ /account, /whats-new and a made-up address that must answer 404) at 320, 390 and 1280 px:
// status, sideways scroll, the same header everywhere, footer, text under 11px, small tap targets, broken pictures, script
// errors, title "Page | NuRenaissance", description length, one h1, canonical, noindex pages kept out of the sitemap,
// duplicate titles, wording rules (Certified began in 2023, no placeholder text, city names outside the allowed pages)
// and every internal link. App pages (/play, /vault, /directory) are full-screen frames and skip the header/footer rules.
import { chromium } from 'playwright';
const BASE = (process.argv[2] || 'https://www.nrnszn.com').replace(/\/$/, '');
const proxy = process.env.HTTPS_PROXY && !/localhost|127\.0\.0\.1/.test(BASE) ? { server: process.env.HTTPS_PROXY } : undefined;
const issues = []; const note = (sev, where, msg) => issues.push({ sev, where, msg });
await (async () => {
  const sm = await (await fetch(BASE + '/sitemap-0.xml')).text();
  const pages = [...sm.matchAll(/<loc>([^<]+)/g)].map((m) => new URL(m[1]).pathname);
  const APP = /^\/(play|vault|directory)\/$/;
  const extra = ['/account/', '/whats-new/', '/nope-404-check/'];
  if (!pages.length) throw new Error('empty sitemap at ' + BASE);
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, proxy });
  const titles = {}, descs = {}, links = new Set();
  for (const vw of [320, 390, 1280]) {
    const ctx = await b.newContext({ viewport: { width: vw, height: 800 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    let errs = [];
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL_CONNECTION|status of 404/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
    for (const path of [...pages, ...extra]) {
      errs = [];
      const r = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => null);
      const st = r ? r.status() : 0;
      if (path === '/nope-404-check/') { if (st !== 404) note('high', path, 'unknown page answers ' + st + ' instead of 404'); }
      else if (st !== 200) { note('high', path, `status ${st} @${vw}`); continue; }
      await p.waitForTimeout(600);
      const d = await p.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const vis = (e) => e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
        const txt = document.body.innerText;
        const small = [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() && vis(e) && parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.textContent.trim().slice(0, 30));
        const tiny = [...document.querySelectorAll('a, button')].filter((e) => vis(e) && getComputedStyle(e).display !== 'inline').filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map((e) => (e.textContent.trim() || e.getAttribute('aria-label') || e.className).slice(0, 30));
        const overlap = (() => { const w = q('.word-1'), a = q('.acct-btn'); if (!vis(w) || !vis(a)) return null; return w.getBoundingClientRect().right > a.getBoundingClientRect().left + 1; })();
        const brokenImgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.src);
        return {
          title: document.title, desc: q('meta[name=description]')?.content || '', canon: q('link[rel=canonical]')?.href || '',
          robots: q('meta[name=robots]')?.content || '', h1: document.querySelectorAll('h1').length,
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          brand: vis(q('.bar .brand')), acct: vis(q('.acct-btn')), book: vis(q('.book-btn')), back: !!q('.bar-back'),
          topnav: vis(q('.topnav')), foot: !!q('.foot'), contact: q('.foot .contact')?.innerText.trim() || '',
          footLinks: [...document.querySelectorAll('.foot .links a')].map((a) => a.textContent.trim()),
          small, tiny, overlap, brokenImgs, txt,
          links: [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin)),
          barW: q('.bar')?.getBoundingClientRect().width, barCenter: (() => { const n = q('.topnav'); if (!vis(n)) return null; const r = n.getBoundingClientRect(); return Math.round(r.left + r.width / 2 - innerWidth / 2); })(),
        };
      });
      const W = `${path} @${vw}`;
      if (d.sw > d.cw) note('high', W, `sideways scroll ${d.sw}>${d.cw}`);
      if (path.startsWith('/admin') || APP.test(path)) continue;
      if (!d.brand || !d.acct || !d.book) note('high', W, `header incomplete brand=${d.brand} acct=${d.acct} book=${d.book}`);
      if (d.back) note('med', W, 'old Back link in header');
      if (vw === 1280 && !d.topnav) note('med', W, 'no menu strip on computer');
      if (vw === 1280 && d.barCenter !== null && Math.abs(d.barCenter) > 40) note('low', W, `menu strip off centre by ${d.barCenter}px`);
      if (d.overlap) note('high', W, 'wordmark overlaps account button');
      if (d.small.length) note('med', W, 'text under 11px: ' + d.small.slice(0, 3).join(' | '));
      if (d.tiny.length) note('med', W, 'tap target under 24px: ' + [...new Set(d.tiny)].slice(0, 4).join(' | '));
      const own = d.brokenImgs.filter((u) => u.startsWith(BASE)), out = d.brokenImgs.filter((u) => !u.startsWith(BASE));
      if (own.length) note('high', W, 'broken pictures: ' + own.join(', '));
      if (out.length) note('low', W, `${out.length} outside pictures did not load (e.g. ${new URL(out[0]).host}; blocked networks cannot reach YouTube)`);
      errs.forEach((e) => note('med', W, e));
      if (vw !== 390) continue;
      if (!/^[^|]+ \| NuRenaissance$/.test(d.title)) note('med', path, `title "${d.title}"`);
      if (!d.desc) note('med', path, 'no description'); else if (d.desc.length > 165) note('low', path, `description ${d.desc.length} chars`);
      if (d.h1 !== 1) note('high', path, `${d.h1} h1 elements`);
      if (!d.canon && !d.robots.includes('noindex')) note('low', path, 'no canonical');
      if (d.robots.includes('noindex') && pages.includes(path)) note('med', path, 'noindex page is in the sitemap');
      if (!d.foot) note('med', path, 'no footer');
      if (d.contact && !/^\S+@\S+$/.test(d.contact)) note('med', path, `footer contact "${d.contact}"`);
      if (d.footLinks.length && d.footLinks.some((t) => /your account/i.test(t))) note('med', path, 'footer still has Your account');
      (titles[d.title] ||= []).push(path); (descs[d.desc] ||= []).push(path);
      if (path !== '/nope-404-check/') d.links.forEach((l) => links.add(l.split('#')[0]));
      const t = d.txt;
      const bad = [[/certified (since|in) 2017/i, 'says Certified since 2017'], [/lorem ipsum|TODO|FIXME|\bundefined\b|\bNaN\b|\[object Object\]/, 'placeholder/garbage text'], [/\$\s?0(\.00)?\b(?! deposit)/, '$0 shown'], [/\s{2,}\./, 'stray space before period']];
      for (const [re, m] of bad) { const x = t.match(re); if (x) note('high', path, `${m}: "${t.slice(Math.max(0, x.index - 40), x.index + 40).replace(/\s+/g, ' ')}"`); }
      const nash = (t.match(/[^.\n]*Nashville[^.\n]*/g) || []);
      if (nash.length && !/privacy|terms|events\/|about|directory|survey|apps|whats-new/.test(path)) nash.forEach((s) => note('low', path, `Nashville mention: "${s.trim().slice(0, 100)}"`));
      if (/\p{Emoji_Presentation}/u.test(t) && path === '/services/') note('low', path, 'emoji on Services: ' + (t.match(/.{0,20}\p{Emoji_Presentation}.{0,20}/u) || [''])[0]);
    }
    await ctx.close();
  }
  for (const [k, v] of Object.entries(titles)) if (v.length > 1) note('med', v.join(', '), `same title "${k}"`);
  for (const [k, v] of Object.entries(descs)) if (v.length > 1 && k) note('low', v.join(', '), `same description`);
  const seen = new Set(pages.map((p) => BASE + p));
  for (const l of links) { if (seen.has(l) || /\/api\/|cdn-cgi/.test(l)) continue; const r = await fetch(l, { redirect: 'follow' }).catch(() => null); if (!r || r.status >= 400) note('high', l, 'broken internal link ' + (r && r.status)); }
  console.log('pages', pages.length + extra.length, 'links', links.size);
  const order = { high: 0, med: 1, low: 2 };
  const uniq = [...new Map(issues.map((i) => [i.sev + i.where + i.msg, i])).values()].sort((a, b) => order[a.sev] - order[b.sev]);
  for (const i of uniq) console.log(i.sev.toUpperCase().padEnd(5), i.where, '—', i.msg);
  console.log('total', uniq.length, '(high', uniq.filter((i) => i.sev === 'high').length + ')');
  process.exitCode = uniq.some((i) => i.sev === 'high') ? 1 : 0;
  await b.close();
})();
