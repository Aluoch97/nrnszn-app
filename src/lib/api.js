// One data layer for every route. All calls to Apps Script go through here,
// so moving off Apps Script later means changing only this file.

import { cleanKey, loadLatestVideos } from '../edge/latest.js';

const API_URL = import.meta.env.PUBLIC_API_URL || '';
// Build time: read the latest videos from YouTube directly when the key is available to the build; otherwise the old API below.
const YOUTUBE_KEY = cleanKey(import.meta.env.YOUTUBE_API_KEY || (typeof process !== 'undefined' ? process.env.YOUTUBE_API_KEY : ''));

export const apiConfigured = Boolean(API_URL);

async function get(action, params = {}) {
  if (!API_URL) return null;
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
}

// Apps Script web apps reject JSON preflight requests, so posts go as text/plain.
export async function post(action, payload = {}) {
  if (!API_URL) return null;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Latest interview + latest music video: { interview: Video|null, music: Video|null } */
export async function getLatestVideos() {
  if (YOUTUBE_KEY) {
    try {
      const d = await loadLatestVideos(YOUTUBE_KEY);
      return { interview: d.interview, music: d.music };
    } catch { /* fall back to the old API, then to the page's own fallback */ }
  }
  const data = await get('latestVideos');
  return {
    interview: data?.interview ?? null,
    music: data?.music ?? null,
  };
}

export { API_URL };
