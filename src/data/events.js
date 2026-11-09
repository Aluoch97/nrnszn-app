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
