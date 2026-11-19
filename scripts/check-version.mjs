// Stops a pull request from breaking the version list in CHANGELOG.md (the number people see comes from its newest heading).
// It fails when, compared with the branch the pull request goes into (main):
//   - the newest version is LOWER (an older copy of the changelog was merged over a newer one),
//   - the newest version is the SAME number but a different entry (two pull requests claimed the same number),
//   - a release that is on main has gone missing, or the list is out of order / repeats a number.
// Run: node <this file> origin/main [--package]   (--package: package.json "version" must equal the newest version, for PODI).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// "## 1.2 · Nov 19, 2026" or "### 3.20.1 · Nov 19, 2026". Other headings (like "## 3.x: ...") only end the entry above them.
const HEADING = /^#{2,3} (\d+\.\d+(?:\.\d+)?) ·/;

/** The releases in a changelog, newest first as written: [{ version, body }]. */
export function releases(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split("\n")) {
    const m = line.match(HEADING);
    if (m) { cur = { version: m[1], lines: [line] }; out.push(cur); }
    else if (cur) { if (/^#{1,3} /.test(line) || line.trim() === "---") cur = null; else cur.lines.push(line); }
  }
  return out.map((r) => ({ version: r.version, body: r.lines.join("\n").trim() }));
}

/** -1, 0 or 1, comparing "2.10" and "2.9.1" the way people mean it. */
export function compare(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** { ok, errors[] } for this changelog compared with the one on the branch it will be merged into. */
export function checkVersions(headText, baseText) {
  const errors = [];
  const head = releases(headText);
  const base = releases(baseText);
  if (!head.length) return { ok: false, errors: ["CHANGELOG.md has no release headings like \"## 1.2 · Nov 19, 2026\"."] };
  for (let i = 1; i < head.length; i++)
    if (compare(head[i - 1].version, head[i].version) <= 0)
      errors.push(`${head[i].version} is listed under ${head[i - 1].version}. Newest goes on top, and each number appears once.`);
  if (base.length) {
    const top = head[0], baseTop = base[0];
    const c = compare(top.version, baseTop.version);
    if (c < 0)
      errors.push(`The newest version here is ${top.version}, lower than ${baseTop.version} on main. An older copy of CHANGELOG.md may have been merged over a newer one: update this branch from main and keep main's entries.`);
    else if (c === 0 && top.body !== baseTop.body)
      errors.push(`This branch has a different entry for ${top.version}, the number main already uses. Update this branch from main and give your entry the next number.`);
    const have = new Set(head.map((r) => r.version));
    for (const r of base) if (!have.has(r.version)) errors.push(`Release ${r.version} is in main's changelog but missing here.`);
  }
  return { ok: errors.length === 0, errors };
}

function git(args) { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }

function main(argv) {
  const baseRef = argv.find((a) => !a.startsWith("--"));
  if (!baseRef) { console.error("Usage: node check-version.mjs <base ref, e.g. origin/main> [--package]"); return 2; }
  const headFile = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));
  const head = readFileSync(headFile, "utf8");
  let base = "";
  try { base = git(["show", `${baseRef}:CHANGELOG.md`]); } catch { console.log(`No CHANGELOG.md on ${baseRef} yet: nothing to compare with.`); }
  const result = checkVersions(head, base);
  const errors = [...result.errors];
  if (argv.includes("--package")) {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).version;
    const top = releases(head)[0]?.version;
    if (top && pkg !== top) errors.push(`package.json says ${pkg} but the newest changelog entry is ${top}. Run npm version so they match.`);
  }
  const top = releases(head)[0];
  if (errors.length) { console.error(`Version check FAILED (newest entry ${top ? top.version : "none"}):\n- ` + errors.join("\n- ")); return 1; }
  console.log(`Version check passed: newest entry ${top.version}` + (base ? `, main has ${releases(base)[0]?.version}.` : "."));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
