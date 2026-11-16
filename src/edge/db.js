// The site's small Cloudflare D1 database (binding `DB`): events added in /admin, their flyer pictures, and the cookieless page-view counts.
// The tables are created the first time they are needed, so connecting an empty database (docs/admin-setup.md) is all the setup there is.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, day TEXT NOT NULL,
    time_text TEXT NOT NULL DEFAULT '', where_text TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '',
    tickets_url TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL DEFAULT '', watch_path TEXT NOT NULL DEFAULT '',
    flyer_id TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events (day)`,
  `CREATE TABLE IF NOT EXISTS event_flyers (id TEXT PRIMARY KEY, mime TEXT NOT NULL, big TEXT NOT NULL, small TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS page_views (
    ts INTEGER NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL DEFAULT '', device TEXT NOT NULL,
    ref TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS page_views_day ON page_views (day)`,
  `CREATE INDEX IF NOT EXISTS page_views_visitor ON page_views (visitor, ts)`,
];

const done = new WeakSet();
export const hasDb = (env) => !!(env && env.DB && typeof env.DB.prepare === 'function');
export async function ensureDb(db) {
  if (done.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  done.add(db);
}
export const forgetSchema = () => { /* WeakSet entries go away with their database object; this exists so tests can start clean */ };
