# NuRenaissance site (nrnszn.com)

Astro static site on Cloudflare Pages. Main address: www.nrnszn.com (app.nrnszn.com serves the same site).
Owner: Nick (NuRenaissance Media). He reviews on his phone, so mobile comes first.

## Before every push
- Run `npm run check` (build + Playwright + axe at 320 / 390 / 768 / 1280 px). It must pass.
  Locally in a container with a preinstalled browser: `PW_CHROMIUM=/path/to/chrome npm run check`.
- GitHub Actions runs the same check on every push and pull request (`.github/workflows/site-check.yml`).
- Push work to a branch, not `main`. Cloudflare builds a preview at `<branch>.nrnszn-app.pages.dev`;
  `main` is production. Only merge/push to `main` when Nick says so.

## Mobile rules (the check enforces these)
- No sideways scrolling at 320px wide. Use `minmax(0, 1fr)` grid columns and `min-width: 0` on flex/grid children.
- Tap targets at least 24×24px (aim for 44px) on buttons, menu links and footer links.
- Body text 14px+, nothing under 11px.
- Text on colored buttons must pass WCAG AA contrast (white on pink uses #c8175f, not the lighter pinks).
- Exactly one `<h1>` per page (use `class="sr-only"` if the design has no visible one), plus title and description.
- Large images get a smaller `srcset` version for phones.

## Where things live
- Pages: `src/pages/*.astro`. Main-site pages use `src/layouts/Site.astro` (dark header menu + footer).
- Menu and footer links: `src/data/site.js`.
- Original widgets (Gallery, Cinema, Services, Support, Survey) are served from `public/widgets/` inside a
  frame via `src/components/WidgetFrame.astro`. Keep widget files as delivered; only make targeted fixes.
- Colors, fonts, spacing: `src/styles/tokens.css`. Fonts are self-hosted via @fontsource (no Google Fonts).
- Old Wix URLs: keep the same paths, or add a redirect in `public/_redirects`.
- Backends are Google Apps Script web apps (URLs inside each widget and `src/data/*.js`); never commit API keys.
- Moving off Apps Script, one backend at a time (strangler style: the new edge code is preferred when its secret exists, the old backend stays the fallback until Nick has checked it live). First done: the site API's **latest videos** (`src/edge/latest.js`, feed `/api/feed/latest`, tests in `tests/latest.unit.mjs`); it uses the Cloudflare secret `YOUTUBE_API_KEY`, the same one `/api/playlist` uses. The Apps Script `Code.gs` (Portal API) and `PUBLIC_API_URL` can be retired after checking `/api/feed/latest` answers from YouTube.
- Second done: **NuGallery** read from Google Drive at the edge (`src/edge/gallery.js`, feed `/api/feed/gallery`, tests in `tests/gallery.unit.mjs`). Same rules as `apps-script/gallery/Code.gs` (folder structure, `cover_` file, credit | Instagram | video in a folder's Description, Certified newest-season-first, Nashville dates). Needs the Cloudflare secret `GOOGLE_SERVICE_ACCOUNT_JSON` (a read-only Google service account's JSON key; setup in `docs/gallery-drive-setup.md`) and the NuGallery folder shared with that account. The feed adds `"source": "drive"` when Drive answered; with no secret, or if Drive fails, the old Apps Script answers. Photos still go through `/api/drive`.
- Third done: the **NuCinema catalog** read from its Google Sheet at the edge (`src/edge/cinema.js`, feed `/api/feed/cinema`, shared Google sign-in in `src/edge/google.js`, tests in `tests/cinema.unit.mjs`). Same secret as the gallery; the NuCinema sheet must also be shared with the service account (Viewer) and the Google Sheets API enabled (`docs/cinema-sheet-setup.md`). Columns are read BY POSITION like `Code.gs` (the live header row has no `ShowTitle` label). `tests/cinema.unit.mjs` runs the real `Code.gs` `doGet` as an oracle (realistic sheet + 300 random sheets, identical JSON required); keep it passing if the sheet layout changes. The feed adds `"source": "sheet"`. What stays in Apps Script for the cinema: the Sheet's **Cinema Admin** menu (new-upload check, episode imports); it writes rows into the Sheet, which the edge then reads.
- Fourth done: the **payment-click logger** (`/api/payment` = `functions/api/payment.js`, `src/edge/payments.js`, tests in `tests/payments.unit.mjs`). It WRITES, so it has its own opt-in secret `PAYMENTS_SERVICE_ACCOUNT_JSON` (a separate service account shared on the Payments Log sheet as Editor; the read-only `GOOGLE_SERVICE_ACCOUNT_JSON` is deliberately never used for writes). Without it the click is forwarded to the Apps Script. A click goes to exactly one backend: if a write times out and it is unknown whether the row was saved, it is NOT retried elsewhere (no double-logged payments). The widget (`public/widgets/support.html`) posts to `/api/payment` first and only falls back to its Apps Script URL if that request cannot be made. `tests/payments.unit.mjs` runs the real `Code.gs` `doPost` as an oracle on 300 random payloads; keep the token/URL/sheet-id copies in step (a test checks them). Setup: `docs/payments-sheet-setup.md`.
