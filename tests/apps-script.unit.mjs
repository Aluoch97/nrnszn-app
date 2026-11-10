// Keeps the Apps Script backups safe to share: no keys, tokens or passwords in apps-script/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const files = walk('apps-script').filter((p) => /\.(gs|js|json|html)$/.test(p));

const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_\-]{30,}/, 'Google API key'],
  [/\bsk_(live|test)_[0-9A-Za-z]{10,}/, 'Stripe secret key'],
  [/\beyJ[0-9A-Za-z_\-]{20,}\.[0-9A-Za-z_\-]{20,}\./, 'JWT / Supabase service key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/hooks\.slack\.com\/services\//, 'Slack webhook'],
  [/api\.cloudflare\.com\/client\/v4\/pages\/webhooks\/deploy_hooks\/[0-9a-f-]{20,}/, 'Cloudflare deploy hook'],
  [/\b(HOST_KEY|API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*['"][^'"]{6,}['"]/i, 'hardcoded key'],
];

test('Apps Script backups exist', () => {
  assert.ok(files.some((p) => p.endsWith('Code.gs')), 'no Code.gs found in apps-script/');
});

for (const file of files) {
  test(`no secrets in ${file}`, () => {
    const text = readFileSync(file, 'utf8');
    for (const [re, label] of SECRET_PATTERNS) {
      assert.ok(!re.test(text), `${file} looks like it contains a ${label}. Move it to Script properties.`);
    }
  });
}
