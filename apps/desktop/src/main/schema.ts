export const schema = `PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'note')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  space TEXT NOT NULL CHECK (space IN ('Inbox', 'Work', 'Personal')),
  priority INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  recurrence TEXT NOT NULL DEFAULT 'none',
  linked_note_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  recurrence_source_id TEXT UNIQUE REFERENCES items(id),
  notified_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS items_due ON items(scheduled_at)
  WHERE kind = 'task' AND done = 0 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

PRAGMA user_version = 1;
`;
