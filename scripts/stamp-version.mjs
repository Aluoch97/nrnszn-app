// Runs right after `astro build`. Works out a short fingerprint of everything in dist/ that a visitor's phone could keep (pages, scripts, styles,
// widgets, images, fonts), then
//   1. writes it into dist/sw.js as the cache name (a changed site => a new name => every phone drops its old saved files by itself), and
//   2. writes dist/version.json, which the site footer shows ("Version 3fa9c2e1") and /status reads.
// Nobody has to remember to bump a number by hand any more. The big video files in /media are left out of the fingerprint.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const DIST = process.argv[2] || 'dist';
const SKIP = new Set(['sw.js', 'version.json']);

async function walk(dir) {
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    const p = join(dir, name), s = await stat(p);
    if (s.isDirectory()) { if (relative(DIST, p).split(sep)[0] === 'media') continue; out.push(...(await walk(p))); }
    else if (!SKIP.has(relative(DIST, p))) out.push(p);
  }
  return out;
}

export async function fingerprint(dist = DIST) {
  const h = createHash('sha256');
  for (const p of await walk(dist)) { h.update(relative(dist, p).split(sep).join('/')); h.update('\0'); h.update(await readFile(p)); h.update('\0'); }
  return h.digest('hex').slice(0, 8);
}

// The short version people see ("1.1") is the newest "## x.y" heading in CHANGELOG.md (next to dist/'s parent folder). The fingerprint stays the cache name.
const clPath = process.env.NRN_CHANGELOG || join(DIST, '..', 'CHANGELOG.md');
const release = existsSync(clPath) ? ((await readFile(clPath, 'utf8')).match(/^## (\d+\.\d+)\b/m) || [])[1] || '' : '';
const version = 'nrn-' + await fingerprint(DIST);
const swPath = join(DIST, 'sw.js'), sw = await readFile(swPath, 'utf8');
if (!/const VERSION = '[^']*';/.test(sw)) { console.error('stamp-version: could not find "const VERSION = ..." in dist/sw.js'); process.exit(1); }
await writeFile(swPath, sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
await writeFile(join(DIST, 'version.json'), JSON.stringify({ version, release, builtAt: new Date().toISOString() }) + '\n');
console.log(`stamp-version: ${version}`);
