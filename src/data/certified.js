// YouTube playlists behind the Certified pages (IDs from the Wix pages).
export const yt = (id) => `https://www.youtube.com/playlist?list=${id}`;

export const P = {
  issues: 'PLVprhlbgSo1tL_a7F8XQkXTMCiIHG3k0Q',
  recaps: 'PLVprhlbgSo1vf0gygaQH3IdHpmQ3OOnd0',
  performances: 'PLVprhlbgSo1uXbiKxGMymgZJ-VkX9Jm96',
  vibe: 'PLVprhlbgSo1uMJ42ImcQy6YQo9Qx26t0i',
  heat: 'PLVprhlbgSo1umaYZ_01CxY701l0_dVRVD',
  street: 'PLVprhlbgSo1uYKUNImVgIZk0dYi0HPqjS',
  lounge: 'PLVprhlbgSo1vwwgh1yYmGGXdk754TJpGO',
  interviews: 'PLVprhlbgSo1vN-wkuvFDjabBQ85XURyTd',
  unplugged: 'PLVprhlbgSo1vx9y5sFX6Eyu6wPfRdIQEy',
  // Copied as shown on the Wix page; looks shorter than a normal playlist ID, so confirm it.
  promo: 'PLC76lyWua4z4',
  testimonials: [
    { label: 'Fall 2025', id: 'PLVprhlbgSo1tsyRw4KJUxmPhpQNB9BQAq' },
    { label: 'Spring 2025', id: 'PLVprhlbgSo1uRcOG0gCBJQVDMCGcWMc3y' },
    { label: 'Fall 2024', id: 'PLVprhlbgSo1uR_0_PpmQnZ8gdhI0Xvog1' },
    { label: 'Spring 2024', id: 'PLVprhlbgSo1txI50gMfx9J8gKshnp_2D9' },
  ],
};

// Wix's event page goes away with Wix, so "Latest showcase" points at the show guide.
export const latestShowcase = 'https://play.nrnszn.com';
