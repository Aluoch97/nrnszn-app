// No _headers rule may give a PAGE a long cache time: browsers would then keep an old copy of it (the Media page was kept a
// week because "/media/*" was meant for two video files and also matched /media/). Matching follows Cloudflare Pages: a rule
// path is literal except "*", which matches anything (including "/").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const rules = [];
let cur = null;
for (const line of (await readFile('public/_headers', 'utf8')).split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) { cur = { path: line.trim(), headers: [] }; rules.push(cur); } else if (cur) cur.headers.push(line.trim());
}
const re = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

async function pages(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) await pages(f, out);
    else if (e.name === 'index.html') out.push('/' + relative('dist', dir).split(sep).join('/') + (dir === 'dist' ? '' : '/'));
  }
  return out;
}

test('no page gets a long Cache-Control from _headers', async () => {
  const list = (await pages('dist')).map((p) => p.replace('//', '/'));
  assert.ok(list.includes('/media/'), 'the Media page is built');
  for (const p of list) {
    for (const r of rules) {
      if (!re(r.path).test(p)) continue;
      for (const h of r.headers) {
        const m = /^cache-control:\s*(.*)$/i.exec(h);
        if (!m) continue;
        const age = /max-age=(\d+)/.exec(m[1]);
        assert.ok(!age || Number(age[1]) <= 300, `${p} gets "${m[1]}" from the rule ${r.path}`);
      }
    }
  }
});
