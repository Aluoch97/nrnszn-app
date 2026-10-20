// Portal content. Links that change often (videos) come from the API;
// these are the stable ones. Edit here, push, and the site rebuilds.

export const brand = {
  name: 'NuRenaissance',
  tagline: 'Artist-first media infrastructure',
};

export const playlists = {
  interview: {
    label: 'Latest interview',
    id: 'PLVprhlbgSo1vN-wkuvFDjabBQ85XURyTd',
  },
  music: {
    label: 'Latest music video',
    id: 'PLVprhlbgSo1sfS02MFZbi3t7pCJkoy9rd',
  },
};

export const playlistUrl = (id) => `https://www.youtube.com/playlist?list=${id}`;

// Point these at app routes as each widget moves over (e.g. '/services').
export const hubLinks = [
  { label: 'Services', href: '/services', icon: 'services' },
  { label: 'Directory', href: 'https://www.nrnszn.com/directory', icon: 'directory' },
  { label: 'Certified', href: 'https://www.nrnszn.com/certified', icon: 'certified' },
];

export const socials = [
  { label: 'Website', href: 'https://www.nrnszn.com', icon: 'web' },
  { label: 'Instagram', href: 'https://www.instagram.com/nrnszn', icon: 'instagram' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@nrnszn', icon: 'tiktok' },
  { label: 'YouTube', href: 'https://www.youtube.com/@nrnszn', icon: 'youtube' },
  { label: 'Facebook', href: 'https://www.facebook.com/nrnsznllc', icon: 'facebook' },
  { label: 'Bandcamp', href: 'https://nrnszn.bandcamp.com/', icon: 'bandcamp' },
];

export const footerLinks = [
  { label: 'Contact', href: 'https://www.nrnszn.com/contact' },
  { label: 'Privacy', href: 'https://www.nrnszn.com/privacy' },
];
