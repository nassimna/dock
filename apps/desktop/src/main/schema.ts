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

export const syncSchema = `
CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_items (
  item_id TEXT PRIMARY KEY REFERENCES items(id),
  remote_version INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 1,
  mutation_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
);
CREATE TABLE IF NOT EXISTS sync_conflicts (item_id TEXT PRIMARY KEY REFERENCES items(id));
INSERT OR IGNORE INTO sync_items(item_id) SELECT id FROM items;
CREATE TRIGGER IF NOT EXISTS sync_item_created AFTER INSERT ON items
  WHEN NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying_remote') BEGIN
    INSERT INTO sync_items(item_id) VALUES(NEW.id);
  END;
CREATE TRIGGER IF NOT EXISTS sync_item_updated
  AFTER UPDATE OF title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, deleted_at ON items
  WHEN NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying_remote') BEGIN
    UPDATE sync_items SET dirty = 1, mutation_id = lower(hex(randomblob(16))) WHERE item_id = NEW.id;
  END;
PRAGMA user_version = 2;
`;

export const notesSchema = `
ALTER TABLE items ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE items ADD COLUMN note_style TEXT NOT NULL DEFAULT '{}';
DROP TRIGGER sync_item_updated;
CREATE TRIGGER sync_item_updated
  AFTER UPDATE OF title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, deleted_at, tags, note_style ON items
  WHEN NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying_remote') BEGIN
    UPDATE sync_items SET dirty = 1, mutation_id = lower(hex(randomblob(16))) WHERE item_id = NEW.id;
  END;
PRAGMA user_version = 3;
`;

export const tasksSchema = `
ALTER TABLE items ADD COLUMN task_properties TEXT NOT NULL DEFAULT '{}';
ALTER TABLE items ADD COLUMN completed_at TEXT;
UPDATE items SET task_properties = '{"priority":1}' WHERE priority = 1;
UPDATE items SET completed_at = updated_at WHERE done = 1;
DROP TRIGGER sync_item_updated;
CREATE TRIGGER sync_item_updated
  AFTER UPDATE OF title, body, space, priority, done, scheduled_at, recurrence, linked_note_id, deleted_at, tags, note_style, task_properties, completed_at ON items
  WHEN NOT EXISTS (SELECT 1 FROM sync_meta WHERE key = 'applying_remote') BEGIN
    UPDATE sync_items SET dirty = 1, mutation_id = lower(hex(randomblob(16))) WHERE item_id = NEW.id;
  END;
PRAGMA user_version = 4;
`;
