# The /admin page: one-time setup

`https://www.nrnszn.com/admin` is the owner's settings page, built the same way as Soul Vault's: a password sign-in, then folders.
Nobody who is not signed in sees anything except the password box (the page is also kept out of search results).

Inside, once signed in:
- **What visitors see** and **What visitors send**: a live check of the gallery, cinema, services, latest videos, survey, recap e-mail, payment taps,
  service clicks and service requests, each marked **New** (the site itself does the job) or **Old fallback** (the previous Google script still does).
- **Backups**: whether the nightly sheet backup ran, and a **Back up now** button.
- **Setup checklist**: which secrets and connections exist (yes or no, never the value).
- **Account**: **Sign out on this device**, **Refresh the app**, and the site version.

## Switch it on (about 3 minutes)
1. Make up a long password (at least 10 characters). A few random words works well. Keep it in your password manager.
2. Cloudflare → **Workers & Pages** → the nrnszn project → **Settings** → **Variables and Secrets** → **Add** → type **Secret**,
   name exactly `ADMIN_PASSWORD`, value = your password → **Save**.
3. **Deployments** → the latest → **⋯** → **Retry deployment** (secrets only apply to a new deployment).
4. Open `https://www.nrnszn.com/admin`, type the password, **Sign in**. You stay signed in on that device for 30 days.

Until step 2 and 3 are done the page says "Sign-in is not set up yet" and explains how.

## Good to know
- **Changing the password signs every device out.** Change `ADMIN_PASSWORD` in Cloudflare and retry the deployment.
- **Five wrong passwords from one address lock that address out for 15 minutes.** The counter lives in Cloudflare's memory, so it slows guessing down rather than stopping it completely: use a long password.
- **Sign out on a shared or borrowed device** with Account → **Sign out on this device**.
- The page can only read; the one thing it can do is **Back up now** (which only reads your sheets and writes a copy to the private backup bucket).
- The page never shows a secret's value, only whether it is set.
