# Page videos: setup

What it does: /admin > **Page videos** lets you put your own looping video at the top of Home, Services, Events, Media, Apps,
About and Support, and change or remove it any time. Your phone (or computer) makes the video small and silent before it is
uploaded (a computer size, a phone size and a still picture), so a long camera-roll video becomes a few MB.

The videos are kept in a Cloudflare storage bucket. It needs to be connected once:

## 1. Make the bucket
Cloudflare > **R2 Object Storage** > **Create bucket**
- Name: `nrnszn-media`
- Location: Automatic > **Create bucket**
- Leave it **private** (do not turn on a public address or r2.dev). The site hands the videos out itself.

## 2. Connect it to the site
Cloudflare > **Workers & Pages** > **nrnszn-app** > **Settings** > **Bindings** > **Add** > **R2 bucket**
- Variable name: `MEDIA`
- R2 bucket: `nrnszn-media` > **Save**

Then **Deployments** > latest > **⋯** > **Retry deployment**.

## 3. Check
/admin > Setup checklist > "Page videos" says **Set**, and /admin > Page videos lists the pages with **Add a video**.

## Using it
- /admin > Page videos > **Add a video** next to a page > pick a video > slide to where the loop should start > pick 8, 12, 15 or
  20 seconds > **Make and upload**. Keep the screen on while it works (a minute or two for a long phone video).
- Sideways (landscape) videos fill the header best; an upright video is cropped to fit.
- The page shows it within a minute. Visitors who asked their phone for less motion, or to save data, see the still picture.
- **Change video** replaces it (the old files are deleted). **Remove** goes back to the page's pictures (Home: the archway video).
- Making the video needs a newer browser: Chrome, or Safari on iPhone with iOS 17 or newer.

Free allowance: R2 includes 10 GB of storage and free downloads; a page video is usually 2 to 8 MB.
