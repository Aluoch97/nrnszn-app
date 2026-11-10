// Runs the NuCinema Apps Script (apps-script/cinema/Code.gs) against fake Google services,
// to check the YouTube Data API calls: paging, skipping private videos, and no duplicate rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync('apps-script/cinema/Code.gs', 'utf8');

function load({ key = 'test-key', pages, rows = [] }) {
  const fetched = [];
  const sheetRows = [['VideoID', 'Title', 'Type'], ...rows];
  const sheet = {
    getDataRange: () => ({ getValues: () => sheetRows.map((r) => r.slice()) }),
    appendRow: (r) => sheetRows.push(r),
    getLastRow: () => sheetRows.length,
  };
  const ctx = {
    console, Set, Object, JSON, Error, String, Number, Array, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'YOUTUBE_API_KEY' ? key : null) }) },
    UrlFetchApp: { fetch: (url) => {
      fetched.push(url);
      const token = new URL(url).searchParams.get('pageToken') || '';
      return { getContentText: () => JSON.stringify(pages[token]) };
    } },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }),
      getUi: () => { throw new Error('no UI'); },
    },
    CacheService: { getScriptCache: () => ({ remove() {}, get() { return null; }, put() {} }) },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, fetched, sheetRows };
}

const item = (id, title, privacy = 'public') => ({ snippet: { title, resourceId: { videoId: id } }, status: { privacyStatus: privacy } });

test('reads every page of a playlist and skips private/deleted videos', () => {
  const { ctx, fetched } = load({ pages: {
    '': { items: [item('a', 'One'), item('p', 'Private video', 'private')], nextPageToken: 'T2' },
    T2: { items: [item('b', 'Two'), item('d', 'Deleted video')] },
  } });
  const out = vm.runInContext('fetchPlaylistEntries_("PL123")', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), [{ videoId: 'a', title: 'One' }, { videoId: 'b', title: 'Two' }]);
  assert.equal(fetched.length, 2);
  assert.match(fetched[0], /googleapis\.com\/youtube\/v3\/playlistItems/);
  assert.match(fetched[0], /playlistId=PL123/);
  assert.match(fetched[0], /key=test-key/);
});

test('new-upload check reads the channel uploads list once and only adds new videos', () => {
  const { ctx, fetched, sheetRows } = load({
    rows: [['old', 'Already here', 'video']],
    pages: { '': { items: [item('new1', 'Fresh'), item('old', 'Already here')], nextPageToken: 'MORE' } },
  });
  const added = vm.runInContext('checkForNewUploads()', ctx);
  assert.equal(added, 1);
  assert.equal(fetched.length, 1, 'should not page past the newest 50');
  assert.match(fetched[0], /playlistId=UUy-wvitXVh2is_RHwQBBRjQ/);
  assert.equal(sheetRows.at(-1)[0], 'new1');
  assert.equal(sheetRows.at(-1)[10], 'New');
});

test('clear message when the API key is missing', () => {
  const { ctx } = load({ key: null, pages: {} });
  const msg = vm.runInContext('testYoutubeConnection()', ctx);
  assert.match(msg, /Script properties/);
});

test('API errors are reported, not swallowed', () => {
  const { ctx } = load({ pages: { '': { error: { message: 'API key not valid' } } } });
  assert.match(vm.runInContext('testYoutubeConnection()', ctx), /API key not valid/);
});

test('no RSS feed calls left', () => {
  assert.doesNotMatch(code.replace(/^\s*\/\/.*$/gm, ''), /feeds\/videos\.xml/);
});
