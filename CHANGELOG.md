# What's new on nrnszn.com

Short version numbers: 3.0, 3.1, 3.2 ... A small change goes up by one step (3.2 to 3.3); a big redesign starts a new first number (4.0). The numbering was set to 3.0 on Nov 18, 2026 to match the work already done.
The newest version is on top, and it is the number shown in /admin (Account). The public footer no longer shows it. Write each entry in plain words for visitors and for Nick.
To release: add a new `## x.y · date` block at the top of this file in the same pull request. The site picks it up by itself.

## 3.22 · Nov 22, 2026
Terms of Use for the website and apps.
- A new **Terms** page (services and quotes, payments, events, your account, fair use) is linked in the footer next to the Privacy policy.

## 3.21 · Nov 22, 2026
- **Page videos start by themselves more often on iPhones**: the video stays visible while it loads, and it tries again to start when the page loads, when the header comes into view and when you come back to the page. One exception that no website can get around: iPhone Low Power Mode does not play any videos by themselves, so those phones see the video's still picture until you tap.
- **Videos frame themselves**: when you pick a video in /admin, the site finds where the movement and detail are and centers the header there for both phones and computers. **Find the action** does the same for a video that is already up, and the sliders still let you move it by hand.

## 3.20 · Nov 22, 2026
- **Page videos on iPhones**: the video's still picture now shows at once, and the video plays on top as soon as the phone allows it. Before, a phone that would not start videos by itself (for example in Low Power Mode) showed only the old pictures.
- New uploads leave out the hidden thumbnail track some cameras (like DJI) add, which iPhones can stumble on.

## 3.19 · Nov 22, 2026
The privacy policy is brought up to date.
- It now explains the saved copy of the site that lets pages open without internet, names Supabase (the database behind the Certified app), and a garbled sentence about account deletion is fixed.

## 3.18 · Nov 21, 2026
- **Page videos can be framed**: you can move a page's video up, down, left or right, or zoom in, so the best part stays in view on phones and computers. This can be changed any time.

## 3.17 · Nov 21, 2026
- **Page videos**: the header at the top of Home, Services, Events, Media, Apps, About and Support can play a looping video chosen in /admin. Pages without one keep their pictures. If your phone is set to reduce motion or save data, you see a still picture instead.

## 3.16 · Nov 21, 2026
The Events page works with no internet.
- If your phone can't reach the site, the Events page now shows the last list of events it saved, instead of only the older show guide. Online you always get the live list.
- Already offline-ready: the pages themselves, the Gallery, Cinema and Services lists. Not offline: flyers you hadn't opened, forms, and the live YouTube players.

## 3.15 · Nov 21, 2026
- **Your account > luoh**: each saved project has a **Remove** button (it asks first). It takes the saved edit off your account, like Delete in luoh; your videos stay on your device.

## 3.14 · Nov 21, 2026
A new layout for Your account.
- **On a computer** it works like a control panel: your name and the list of apps on the left, and the app you pick opens on the right (NuRenaissance opens first).
- **On a phone** the list comes first, and tapping an app opens its page; "‹ Your account" goes back.
- **Account settings** sits at the top, under your name and when you joined: your picture, your name, phone notifications and deleting the account.
- **Profile picture**: upload your own. It is cropped to a square and made small on your phone before it is saved, and you can remove it any time.

## 3.13 · Nov 21, 2026
Your account is now a dashboard for every NuRenaissance app.
- **One tile per app** (NuRenaissance, Certified, NuDirectory, Soul Vault, luoh), each with a quick summary: open projects and what's due, Passport stamps, listings sent and saved, saved songs, saved edits.
- **Tap a tile** to see that app's page: your **projects and payments**; your **Certified Passport** stamps with the show names; your **NuDirectory listings** (Live, Waiting for review) and saved listings; your **saved Soul Vault songs**; your **luoh projects**. Saved songs and listings can be removed right there.
- Your name card now says when you joined.

## 3.12 · Nov 21, 2026
More for your account.
- **Services:** when you are signed in, the request form fills in your name and e-mail, and your request shows up in Your account right away as **Quote requested**.
- **Your payments:** card and Apple Pay payments made with your e-mail are listed in Your account.
- **A new-look sign-in e-mail**: the NuRenaissance logo and colors, a big Sign in button, the link written out in case the button is blocked, and who sent it.
- **Pay by card** on a project with a balance: the payment is added to that project by itself, and the balance goes down. Other ways to pay (PayPal, Cash App, Venmo, Zelle) are still there.

## 3.11 · Nov 21, 2026
Footer in two rows, and notifications move to your account.
- The footer starts with **About** and **Your account** in bold; Add to Home Screen, Privacy policy and Admin sit underneath in smaller type.
- The footer **Refresh** button is gone: the "A new version is ready. Tap to update" bar does that job. (Refresh is still in /admin > Account, for troubleshooting.)
- **Phone notifications** are now turned on and off on your account page (Your account), once you are signed in, instead of from the footer. Phones that already have them on keep getting them.

## 3.10 · Nov 21, 2026
A tidier footer, and a way back into /admin if you forget the password.
- **Forgot your password?** under the admin sign-in: if your NuRenaissance account (Google) is on the admin list, you get in without the password, with one tap (or by itself when you are already signed in). It also says how to set a new password in Cloudflare.
- The bottom of every page is now in clear rows: the social icons, then the page links (About, Your account, Add to Home Screen, Privacy policy; two by two on phones), then a quiet row with Admin, Notifications and Refresh, and the copyright on its own line.

## 3.9 · Nov 21, 2026
A shorter menu, and the old Portal page is gone.
- **About** is no longer in the menu, and the phone **More** tab is gone: the bottom bar is Home, Media, Events, Apps and Services. The footer (social icons, About, Your account, Add to Home Screen, Privacy policy, Admin, Refresh) now shows at the bottom of every page on phones too.
- nrnszn.com/portal (the old link-in-bio page with the two latest videos) now opens the home page, which already has the same videos and links. Old links to it keep working.
- The "page not found" screen now leads back to the home page.

## 3.8 · Nov 21, 2026
One NuRenaissance account for every app.
- **Your account** (nrnszn.com/account, also in the footer and the More sheet): sign in with Google, or with a one-time link by e-mail (no password). One sign-in works on this site, Certified, NuDirectory, luoh and Soul Vault.
- People who already have a luoh account already have a NuRenaissance account: same e-mail, nothing to do.
- **Your projects**: clients see each project with us, its status (booked, in progress, ready for review, done), the total, what they paid and what is left, plus any note or files link.
- In /admin, a new **Clients & projects** folder: add a project for a client's e-mail, change its status, and record payments (Cash App, Zelle, PayPal, Stripe and so on). The balance updates by itself.
- The privacy policy says what an account keeps.

## 3.7 · Nov 21, 2026
PODI is now luoh.
- **luoh** (said like the name Luo, with an h) has its new name and logo on the Apps page, and opens at its new address, luoh.nrnszn.com.

## 3.6 · Nov 21, 2026
Playlist descriptions for the Certified app.
- The video list the Renaissance Certified app reads from this site now includes each YouTube playlist's description, so the app shows it under the player and picks up any edit made on YouTube.

## 3.5 · Nov 19, 2026
A way back from the version history, and a tidier Account folder.
- The What's new page now has a **← Back to admin** button at the top (and "‹ Admin" in the top bar on phones).
- In the admin page's Account folder, the version is a small line, and What's new, Refresh the app and Sign out are three full-width buttons that line up (Sign out is the quiet one). What's new used to be an underlined link in a tall, uneven box.

## 3.4 · Nov 19, 2026
The admin page has a new look, like Soul Vault's Settings.
- The folders are now in four coloured groups: **Create & send** (Events as the big card, Phone notifications), **Visitors & activity** (Website analytics, What visitors send), **Health & data** (What visitors see, Backups, Setup checklist) and **Account**.
- Every folder has an icon, and the number strip at the top has a soft glow. Nothing was removed: every folder and its contents are the same.

## 3.3 · Nov 18, 2026
The version and What's new are for the owner only.
- The footer and the phone More sheet no longer show the version number or a What's new link. You'll find both in **/admin** under **Account**.
- The What's new page stays at /whats-new for the owner, but nothing links to it and it is kept out of search results.

## 3.2 · Nov 18, 2026
Apps page: new icons and an Add to Home Screen button.
- **NuRenaissance is on the list too:** add this website to your Home Screen. On Android it's one tap (Install), right on the page.
- **Each app shows its current icon:** Certified, NuDirectory, PODI and Soul Vault.
- **Add to Home Screen** button on every app card: it shows the steps for your phone and opens the app at its own address, so the icon on your Home Screen opens the app itself. For Certified on Android it's one tap: Install.

## 3.1 · Nov 18, 2026
Notifications, an admin page, and this page.
- **Phone notifications:** tap "Notifications" in the footer to hear about new events, videos, services, gallery photos and NuCinema titles. A few a week at most.
- **Events** now has its own button in the phone tab bar; More only holds About.
- **Admin page** (for Nick): visitor numbers, events, notifications, backups and a setup checklist.
- **A new version is ready** bar: when the site updates while you have it open, a bar at the top lets you update with one tap.
- **What's new** page (this one) and a short version number in the footer.

## 3.0 · Nov 16, 2026
Everything before the version list started.
- The site on Cloudflare: Home, Media (Gallery and NuCinema), Events, Apps, Services, About.
- Event pages with flyers, tickets and recap videos that play on the page.
- Survey, Services requests and payment clicks now run on our own servers, with the old Google scripts as a backup.
- The site remembers the last copy of the Gallery, Cinema and Services on your phone so it opens fast.
- Nightly backups of the sheets, a status page and cookieless visit counting.
