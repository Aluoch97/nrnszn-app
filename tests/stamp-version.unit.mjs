// scripts/stamp-version.mjs: the automatic site version. Runs the real script on a throwaway dist/ folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/stamp-version.mjs', import.meta.url).pathname;
const SW = "// service worker\nconst VERSION = 'nrn-v7';\nself.addEventListener('install', () => {});\n";

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'nrn-dist-'));
  for (const [name, body] of Object.entries({ 'sw.js': SW, 'index.html': '<h1>hi</h1>', 'about/index.html': '<h1>about</h1>', ...files })) {
    mkdirSync(join(dir, name.split('/').slice(0, -1).join('/')), { recursive: true }); writeFileSync(join(dir, name), body);
  }
  return dir;
}
const run = (dir) => { execFileSync('node', [script, dir], { stdio: 'pipe' }); return { sw: readFileSync(join(dir, 'sw.js'), 'utf8'), info: JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')) }; };

test('it stamps the version into sw.js and writes version.json with the same value', () => {
  const dir = site({}); const { sw, info } = run(dir);
  assert.match(info.version, /^nrn-[0-9a-f]{8}$/); assert.ok(sw.includes(`const VERSION = '${info.version}';`)); assert.ok(!sw.includes('nrn-v7'));
  assert.ok(Date.parse(info.builtAt) > 0); rmSync(dir, { recursive: true });
});

test('the same site always gets the same version; any changed page, script or image gives a new one', () => {
  const a = run(site({})).info.version, b = run(site({})).info.version;
  assert.equal(a, b, 'same files, same version');
  assert.notEqual(a, run(site({ 'index.html': '<h1>hello</h1>' })).info.version, 'a changed page');
  assert.notEqual(a, run(site({ 'img/new.webp': 'pixels' })).info.version, 'a new file');
});

test('the big video files and the two stamped files do not change the version', () => {
  const a = run(site({})).info.version;
  assert.equal(a, run(site({ 'media/trailer.mp4': 'a huge video' })).info.version, 'media is left out');
  const dir = site({}); run(dir); const first = JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')).version;
  const second = run(dir).info.version; assert.equal(first, second, 'running it again on an already stamped folder gives the same version');
});

test('it refuses to run (and says why) when sw.js has no VERSION line, instead of silently doing nothing', () => {
  const dir = site({ 'sw.js': '// no version here\n' });
  assert.throws(() => execFileSync('node', [script, dir], { stdio: 'pipe' }), (e) => /could not find/.test(String(e.stderr)) && e.status === 1);
});

test("the short release number comes from the newest '## x.y' heading in CHANGELOG.md", () => {
  const dir = site({}); const cl = join(dir, 'CHANGELOG.md');
  writeFileSync(cl, '# Log\n\nnotes\n\n## 2.3 · Nov 1, 2026\n- a\n\n## 2.2 · Oct 1, 2026\n- b\n');
  execFileSync('node', [script, dir], { stdio: 'pipe', env: { ...process.env, NRN_CHANGELOG: cl } });
  assert.equal(JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')).release, '2.3');
  const none = site({}); execFileSync('node', [script, none], { stdio: 'pipe', env: { ...process.env, NRN_CHANGELOG: join(none, 'nope.md') } });
  assert.equal(JSON.parse(readFileSync(join(none, 'version.json'), 'utf8')).release, ''); rmSync(dir, { recursive: true }); rmSync(none, { recursive: true });
});
