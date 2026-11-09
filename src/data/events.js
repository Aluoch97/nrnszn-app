// Events: the next Certified Lounge comes from the show guide that the host
// edits in the Certified Lounge app (Settings → Show guide). Public data, read-only.
export const SHOW_GUIDE_URL = 'https://iimeihgrxvtuwcuyuzfh.supabase.co/functions/v1/widget?action=guide';

export async function getShowGuide() {
  try {
    const res = await fetch(SHOW_GUIDE_URL, { signal: AbortSignal.timeout(8000) });
    const r = await res.json();
    return r && r.ok ? r.data : null;
  } catch {
    return null;
  }
}

// Past events (newest first), moved over from the Wix events page.
// `day` (YYYY-MM-DD) sorts them and lets the page skip a show-guide show that is already listed here.
export const pastEvents = [
  { day: '2026-10-17', title: 'Certified Lounge · Fall 2026', when: 'Sat, Oct 17, 2026 · 7–11 PM', where: 'HOME Studios · 615 Main St G1, Nashville, TN 37206',
    img: 'certified-lounge-fall-2026', alt: 'Certified Lounge Fall 2026 flyer: Shaka D. Cakes, Yonna Jones, OhMyGvddess and Nicolas Soul',
    text: 'Certified is back! Home Studios becomes a hip-hop and R&B showcase featuring Shaka D. Cakes, Yonna Jones, OhMyGvddess and Nicolas Soul, hosted by Amore Dear and Grace Oboh with sounds by Cool The Neptune. $15 at the door. 21+.' },
  { day: '2025-11-08', title: 'Renaissance Certified · Fall 2025', when: 'Sat, Nov 8, 2025 · 7–11 PM', where: '615 Main St G1, Nashville, TN 37206',
    img: 'renaissance-certified-fall-2025', alt: 'Renaissance Certified Fall 2025 flyer: Itz Jaleel, Miles Creed, Simone J Nae, Durtyhues, Southside Mar and B King',
    text: 'Renaissance Certified: Nashville’s underground sound, sprayed bold like graffiti on the city walls!' },
  { day: '2025-04-26', title: 'Renaissance Certified · Spring 2025', when: 'Sat, Apr 26, 2025 · 7–11 PM', where: '2524 Heiman St, Nashville, TN 37208',
    img: 'renaissance-certified-spring-2025', alt: 'Renaissance Certified Spring 2025 showcase flyer: Abudadon, Taj.ai, Dante Williamson, Sadgurl, Nicolas Soul and Shawney Rainne',
    text: 'Step into Renaissance Certified, Nashville’s premier night of underground hip-hop and R&B!' },
  { day: '2024-09-28', title: 'Renaissance Certified · Fall 2024', when: 'Sat, Sep 28, 2024 · 7–10:30 PM', where: 'Solberg Studios · 1618 Jefferson St, Nashville, TN 37208',
    img: 'renaissance-certified-fall-2024', alt: 'Renaissance Certified Fall 2024 flyer: The Healers, Yonna Jones, Symbasyd, Kicks Kapri, WhoIsJordan and Myasimone',
    text: 'Experience Renaissance Certified, Nashville’s ultimate night of underground hip-hop and R&B!' },
  { day: '2024-04-06', title: 'Renaissance Certified · Spring 2024', when: 'Sat, Apr 6, 2024 · 7–11 PM', where: '1511 Jefferson St, Nashville, TN 37208',
    img: 'renaissance-certified-spring-2024', alt: 'Renaissance Certified Spring 2024 flyer: Yonna Jones, SeddyMac, Foundation Mecca, Nicolas Soul, JYou and Dimestate Don',
    text: 'Join us for a night of musical wonder as NuRenaissance & Samaria Kay present Renaissance Certified, featuring talent from the urban scene.' },
  { day: '2023-11-24', title: 'Carnelian Aura · Documentary Screening', when: 'Fri, Nov 24, 2023 · Doors 7 PM, screening 8 PM', where: '1708 Gallatin Pike N, Madison, TN 37115',
    img: 'carnelian-aura-screening', alt: 'Carnelian Aura documentary screening poster',
    text: 'An in-person screening of the docuseries “Carnelian Aura.”', watch: '/cinema' },
];
