// Every page the site serves on its own carries the browser icon (the layout pages share one head in Base.astro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const has = (s) => /<link rel="icon" href="\/icons\/favicon-32\.png"/.test(s);

test('Base.astro (every normal page) has the icon', () => assert.ok(has(fs.readFileSync('src/layouts/Base.astro', 'utf8'))));
for (const f of fs.readdirSync('public/widgets').filter((n) => n.endsWith('.html'))) {
  test(`widget ${f} has the icon`, () => assert.ok(has(fs.readFileSync('public/widgets/' + f, 'utf8'))));
}
test('the unsubscribe confirmation page has the icon', () => assert.ok(has(fs.readFileSync('src/edge/survey.js', 'utf8'))));
test('the icon files exist', () => {
  for (const n of ['favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png']) assert.ok(fs.existsSync('public/icons/' + n), n);
});
