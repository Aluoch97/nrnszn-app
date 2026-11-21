// "Is each of Nick's live sites up?" Read-only: it only loads pages, never submits anything.
// Run: node scripts/check-sites.mjs   (exit 1 if any site is down; the scheduled run then fails and GitHub emails the owner).
// money.nrnszn.com (NuMoney) is left out on purpose: it sits behind a login, so an outside check can't tell "up" from "locked".
import { pathToFileURL } from 'node:url';

const html = (min = 500) => async (res) => (res.headers.get('content-type') || '').includes('html') && (await res.text()).length > min;
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
  { name: 'luoh version file', url: 'https://luoh.nrnszn.com/version.json', ok: hasVersion },
  { name: 'luoh old address (podi.nrnszn.com)', url: 'https://podi.nrnszn.com/', ok: html() },
];

/** Try a site up to `tries` times (a blip should not wake anyone up). { ...site, pass, why? } */
export async function checkSite(site, { fetchImpl = fetch, tries = 3, waitMs = 10_000, timeoutMs = 20_000 } = {}) {
  let why = '';
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetchImpl(site.url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'nrnszn-uptime-check' } });
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
  for (const r of results) console.log(`${r.pass ? 'OK  ' : 'DOWN'}  ${r.name}${r.pass ? '' : ` — ${r.why}`}`);
  const down = results.filter((r) => !r.pass);
  if (down.length) { console.log(`\n${down.length} of ${results.length} checks failed.`); process.exit(1); }
  console.log(`\nAll ${results.length} checks passed.`);
}
