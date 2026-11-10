// Turns an Apps Script export (Drive export as application/vnd.google-apps.script+json)
// into plain files: Code.gs, other .gs/.html files, and appsscript.json.
// Usage: node scripts/apps-script-unpack.mjs <export.json | export.b64> <out-folder>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('Usage: node scripts/apps-script-unpack.mjs <export.json|.b64> <out-folder>');
  process.exit(1);
}
let text = readFileSync(src, 'utf8').trim();
if (!text.startsWith('{')) text = Buffer.from(text, 'base64').toString('utf8');
const { files } = JSON.parse(text);
const ext = { server_js: '.gs', html: '.html', json: '.json' };
mkdirSync(out, { recursive: true });
for (const f of files) {
  const name = f.name + (ext[f.type] || '.txt');
  const body = f.source.endsWith('\n') ? f.source : f.source + '\n';
  writeFileSync(join(out, name), body);
  console.log('wrote', join(out, name));
}
