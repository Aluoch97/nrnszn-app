// Main-site navigation.
// Computers: every `nav` link shows in the top bar.
// Phones: the `tabs` show as an app-style bar along the bottom, and the rest
// of `nav` sits under the last tab, "More". Keep tabs to four (plus More).
// Home sits in the middle as the bigger, raised button.

export const nav = [
  { label: 'Home', href: '/', icon: 'home' },
  { label: 'Services', href: '/services', icon: 'services' },
  { label: 'Gallery', href: '/gallery', icon: 'gallery' },
  { label: 'Cinema', href: '/cinema', icon: 'cinema' },
  { label: 'Directory', href: '/directory', icon: 'directory' },
  { label: 'Certified', href: '/play', icon: 'certified' },
  { label: 'Contact', href: '/contact', icon: 'contact' },
  { label: 'Support', href: '/support', icon: 'support' },
];

export const tabs = ['/services', '/play', '/', '/directory'];

export const footer = [
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy policy', href: '/privacy-policy' },
];
