// Main-site navigation. Pages that haven't moved into the app yet still point
// at the Wix site; switch each href to its app path (e.g. '/gallery') as it moves.

const WIX = 'https://www.nrnszn.com';

export const nav = [
  { label: 'Home', href: `${WIX}/` },
  { label: 'Services', href: '/services-apply' },
  { label: 'Gallery', href: '/gallery' },
  { label: 'Cinema', href: `${WIX}/cinema` },
  { label: 'Certified', href: `${WIX}/certified` },
  { label: 'Directory', href: 'https://directory.nrnszn.com' },
  { label: 'Contact', href: `${WIX}/contact` },
  { label: 'Support', href: '/support' },
];

export const footer = [
  { label: 'Contact', href: `${WIX}/contact` },
  { label: 'Privacy policy', href: `${WIX}/privacy-policy` },
];
