// Tiny static server for the check: serves dist/ the way Cloudflare Pages does
// (folder/index.html, 404.html, and the rules in public/_redirects).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = 'dist';
const PORT = Number(process.argv[2] || 4322);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

const redirects = (await readFile(join(ROOT, '_redirects'), 'utf8').catch(() => ''))
  .split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && !p[0].startsWith('#'))
  .map(([from, to, code]) => ({ from, to, code: Number(code || 302) }));

// The `/*` block of _headers (security headers) goes on every response, so the check enforces the same CSP as production.
const globalHeaders = {};
{
  const lines = (await readFile(join(ROOT, '_headers'), 'utf8').catch(() => '')).split('\n');
  let on = false;
  for (const l of lines) {
    if (/^\/\*\s*$/.test(l)) { on = true; continue; }
    if (on && /^\S/.test(l)) break;
    const m = on && l.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m && !/^cache-control$/i.test(m[1])) globalHeaders[m[1]] = m[2].trim();
  }
}

async function file(p) { try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; } }

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rule = redirects.find((r) => r.from === path || r.from === path.replace(/\/$/, ''));
  if (rule) { res.writeHead(rule.code, { Location: rule.to, ...globalHeaders }); return res.end(); }
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  const hit = (await file(join(ROOT, safe))) || (await file(join(ROOT, safe, 'index.html'))) || (await file(join(ROOT, safe + '.html')));
  if (!hit) { res.writeHead(404, { 'Content-Type': TYPES['.html'], ...globalHeaders }); return res.end(await readFile(join(ROOT, '404.html')).catch(() => 'Not found')); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(hit)] || 'application/octet-stream', ...globalHeaders });
  res.end(await readFile(hit));
}).listen(PORT, () => console.log(`serving ${ROOT} on ${PORT}`));
