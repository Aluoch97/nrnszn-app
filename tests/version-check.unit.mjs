// Tests for the version check (scripts/check-version.mjs): the mistakes it exists to catch, and that this repo's own changelog is readable by it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { releases, compare, checkVersions } from '../scripts/check-version.mjs';

const log = (...entries) => '# What\'s new\n\nSome intro.\n\n' + entries.map(([v, note]) => `## ${v} · Nov 19, 2026\n${note}\n- a line\n`).join('\n');

test('versions compare the way people mean it', () => {
  assert.equal(compare('2.10', '2.9'), 1); assert.equal(compare('5.0', '5.1'), -1); assert.equal(compare('3.20', '3.20.0'), 0); assert.equal(compare('3.22.1', '3.22.0'), 1);
});

test('a normal release passes, and so does a branch that leaves the changelog alone', () => {
  const base = log(['2.1', 'Second'], ['2.0', 'First']);
  assert.deepEqual(checkVersions(log(['2.2', 'Third'], ['2.1', 'Second'], ['2.0', 'First']), base), { ok: true, errors: [] });
  assert.equal(checkVersions(base, base).ok, true);
});

test('an older changelog merged over a newer one fails (Soul Vault 5.1 turning back into 1.1)', () => {
  const r = checkVersions(log(['1.1', 'Old'], ['1.0', 'Older']), log(['5.1', 'New'], ['5.0', 'Newer']));
  assert.equal(r.ok, false); assert.match(r.errors.join('\n'), /lower than 5\.1 on main/);
});

test('two pull requests claiming the same number fails (CERTIFIED 2.5)', () => {
  const base = log(['2.5', 'Black box fix'], ['2.4', 'Videos']);
  const r = checkVersions(log(['2.5', 'Host-only version'], ['2.4', 'Videos']), base);
  assert.equal(r.ok, false); assert.match(r.errors.join('\n'), /different entry for 2\.5/);
});

test('a missing release, a repeated number and a list out of order all fail', () => {
  const base = log(['2.2', 'C'], ['2.1', 'B'], ['2.0', 'A']);
  assert.match(checkVersions(log(['2.3', 'D'], ['2.2', 'C'], ['2.0', 'A']), base).errors.join('\n'), /Release 2\.1 is in main's changelog but missing/);
  assert.equal(checkVersions(log(['2.3', 'D'], ['2.3', 'D again'], ['2.2', 'C'], ['2.1', 'B'], ['2.0', 'A']), base).ok, false);
  assert.equal(checkVersions(log(['2.2', 'C'], ['2.3', 'D'], ['2.1', 'B'], ['2.0', 'A']), base).ok, false);
});

test('a changelog with no releases fails, and a new repository with nothing on main passes', () => {
  assert.equal(checkVersions('# nothing here', log(['1.0', 'x'])).ok, false);
  assert.equal(checkVersions(log(['1.0', 'First']), '').ok, true);
});

test('three-part numbers under other headings (PODI style) are read', () => {
  const text = '# What\'s new\n\nintro\n\n---\n\n## 3.x: Season\n\n### 3.2.1 · Nov 19, 2026\nFix.\n- x\n\n### 3.2.0 · Nov 18, 2026\nFeature.\n\n## 2.x: the rebuilt app\n\n### 2.0.0 · Oct 1, 2026\nRebuild.\n';
  assert.deepEqual(releases(text).map((r) => r.version), ['3.2.1', '3.2.0', '2.0.0']);
  assert.equal(checkVersions(text, text).ok, true);
});

test("this repository's own CHANGELOG.md is read correctly and passes against itself", () => {
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(releases(text).length >= 2, 'finds the releases');
  assert.equal(checkVersions(text, text).ok, true, JSON.stringify(checkVersions(text, text).errors));
  execFileSync('node', [new URL('../scripts/check-version.mjs', import.meta.url).pathname, 'HEAD'], { stdio: 'pipe' });   // the command-line check against the last commit
});
