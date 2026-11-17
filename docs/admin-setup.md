# The /admin page: one-time setup

`https://www.nrnszn.com/admin` is the owner's settings page, built the same way as Soul Vault's: a password sign-in, then folders.
Nobody who is not signed in sees anything except the password box (the page is also kept out of search results).

Inside, once signed in:
- **What visitors see** and **What visitors send**: a live check of the gallery, cinema, services, latest videos, survey, recap e-mail, payment taps,
  service clicks and service requests, each marked **New** (the site itself does the job) or **Old fallback** (the previous Google script still does).
- **Backups**: whether the nightly sheet backup ran, and a **Back up now** button.
- **Setup checklist**: which secrets and connections exist (yes or no, never the value).
- **Events**: add, edit, hide and delete the events on the Events page, with a flyer picture (needs the database below).
- **Website analytics**: page views, visitors, top pages, where people come from, devices and cities for the last 7, 30 or 90 days (needs the database below).
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

## Switch on Events and Website analytics: connect the database (about 5 minutes)
Both need one small Cloudflare database. It stays empty and free until you use it; the tables are created automatically the first time they are needed.
1. Cloudflare dashboard → **Storage & databases** → **D1 SQL database** → **Create database** → name `nrnszn-db` → **Create**.
2. **Workers & Pages** → the nrnszn project → **Settings** → **Bindings** → **Add** → **D1 database** → variable name exactly `DB` → database `nrnszn-db` → **Save**.
3. **Deployments** → the latest → **⋯** → **Retry deployment**.
4. Open `/admin` → **Setup checklist**: "Site database (D1 binding)" should say **Set**. The Events and Website analytics folders now work.

## Events: how they show on the site
- Add an event with a name and a date. Everything else is optional: time, where, details, a tickets link (https), a recap video link (https), a page on this site to watch it, and a flyer picture.
- **Upcoming** events (today or later) show as cards at the top of the Events page, above the Certified Lounge show guide. **Past** events join the flyer wall, in date order, next to the older ones that were typed into the site.
- Untick **Show on the Events page** to keep an event as a draft. Changes show on the page within about a minute.
- The Certified Lounge show guide still comes from the Certified Lounge app, exactly as before. The older past events are still in the site's code.
- Flyers are made into two sizes in your browser before they are saved, so a big photo from your phone is fine.

## Website analytics: what is counted
- The site counts page views itself: **no cookies, no Google Analytics, no IP addresses stored**. The page `privacy-policy` says so.
- **Visitors** are counted once per day, on purpose: the anonymous code changes every day, so the site cannot tell it is the same person on two days (someone who visits on three days counts three times).
- Not counted: visits from you while signed in to `/admin` on that device, robots, and people who send "Do Not Track" or "Global Privacy Control".
- Counting starts the day the database is connected. Rows older than about 13 months are deleted.
- Visitor counts need `ADMIN_PASSWORD` to be set (it is part of the anonymous code's secret key). Without it, page views are still counted but visitors show 0.

## Event pages
Each event (old and new) has its own page at `/events/<name>/`. Events you add in /admin get theirs automatically; in the Events list tap **View page** to open it. A hidden (unpublished) event has no page.

## Phone notifications (optional)

1. On any computer with Node, in this project's folder, run `node scripts/make-vapid-keys.mjs`. It prints a PUBLIC key and a PRIVATE key.
2. Cloudflare dashboard > **Workers & Pages** > **nrnszn-app** > **Settings** > **Variables and Secrets** > **Add**. Make two for Production: `VAPID_PUBLIC_KEY` (the public one) and `VAPID_PRIVATE_KEY` (the private one, type **Secret**). The private key goes ONLY here.
3. **Deployments** > the newest one > **Retry deployment** (a new deploy picks up new variables).
4. Open https://www.nrnszn.com on your phone: a **Notifications** link appears in the footer (and in the More sheet). Tap it, then **Turn on notifications**. On iPhone, add the site to the Home Screen first.
5. Open /admin > **Phone notifications**: it shows how many phones are on. Write a title, tap **Send**, confirm. A notification should arrive. At most 3 can be sent per 24 hours.

