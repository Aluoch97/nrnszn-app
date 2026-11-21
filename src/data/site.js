// Main-site navigation.
// Computers: every `nav` link shows in the top bar.
// Phones: the `tabs` show as an app-style bar along the bottom (six with More; Home is the
// bigger, raised button), and the `more` links sit under the last tab, "More".
// `also`: other pages that count as this section (highlights its tab there).

export const nav = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Services', href: '/services', icon: 'services' },
  { label: 'Media', href: '/media', icon: 'media', also: ['/gallery', '/cinema'] },
  { label: 'Events', href: '/events', icon: 'events' },
  { label: 'Apps', href: '/apps', icon: 'apps', also: ['/directory', '/play', '/vault'] },
  { label: 'About', href: '/about', icon: 'about', also: ['/support'] }, // About and Support are one page
];

export const tabs = ['/', '/media', '/events', '/apps', '/services'];
export const more = ['/about'];

// The apps on the Apps page. `inApp`: opens inside this site (full screen with a back bar).
// `accent`: the glow color of its card, taken from the app's art.
// `img`: each app's own current icon (Nov 18, 2026: copied from the apps' sites / the luoh repo (luoh was called PODI until Nov 20, 2026)).
// `home`: the app's own address. "Add to Home Screen" sends people there, because a Home Screen icon opens the
//   address it was added from (added inside nrnszn.com it would open nrnszn.com). `oneTap`: opening `home`
//   (with ?install=1) shows that app's own Install button on Android. `desktop`: built for computers first.
// `self`: this website (nrnszn.com): its sheet installs right on the page (Android one tap), like /install.
export const apps = [
  { name: 'NuRenaissance', accent: '#b07ff0', href: '/', self: true, img: '/img/apps/nrnszn-icon.webp', home: 'https://www.nrnszn.com/',
    text: 'This website as an app: Media, Events, Apps, Services and notifications, full screen and one tap from your Home Screen.' },
  { name: 'Certified', accent: '#ff6aa6', href: '/play', inApp: true, img: '/img/apps/certified-icon.webp', home: 'https://play.nrnszn.com/?install=1', oneTap: true,
    text: 'Renaissance Certified in one app: play along at the show, the show guide, and the eras, recaps and videos.' },
  { name: 'NuDirectory', accent: '#e8bb52', href: '/directory', inApp: true, img: '/img/apps/nudirectory-icon.webp', home: 'https://directory.nrnszn.com/',
    text: 'The Nashville scene board: shows, studios, session players, promo contacts and more, all in one place.' },
  { name: 'luoh', accent: '#ff8a4c', href: 'https://luoh.nrnszn.com', img: '/img/apps/luoh-icon.webp', home: 'https://luoh.nrnszn.com/',
    text: 'Multi-camera videos in a few taps: drop in every camera angle, luoh lines them up by sound, picks the shots and saves your video, right in your browser.' },
  { name: 'Soul Vault', accent: '#ef3b55', href: '/vault', inApp: true, img: '/img/apps/soul-vault-icon.webp', home: 'https://soulnicolas.com/',
    text: 'A direct-to-fan streaming space and living archive for the music of Nicólas Soul: full projects, unreleased cuts, alternate mixes, time-synced lyrics, videos and behind-the-scenes stories. Ad-free.' },
];

export const footer = [
  { label: 'About', href: '/about' },
  { label: 'Your account', href: '/account' },
  { label: 'Add to Home Screen', href: '/install' },
  { label: 'Privacy policy', href: '/privacy-policy' },
];
