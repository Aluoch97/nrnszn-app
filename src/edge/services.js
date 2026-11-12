// The Services page data (prices, tiers, bundles) read from the NuServices Google Sheet at the edge (Cloudflare Pages Functions),
// replacing getData() in the Apps Script (apps-script/services/Code.gs) with the same answer, rule for rule:
//   { services: [ { id, name, icon, tag, description, clicks, pricingModel, hourlyRate, facilityHourlyRate, minHours, pageRate, deposit,
//                   depositCredited, musicVideoDeposit, tiers, startingPrice, mostBooked } ], bundles: [ ... ] }
// The Sheet stays where you edit prices. It is read with the read-only Google SERVICE ACCOUNT (Cloudflare secret
// GOOGLE_SERVICE_ACCOUNT_JSON, the same one the gallery and cinema use); the NuServices sheet must be shared with its e-mail (Viewer).
// NOT moved (and not meant to move): booking a consultation (Google Calendar invite + Meet link), the Gmail confirmations, invoices and
// recap drafts, and the 30-minute invoice timer. Those use your own Google account's Calendar and Gmail, so they stay in Apps Script.
import { parseServiceAccount, getAccessToken, SHEETS_SCOPE } from './google.js';

export const SERVICES_SHEET_ID = '1m1XHSKW7P3QUl_EvVCi_V7kD5RamJevEIESjpYK-JpE'; // the "NuServices" spreadsheet (an address, not a secret)
export const TABS = ['Services', 'Service_Tiers', 'Bundles'];

// Columns are looked up BY HEADER NAME, like rowToObj in Code.gs. Google trims empty cells at the end of a row (Apps Script never did),
// so a missing cell counts as "" and a header that is not in the sheet (the live Services tab has no MusicVideoDeposit) simply reads as empty.
function rowToObj(header, row) {
  const obj = {};
  header.forEach((key, i) => { obj[key] = row[i] === undefined || row[i] === null ? '' : row[i]; });
  return obj;
}
function split(values, tab) {
  if (!values || !values.length) throw new Error(`the ${tab} tab is empty`); // the old script failed here too (and answered with an error)
  const [header, ...rows] = values;
  return { header, rows };
}

/** The Services-page data from the rows of the three tabs (each: the header row, then the data rows). */
export function buildServicesData(servicesValues, tiersValues, bundlesValues) {
  const { header: servicesHeader, rows: servicesRows } = split(servicesValues, 'Services');
  const { header: tiersHeader, rows: tiersRows } = split(tiersValues, 'Service_Tiers');
  const { header: bundlesHeader, rows: bundlesRows } = split(bundlesValues, 'Bundles');

  const tiersByService = {};
  tiersRows.forEach((row) => {
    const t = rowToObj(tiersHeader, row);
    if (!t.ServiceID) return;
    if (!tiersByService[t.ServiceID]) tiersByService[t.ServiceID] = [];
    tiersByService[t.ServiceID].push({
      name: t.TierName,
      price: Number(t.Price) || 0,
      deposit: Number(t.Deposit) || 0,
      depositCredited: String(t.DepositCredited).toLowerCase() === 'yes',
      description: t.TierDescription,
      sortOrder: Number(t.SortOrder) || 0,
    });
  });
  Object.keys(tiersByService).forEach((id) => { tiersByService[id].sort((a, b) => a.sortOrder - b.sortOrder); });

  const services = servicesRows
    .map((row) => {
      const s = rowToObj(servicesHeader, row);
      if (!s.ID) return null;
      const tiers = tiersByService[s.ID] || [];
      const model = s.PricingModel || 'package';
      const hourlyRate = Number(s.HourlyRate) || 0;
      const facilityHourlyRate = Number(s.FacilityHourlyRate) || 0;
      const minHours = Number(s.MinHours) || 1;
      const pageRate = Number(s.PageRate) || 0;
      const deposit = Number(s.Deposit) || 0;
      const depositCredited = String(s.DepositCredited).toLowerCase() === 'yes';
      const musicVideoDeposit = Number(s.MusicVideoDeposit) || 0;

      let startingPrice = 0;
      if (model === 'package') {
        startingPrice = tiers.length ? tiers[0].price + tiers[0].deposit : 0;
      } else if (model === 'hourly') {
        startingPrice = hourlyRate * minHours + deposit;
      } else if (model === 'hourly_plus_edit') {
        const cheapestEdit = tiers.length ? tiers[0].price : 0;
        startingPrice = hourlyRate * minHours + cheapestEdit + deposit;
      } else if (model === 'per_page') {
        startingPrice = pageRate + deposit;
      }

      return {
        id: String(s.ID),
        name: s.Name,
        icon: s.Icon,
        tag: s.Tag,
        description: s.Description,
        clicks: Number(s.Clicks) || 0,
        pricingModel: model,
        hourlyRate,
        facilityHourlyRate,
        minHours,
        pageRate,
        deposit,
        depositCredited,
        musicVideoDeposit,
        tiers,
        startingPrice,
      };
    })
    .filter(Boolean);

  const maxClicks = services.reduce((m, s) => Math.max(m, s.clicks), 0);
  services.forEach((s) => { s.mostBooked = maxClicks > 0 && s.clicks === maxClicks; });

  const bundles = bundlesRows
    .map((row) => {
      const b = rowToObj(bundlesHeader, row);
      if (!b.BundleID) return null;
      return {
        id: String(b.BundleID),
        name: b.Name,
        requiredServiceIds: String(b.RequiredServiceIDs || '').split(',').map((x) => x.trim()).filter(Boolean),
        description: b.Description,
        price: Number(b.Price) || 0,
      };
    })
    .filter(Boolean);

  return { services, bundles };
}

/** The three tabs' rows in one request, numbers kept as numbers like Apps Script's getValues. */
export async function readServicesRows(token, sheetId = SERVICES_SHEET_ID) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(sheetId)) throw new Error('bad services sheet id');
  const q = new URLSearchParams();
  TABS.forEach((t) => q.append('ranges', t));
  q.set('valueRenderOption', 'UNFORMATTED_VALUE'); q.set('majorDimension', 'ROWS');
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${q}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Sheets answered ${res.status}`); // never cached: the last good copy keeps being served
  const data = await res.json();
  return TABS.map((_, i) => (data.valueRanges && data.valueRanges[i] && data.valueRanges[i].values) || []);
}

/** Sign in and read the prices. `secret` is the GOOGLE_SERVICE_ACCOUNT_JSON text. */
export async function loadServices(secret, sheetId = SERVICES_SHEET_ID) {
  const token = await getAccessToken(parseServiceAccount(secret), Date.now(), SHEETS_SCOPE);
  const [services, tiers, bundles] = await readServicesRows(token, sheetId);
  return buildServicesData(services, tiers, bundles);
}
