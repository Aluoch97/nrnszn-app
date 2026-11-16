// Events added in /admin (src/edge/events.js) against a real SQLite database: checks, saving, editing, deleting, flyers. No network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvent, cleanFlyer, saveEvent, deleteEvent, listAll, listPublic, flyerResponse, MAX_EVENTS } from '../src/edge/events.js';
import { fakeD1 } from './_d1.mjs';

let db;
beforeEach(() => { db = fakeD1(); });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const flyer = (mime = 'png') => ({ big: `data:image/${mime};base64,${PNG}`, small: `data:image/${mime};base64,${PNG}` });
const ev = (o = {}) => ({ title: 'Certified Lounge · Winter 2027', day: '2027-02-13', time: '7–11 PM', where: 'HOME Studios · 615 Main St', details: 'A night of hip-hop and R&B.', tickets: 'https://www.nrnszn.com/support?for=ticket', video: '', watch: '', published: true, ...o });

test('an event needs a name and a real date; everything else is optional', () => {
  assert.equal(cleanEvent(ev()).ok, true);
  for (const bad of [ev({ title: '' }), ev({ title: '   ' }), ev({ day: '' }), ev({ day: '2027-02-30' }), ev({ day: '13/02/2027' }), ev({ day: '1999-01-01' }), null, 'text']) assert.equal(cleanEvent(bad).ok, false, JSON.stringify(bad));
  const min = cleanEvent({ title: 'Pop-up', day: '2027-03-01' }); assert.equal(min.ok, true); assert.equal(min.event.published, true);
  assert.equal(cleanEvent(ev({ title: 'x'.repeat(500) })).event.title.length, 120, 'long names are cut');
});

test('links must be safe: https only, and "watch" must be a page on this site (no other sites, no javascript:)', () => {
  for (const bad of [{ tickets: 'http://x.com' }, { tickets: 'javascript:alert(1)' }, { video: 'ftp://x.com' }, { video: '//evil.com' }, { watch: 'https://evil.com' }, { watch: '//evil.com' }, { watch: 'cinema' }, { watch: '/a b' }, { watch: 'javascript:alert(1)' }]) {
    assert.equal(cleanEvent(ev(bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal(cleanEvent(ev({ watch: '/cinema', video: 'https://www.youtube.com/playlist?list=ABC' })).ok, true);
});

test('saving adds an event; the public list shows only published ones, /admin shows all; newest first', async () => {
  const a = await saveEvent(db, ev({ title: 'Old one', day: '2026-01-10' })); const b = await saveEvent(db, ev({ title: 'Hidden', day: '2027-05-05', published: false })); const c = await saveEvent(db, ev({ title: 'New one' }));
  assert.ok(a.ok && b.ok && c.ok && /^[a-f0-9]{12}$/.test(c.id));
  assert.deepEqual((await listPublic(db)).map((e) => e.title), ['New one', 'Old one']);
  const all = await listAll(db); assert.deepEqual(all.map((e) => e.title), ['Hidden', 'New one', 'Old one']); assert.equal(all[0].published, false);
  const pub = (await listPublic(db))[0]; assert.deepEqual(Object.keys(pub).sort(), ['day', 'details', 'flyer', 'id', 'slug', 'time', 'title', 'tickets', 'video', 'watch', 'where'].sort());
});

test('editing changes that event only and keeps its id; an unknown or malformed id is refused', async () => {
  const { id } = await saveEvent(db, ev()); const other = await saveEvent(db, ev({ title: 'Other' }));
  const r = await saveEvent(db, { ...ev({ title: 'Renamed', published: false }), id }); assert.deepEqual([r.ok, r.id], [true, id]);
  const all = await listAll(db); assert.equal(all.find((e) => e.id === id).title, 'Renamed'); assert.equal(all.find((e) => e.id === id).published, false); assert.equal(all.find((e) => e.id === other.id).title, 'Other');
  for (const bad of ['deadbeefdead', "x'; DROP TABLE events;--", '', '../x']) { if (bad === '') continue; assert.equal((await saveEvent(db, { ...ev(), id: bad })).ok, false, bad); }
  assert.equal((await listAll(db)).length, 2);
});

test('deleting removes the event and its flyer; an unknown id is refused', async () => {
  const { id, flyer: fid } = await saveEvent(db, { ...ev(), flyer: flyer() }); assert.ok(fid);
  assert.equal((await deleteEvent(db, id)).ok, true);
  assert.equal((await listAll(db)).length, 0); assert.equal((await db.prepare('SELECT COUNT(*) n FROM event_flyers').first()).n, 0);
  assert.equal((await deleteEvent(db, id)).ok, false); assert.equal((await deleteEvent(db, 'not-an-id')).ok, false);
});

test('the text is stored exactly as typed (the page shows it as plain text), so a script tag is just words', async () => {
  const { id } = await saveEvent(db, ev({ title: '<script>alert(1)</script> Night', details: '<img src=x onerror=alert(1)>' }));
  const e = (await listPublic(db)).find((x) => x.id === id); assert.equal(e.title, '<script>alert(1)</script> Night'); assert.equal(e.details, '<img src=x onerror=alert(1)>');
});

test('flyers: stored with the event, served at both sizes with a year-long cache, replaced and removed cleanly', async () => {
  const { id, flyer: f1 } = await saveEvent(db, { ...ev(), flyer: flyer('png') });
  assert.equal((await listPublic(db))[0].flyer, f1);
  const small = await flyerResponse(db, f1, '480'), big = await flyerResponse(db, f1, '900');
  for (const r of [small, big]) { assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png'); assert.match(r.headers.get('cache-control'), /immutable/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(Buffer.from(await r.arrayBuffer()).toString('base64'), PNG); }
  const r2 = await saveEvent(db, { ...ev({ title: 'Again' }), id, flyer: flyer('webp') });
  assert.notEqual(r2.flyer, f1, 'a new picture gets a new id'); assert.equal((await flyerResponse(db, f1, '900')).status, 404, 'the old one is gone'); assert.equal((await flyerResponse(db, r2.flyer, '900')).headers.get('content-type'), 'image/webp');
  const keep = await saveEvent(db, { ...ev({ title: 'No new picture' }), id }); assert.equal(keep.flyer, r2.flyer, 'editing the text keeps the flyer');
  const gone = await saveEvent(db, { ...ev(), id, removeFlyer: true }); assert.equal(gone.flyer, ''); assert.equal((await db.prepare('SELECT COUNT(*) n FROM event_flyers').first()).n, 0);
});

test('only real small pictures are accepted as a flyer', async () => {
  for (const bad of [{ big: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', small: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, { big: `data:text/html;base64,${PNG}`, small: `data:text/html;base64,${PNG}` }, { big: `data:image/png;base64,${PNG}`, small: `data:image/jpeg;base64,${PNG}` }, { big: 'https://x.com/a.png', small: 'https://x.com/a.png' }, { big: '', small: '' }, { big: `data:image/png;base64,${'A'.repeat(700001)}`, small: `data:image/png;base64,${PNG}` }]) {
    assert.equal(cleanFlyer(bad).ok, false); const r = await saveEvent(db, { ...ev(), flyer: bad }); assert.equal(r.ok, false); assert.equal((await listAll(db)).length, 0, 'a bad flyer saves nothing, not even the event');
  }
  for (const id of ['nothing', '../../x', '', 'deadbeefdead']) assert.equal((await flyerResponse(db, id, '900')).status, 404, id);
});

test('there is a limit on how many events can be stored', async () => {
  await listAll(db);   // creates the tables
  const now = Date.now();
  for (let i = 0; i < MAX_EVENTS; i++) db.raw.prepare('INSERT INTO events (id, title, day, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(String(i).padStart(12, '0'), 't', '2027-01-01', now, now);
  const r = await saveEvent(db, ev()); assert.equal(r.ok, false); assert.match(r.error, /300 events/);
});
