// Main-site navigation.
// Computers: every `nav` link shows in the top bar.
// Phones: the `tabs` show as an app-style bar along the bottom (Home is the
// bigger, raised button), and the `more` links sit under the last tab, "More".
// `also`: other pages that count as this section (highlights its tab there).

export const nav = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Services', href: '/services', icon: 'services' },
  { label: 'Media', href: '/media', icon: 'media', also: ['/gallery', '/cinema'] },
  { label: 'Events', href: '/events', icon: 'events' },
  { label: 'Apps', href: '/apps', icon: 'apps', also: ['/directory', '/play'] },
  { label: 'Contact', href: '/contact', icon: 'contact' },
  { label: 'Support', href: '/support', icon: 'support' },
];

export const tabs = ['/', '/media', '/apps', '/services'];
export const more = ['/events', '/contact', '/support'];

// The apps on the Apps page. `inApp`: opens inside this site (full screen with a back bar).
export const apps = [
  { name: 'Certified', href: '/play', inApp: true, img: '/img/apps/certified-lounge.webp',
    text: 'Renaissance Certified in one app: play along at the show, the show guide, and the eras, recaps and videos.' },
  { name: 'NuDirectory', href: '/directory', inApp: true, img: '/img/apps/nudirectory.webp',
    text: 'The Nashville scene board: shows, studios, session players, promo contacts and more, all in one place.' },
  { name: 'PODI', href: 'http://podi.nrnszn.com', img: '/img/apps/podi.webp',
    text: 'A streamlined, browser-based media workflow tool that makes multi-camera editing simple, without heavy desktop software.' },
  { name: 'Soul Vault', href: 'https://script.google.com/macros/s/AKfycbxSXeD5uM1eP7eYR1LVzhxRfa0nx1f_DbsGHdlJeL2YfjK_8JPuurNhGAJ1W5UwwNaW/exec?s=572e3302d272', img: '/img/apps/soul-vault.webp',
    text: 'A direct-to-fan streaming space and living archive for the music of Nicólas Soul: full projects, unreleased cuts, alternate mixes, time-synced lyrics, videos and behind-the-scenes stories. Ad-free.' },
];

export const footer = [
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy policy', href: '/privacy-policy' },
];
