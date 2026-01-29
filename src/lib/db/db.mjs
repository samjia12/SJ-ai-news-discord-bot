import Database from 'better-sqlite3';

export function openDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      allowed INTEGER NOT NULL DEFAULT 0,
      channel_id TEXT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      output_language TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sent_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      item_link TEXT NOT NULL,
      published_at TEXT NULL,
      sent_at TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT NULL,
      UNIQUE(guild_id, item_key)
    );

    CREATE INDEX IF NOT EXISTS idx_sent_items_guild_sent_at
      ON sent_items(guild_id, sent_at);

    CREATE TABLE IF NOT EXISTS daily_counters (
      guild_id TEXT NOT NULL,
      date TEXT NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, date)
    );

    CREATE TABLE IF NOT EXISTS poll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      items_fetched INTEGER NOT NULL,
      items_new INTEGER NOT NULL,
      error TEXT NULL
    );
  `);
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}
