// The daily sheet backup (src/edge/backup.js) against a fake Google and a fake R2 bucket: no network.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { handleBackup, backupStatus, runBackup, backupReady, sources, KEEP_BACKUPS } from '../src/edge/backup.js';
import { forgetToken } from '../src/edge/google.js';

let pem, sheetsCalls, tokenScopes, signinOk, failSheet, bucket;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
});
const account = (name) => JSON.stringify({ client_email: `${name}@nrn.iam.gserviceaccount.com`, private_key: pem });

// a tiny fake R2 bucket
function fakeBucket() {
  const files = new Map();
  return {
    files,
    put: async (key, body, opts = {}) => { files.set(key, { body, size: body.length, uploaded: new Date('2026-11-16T08:41:00Z'), meta: opts.customMetadata || {}, type: opts.httpMetadata && opts.httpMetadata.contentType }); },
    delete: async (key) => { files.delete(key); },
    list: async ({ prefix = '' } = {}) => ({ objects: [...files.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.size, uploaded: v.uploaded })), truncated: false }),
  };
}

beforeEach(() => {
  forgetToken(); sheetsCalls = []; tokenScopes = []; signinOk = true; failSheet = null; bucket = fakeBucket();
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.href === 'https://oauth2.googleapis.com/token') {
      if (!signinOk) return json({ error: 'bad' }, 400);
      const claims = JSON.parse(Buffer.from(new URLSearchParams(String(init.body)).get('assertion').split('.')[1], 'base64url').toString());
      tokenScopes.push(claims.scope);
      return json({ access_token: 'tok-' + claims.iss.split('@')[0], expires_in: 3600 });
    }
    if (u.hostname === 'sheets.googleapis.com') {
      const id = u.pathname.split('/')[3];
      sheetsCalls.push({ id, path: u.pathname, auth: init.headers.authorization, query: Object.fromEntries(u.searchParams) });
      if (failSheet === id) return json({ error: { message: 'no access' } }, 403);
      if (u.pathname.endsWith('values:batchGet')) {
        const ranges = u.searchParams.getAll('ranges');
        return json({ valueRanges: ranges.map((r) => ({ range: r, values: [['header', 'two'], [`row of ${id.slice(0, 4)}`, '=SUM(A1:A2)']] })) });
      }
      return json({ sheets: [{ properties: { title: 'Responses' } }, { properties: { title: "Owner's notes" } }] });
    }
    throw new Error('unexpected fetch ' + u);
  };
});

const env = () => ({ BACKUPS: bucket, BACKUP_CRON_TOKEN: 'long-secret-token', SURVEY_SERVICE_ACCOUNT_JSON: account('survey'), PAYMENTS_SERVICE_ACCOUNT_JSON: account('payments'), GOOGLE_SERVICE_ACCOUNT_JSON: account('reader') });
const post = (headers = {}, e = env()) => handleBackup({ request: new Request('https://www.nrnszn.com/api/backup', { method: 'POST', headers }), env: e });
const auth = { authorization: 'Bearer long-secret-token' };
const readFile = (key) => JSON.parse(zlib.gunzipSync(Buffer.from(bucket.files.get(key).body)).toString());

test('it is off until BOTH the bucket and the secret exist, and says so', async () => {
  assert.equal(backupReady({}), false); assert.equal(backupReady({ BACKUPS: bucket }), false); assert.equal(backupReady({ BACKUP_CRON_TOKEN: 'x' }), false);
  assert.equal(backupReady(env()), true);
  const res = await post(auth, { BACKUP_CRON_TOKEN: 'long-secret-token' }); assert.equal(res.status, 503);
  const st = await (await backupStatus({})).json(); assert.equal(st.mode, 'not-set-up');
});

test('only the right token can run it', async () => {
  for (const h of [{}, { authorization: 'Bearer nope' }, { authorization: 'Bearer long-secret-token-and-more' }, { authorization: 'Bearer long-secret-toke' }]) {
    const res = await post(h); assert.equal(res.status, 401); assert.equal(bucket.files.size, 0, 'nothing is saved without the token');
  }
});

test('a run saves one gzip file with every tab of every sheet, formulas kept, using read-only permission', async () => {
  const res = await post(auth), out = await res.json();
  assert.equal(res.status, 200); assert.equal(out.result, 'saved');
  assert.deepEqual(Object.keys(out.saved).sort(), ['cinema', 'payments', 'services', 'surveys']);
  const file = readFile(out.file); assert.match(out.file, /^sheets\/\d{4}-\d{2}-\d{2}\.json\.gz$/);
  assert.equal(file.version, 1);
  const tabs = file.sheets.surveys.tabs; assert.deepEqual(Object.keys(tabs), ['Responses', "Owner's notes"]);
  assert.equal(tabs.Responses[1][1], '=SUM(A1:A2)', 'formulas are stored as typed');
  assert.ok(tokenScopes.length >= 3 && tokenScopes.every((s) => s === 'https://www.googleapis.com/auth/spreadsheets.readonly'), 'every sign-in asks for read-only: ' + tokenScopes);
  assert.ok(sheetsCalls.every((c) => c.query.valueRenderOption === 'FORMULA' || !c.path.includes('batchGet')), 'cells are read as typed');
  const ranges = sheetsCalls.filter((c) => c.path.endsWith('batchGet'))[0];
  assert.ok(ranges, 'the tabs were read in one batch per sheet');
});

test('the response never contains sheet data, only counts', async () => {
  const text = await (await post(auth)).text();
  assert.ok(!text.includes('row of') && !text.includes('SUM('), 'no cell contents in the answer: ' + text.slice(0, 200));
});

test('a sheet that cannot be read is reported and skipped, the others are still saved', async () => {
  const e = env(); const pay = sources(e).find((s) => s.name === 'payments'); failSheet = pay.sheetId;
  const out = await (await post(auth, e)).json();
  assert.equal(out.result, 'partial'); assert.ok(out.failed.payments, 'payments is reported as failed'); assert.ok(out.saved.surveys && out.saved.services && out.saved.cinema);
  assert.ok(!('payments' in readFile(out.file).sheets), 'the failed sheet is not in the file');
});

test('a sheet with no key on the site is skipped with a reason, not an error', async () => {
  const e = env(); delete e.PAYMENTS_SERVICE_ACCOUNT_JSON;
  const out = await (await post(auth, e)).json();
  assert.equal(out.result, 'saved'); assert.match(out.skipped.payments, /no key/);
});

test('if nothing at all could be read, nothing is saved and the run says so (502)', async () => {
  signinOk = false;
  const res = await post(auth); assert.equal(res.status, 502); assert.equal((await res.json()).result, 'nothing-saved'); assert.equal(bucket.files.size, 0);
});

test('running twice on one day replaces that day\'s file; only the newest ' + KEEP_BACKUPS + ' are kept', async () => {
  for (let d = 1; d <= 34; d++) await runBackup(env(), new Date(Date.UTC(2026, 9, d, 8, 41)));   // Oct 1 .. Nov 3
  assert.equal(bucket.files.size, KEEP_BACKUPS);
  const keys = [...bucket.files.keys()].sort(); assert.equal(keys[0], 'sheets/2026-10-05.json.gz'); assert.equal(keys.at(-1), 'sheets/2026-11-03.json.gz');
  await runBackup(env(), new Date(Date.UTC(2026, 10, 3, 20, 0)));
  assert.equal(bucket.files.size, KEEP_BACKUPS, 'the same day is replaced, not added');
});

test('the status says when the last backup was made, without any data', async () => {
  await post(auth);
  const st = await (await backupStatus(env())).json();
  assert.equal(st.mode, 'r2'); assert.match(st.last.file, /^sheets\//); assert.equal(st.last.kept, 1); assert.equal(st.last.at, '2026-11-16T08:41:00.000Z');
  assert.deepEqual(Object.keys(st).sort(), ['last', 'message', 'mode', 'status']);
});
