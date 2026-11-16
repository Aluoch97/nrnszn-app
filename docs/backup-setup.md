# Daily sheet backup: one-time setup

Every night the site copies your four Google Sheets (**NuRenaissance Surveys**, **NuRenaissance Payments Log**, **NuServices**, **NuCinema**) into a
**private** Cloudflare storage bucket: every tab, with formulas kept as typed. The newest 30 nightly copies are kept. If a sheet is ever deleted or
damaged, you rebuild it from a file that Google does not control. The backup only READS the sheets; it never changes them.

Until the steps below are done nothing runs and nothing breaks (`https://www.nrnszn.com/api/backup` says `"mode":"not-set-up"`).

## Set it up (about 10 minutes)

1. **Make the bucket.** Cloudflare dashboard → **R2 Object Storage** → **Create bucket** → name `nrnszn-backups` → leave **Public access OFF** → **Create bucket**.
   (It holds subscriber e-mail addresses and payment notes. Never turn on a public address for it.)
2. **Connect it to the site.** **Workers & Pages** → the nrnszn project → **Settings** → **Bindings** (or **Functions** → **R2 bucket bindings**) → **Add** →
   **R2 bucket** → variable name exactly `BACKUPS` → bucket `nrnszn-backups` → **Save**.
3. **Make up a long random password** for the job (40 random letters and numbers). Call it the backup token.
4. **Cloudflare secret:** same project → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `BACKUP_CRON_TOKEN`, value = the token → **Save**.
5. **Deployments** → the latest → **⋯** → **Retry deployment** (bindings and secrets only apply to a new deployment).
6. **GitHub secret:** the nrnszn-app repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → name `BACKUP_CRON_TOKEN`, value = the same token → **Add secret**.

## Check it
1. Open `https://www.nrnszn.com/api/backup`. It should say `"mode":"r2"` (it says `"mode":"not-set-up"` until steps 1 to 5 are done).
2. GitHub → **Actions** → **Daily sheet backup** → **Run workflow**. In a minute the log should show `"result":"saved"` with a row count for each sheet
   (`surveys`, `payments`, `services`, `cinema`). If one says `failed` or `skipped`, the reason is next to it.
3. Open `https://www.nrnszn.com/api/backup` again: it now shows `last` with the file name and time. The same information is on the `/status` page.
4. Cloudflare → **R2** → `nrnszn-backups` → you should see `sheets/<today's date>.json.gz`.

## Which key reads which sheet
The backup reuses the keys the site already has, with READ-ONLY permission: the survey key for the Surveys sheet, the payments key for the Payments Log,
and the gallery/cinema key for NuServices and NuCinema. If a key is missing or the sheet is not shared with it, that one sheet is skipped and the others are still saved.

## Getting a sheet back
Download the day's file from the R2 page (it is gzip-compressed JSON: `sheets.<name>.tabs.<tab name>` is the list of rows, formulas included).
To rebuild a sheet: make a new spreadsheet, and for each tab paste the rows back in (or ask Claude to write a small script that does it).
Google Sheets also keeps its own version history (File → Version history), which is the quickest fix for a recent mistake; this backup is for when that is not enough.

## Good to know
- The nightly run is about 3 AM Nashville time. Run it by hand any time from the Actions tab.
- If the site's survey, payments or services keys change, nothing here needs to change: it reads them from the same Cloudflare secrets.
- The files are not encrypted beyond Cloudflare's own storage encryption. Keep the bucket private.
