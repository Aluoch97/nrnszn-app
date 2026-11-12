// Daily health check for the Google Apps Script backends, their Cloudflare cached copies, and the live site.
// Read-only: it never submits forms, records payments or counts clicks.
// Each backend address is read from the file that uses it, so this stays in
// step if a widget is pointed at a new script.
// Run: node scripts/check-backends.mjs   (exits 1 if anything is down)
import { readFileSync } from 'node:fs';

const fromFile = (file, name) => {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const m = text.match(new RegExp(`${name}\\s*=\\s*\\n?\\s*['"](https://script\\.google\\.com/macros/s/[^'"]+)['"]`));
  if (!m) throw new Error(`Couldn't find ${name} in ${file}`);
  return m[1];
};
const json = (test) => async (res) => test(await res.json());

const checks = [
  { name: 'Services (prices + booking)', url: fromFile('src/data/services.js', 'SERVICES_API_URL'),
    ok: json((d) => Array.isArray(d.services) && d.services.length > 0) },
  { name: 'NuCinema catalog', url: fromFile('public/widgets/cinema.html', 'CATALOG_ENDPOINT'),
    ok: json((d) => Array.isArray(d.films) && d.films.length > 0) },
  { name: 'NuGallery', url: fromFile('public/widgets/gallery.html', 'GALLERY_ENDPOINT'),
    ok: json((d) => !d.error && Array.isArray(d.categories) && d.categories.length > 0) },
  { name: 'Support (payment logger)', url: fromFile('public/widgets/support.html', 'SCRIPT_URL'),
    ok: json((d) => d.status === 'ok') },
  { name: 'Payment logger (site endpoint)', url: 'https://www.nrnszn.com/api/payment', ok: json((d) => d.status === 'ok') },
  { name: 'Survey endpoint (site)', url: 'https://www.nrnszn.com/api/survey', ok: json((d) => d.status === 'ok') },
  { name: 'Survey', url: fromFile('public/widgets/survey.html', 'APPS_SCRIPT_URL'),
    ok: async (res) => /Feedback Survey/.test(await res.text()) },
  { name: 'Website home', url: 'https://app.nrnszn.com/', ok: async (res) => /NuRenaissance/.test(await res.text()) },
  // The Cloudflare copies of the read-only feeds (functions/api/feed): fast path the pages use first.
  { name: 'Cached feed: services', url: 'https://www.nrnszn.com/api/feed/services', ok: json((d) => Array.isArray(d.services) && d.services.length > 0) },
  { name: 'Cached feed: NuCinema', url: 'https://www.nrnszn.com/api/feed/cinema', ok: json((d) => Array.isArray(d.films) && d.films.length > 0) },
  { name: 'Cached feed: latest videos', url: 'https://www.nrnszn.com/api/feed/latest', ok: json((d) => d.ok === true && Boolean(d.interview?.id || d.music?.id)) },
  { name: 'Cached feed: NuGallery', url: 'https://www.nrnszn.com/api/feed/gallery', ok: json((d) => Array.isArray(d.categories) && d.categories.length > 0) },
  // YouTube playlist reader for the Certified Lounge app (fails if YouTube changes its playlist page).
  { name: 'Playlist reader: Certified Interviews', url: 'https://www.nrnszn.com/api/playlist?list=PLVprhlbgSo1vN-wkuvFDjabBQ85XURyTd', ok: json((d) => d.ok === true && Array.isArray(d.videos) && d.videos.length > 0) },
  { name: 'Services click counter (site endpoint)', url: 'https://www.nrnszn.com/api/service-click', ok: json((d) => d.status === 'ok') },
  { name: 'Survey recap endpoint (site)', url: 'https://www.nrnszn.com/api/survey-recap', ok: json((d) => d.status === 'ok') },
  { name: 'Website services page', url: 'https://app.nrnszn.com/services', ok: async (res) => /Services/.test(await res.text()) },
];

async function run(check) {
  // Apps Script can be slow to wake up, so allow a long wait and one retry.
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(check.url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      if (!res.ok) { last = `HTTP ${res.status}`; continue; }
      if (await check.ok(res)) return { ...check, pass: true };
      last = 'answered, but not with the expected data';
    } catch (e) {
      last = e.name === 'TimeoutError' ? 'no answer within 60 seconds' : e.message;
    }
  }
  return { ...check, pass: false, why: last };
}

const results = await Promise.all(checks.map(run));
for (const r of results) console.log(`${r.pass ? 'OK  ' : 'DOWN'}  ${r.name}${r.pass ? '' : ` — ${r.why}`}`);
const down = results.filter((r) => !r.pass);
if (down.length) {
  console.log(`\n${down.length} of ${results.length} checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} checks passed.`);
