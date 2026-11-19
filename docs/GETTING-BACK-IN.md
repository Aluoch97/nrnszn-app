# Getting back in: NuRenaissance site (www.nrnszn.com)

Plain steps for the day something goes wrong. **None of this has been rehearsed end to end**; where a step has never been tried it says so.

## Where everything lives
- **The site:** Astro on Cloudflare Pages project `nrnszn-app`; `app.nrnszn.com` serves the same site. Merging into `main` publishes it; a branch gets a preview at `<branch>.nrnszn-app.pages.dev`.
- **Admin:** `www.nrnszn.com/admin`. Switches on only when the Cloudflare secret `ADMIN_PASSWORD` (10+ characters) exists.
- **Data:** D1 binding `DB` (events, analytics, phone-notification sign-ups). Nightly sheet copies go to the private R2 bucket bound as `BACKUPS`.
- **Google Apps Script / Sheets:** survey, services, NuCinema, NuGallery, payments. Some run at the edge with Google service accounts; Apps Script is the fallback.
- **Secrets** (names only; Cloudflare > nrnszn-app > Settings > Variables and Secrets): `ADMIN_PASSWORD`, `YOUTUBE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `PAYMENTS_SERVICE_ACCOUNT_JSON`, `SURVEY_SERVICE_ACCOUNT_JSON`, `SERVICES_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `SURVEY_UNSUB_SECRET`, `RECAP_CRON_TOKEN`, `BACKUP_CRON_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. The two cron tokens are also GitHub secrets.

## I can't sign in to /admin
1. Five wrong passwords lock that address for **15 minutes** (counted per Cloudflare data centre, so approximate).
2. Forgotten: set a new `ADMIN_PASSWORD` in Cloudflare and redeploy (Deployments > Retry). Changing it signs every device out. (Not rehearsed.)

## A deploy broke the site
Cloudflare > Workers & Pages > nrnszn-app > Deployments > last good one > Rollback. Then fix it in GitHub. The "Site down alert" workflow emails you if the site stops answering.

## A feed or form stopped working
Run the "Backend check" workflow (Actions tab). It says which backend is down. Most feeds fall back to Apps Script on their own.

## Backups
`backup-daily.yml` copies every tab of the Surveys, Payments Log, NuServices and NuCinema sheets nightly (needs the `BACKUPS` bucket and `BACKUP_CRON_TOKEN`; until then `/api/backup` says "not-set-up"). Restore notes: `docs/backup-setup.md`. A restore has not been rehearsed. The events database in D1 is **not** in these backups.
