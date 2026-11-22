// "Is each of Nick's live sites up?" Read-only: it loads pages and asks the data services their harmless status questions; it never changes anything.
// Run: node scripts/check-sites.mjs   (exit 1 if any site is down; the scheduled run then fails and GitHub emails the owner).
// money.nrnszn.com (NuMoney) is left out on purpose: it sits behind a login, so an outside check can't tell "up" from "locked".
import { pathToFileURL } from 'node:url';

const html = (min = 500) => async (res) => (res.headers.get('content-type') || '').includes('html') && (await res.text()).length > min;
const jsonOk = (test) => async (res) => test(await res.json());
const hasVersion = async (res) => { const d = await res.json(); return Boolean(d && (d.version || d.build || d.release)); };

export const SITES = [
  { name: 'Soul Vault (soulnicolas.com)', url: 'https://soulnicolas.com/', ok: html() },
  { name: 'Soul Vault sitemap', url: 'https://soulnicolas.com/sitemap.xml', ok: async (res) => (await res.text()).includes('<urlset') },
  { name: 'NuRenaissance site (www.nrnszn.com)', url: 'https://www.nrnszn.com/', ok: html() },
  { name: 'NuRenaissance version file', url: 'https://www.nrnszn.com/version.json', ok: hasVersion },
  { name: 'CERTIFIED (play.nrnszn.com)', url: 'https://play.nrnszn.com/', ok: html() },
  { name: 'CERTIFIED version file', url: 'https://play.nrnszn.com/version.json', ok: hasVersion },
  { name: 'NuDirectory (directory.nrnszn.com)', url: 'https://directory.nrnszn.com/', ok: html() },
  { name: 'NuDirectory version file', url: 'https://directory.nrnszn.com/version.json', ok: hasVersion },
  { name: 'luoh (luoh.nrnszn.com)', url: 'https://luoh.nrnszn.com/', ok: html() },
  // No luoh version-file check on purpose: luoh answers an outside visitor's /version.json with a web page (its own gate), not the file, so that check was always red (found Nov 22, 2026).
  { name: 'luoh old address (podi.nrnszn.com)', url: 'https://podi.nrnszn.com/', ok: html() },
  // Data services (Nov 22, 2026). SOFT = a failure prints WARN but does not fail the run, until Nick has seen the check pass once against the real service
  // (nothing here could reach them when it was written). To make one count, delete its `soft: true`.
  // The Supabase keys are the public "publishable" keys that are already in those apps' public pages.
  { name: 'Soul Vault data service (/api edgeStatus)', soft: true, url: 'https://soulnicolas.com/api', method: 'POST', body: JSON.stringify({ fn: 'edgeStatus', args: [] }),
    ok: jsonOk((d) => Boolean(d && d.result && typeof d.result === 'object')) },
  { name: 'CERTIFIED backend (widget ping)', soft: true, url: 'https://iimeihgrxvtuwcuyuzfh.supabase.co/functions/v1/widget?action=ping',
    headers: { apikey: 'sb_publishable_1G2xfrTIlTMwBnbofIKEeg_MRXYrueZ', authorization: 'Bearer sb_publishable_1G2xfrTIlTMwBnbofIKEeg_MRXYrueZ' }, ok: jsonOk((d) => d && d.ok === true) },
  { name: 'NuDirectory database (Supabase health)', soft: true, url: 'https://fmyvsejwtmrymyvpjhmc.supabase.co/auth/v1/health',
    headers: { apikey: 'sb_publishable_xM1xvQQllNzFM7dIBeS3mQ_U6KgDPyL' }, ok: jsonOk((d) => Boolean(d && typeof d === 'object')) },
];

/** Try a site up to `tries` times (a blip should not wake anyone up). { ...site, pass, why? } */
export async function checkSite(site, { fetchImpl = fetch, tries = 3, waitMs = 10_000, timeoutMs = 20_000 } = {}) {
  let why = '';
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchImpl(site.url, { method: site.method || 'GET', body: site.body, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'nrnszn-uptime-check', ...(site.headers || {}) } });
      if (!res.ok) why = `HTTP ${res.status}`;
      else if (await site.ok(res)) return { ...site, pass: true };
      else why = 'answered, but not with the expected page';
    } catch (e) {
      why = e.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} seconds` : e.message;
    }
    if (attempt < tries && waitMs) await new Promise((r) => setTimeout(r, waitMs));
  }
  return { ...site, pass: false, why };
}

export async function checkAll(sites = SITES, opts) { return Promise.all(sites.map((s) => checkSite(s, opts))); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await checkAll();
  for (const r of results) console.log(`${r.pass ? 'OK  ' : r.soft ? 'WARN' : 'DOWN'}  ${r.name}${r.pass ? '' : ` — ${r.why}${r.soft ? ' (soft: not failing the run yet)' : ''}`}`);
  const down = results.filter((r) => !r.pass && !r.soft);
  if (down.length) { console.log(`\n${down.length} of ${results.length} checks failed.`); process.exit(1); }
  console.log(`\nAll ${results.length} checks passed.`);
}
