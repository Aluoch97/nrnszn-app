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
