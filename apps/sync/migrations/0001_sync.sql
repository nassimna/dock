CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_by_account ON sessions(account_id);
CREATE TABLE records (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  PRIMARY KEY (account_id, item_id)
);
CREATE TABLE mutations (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  mutation_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (account_id, mutation_id)
);
CREATE TABLE changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX changes_by_account ON changes(account_id, sequence);
CREATE TRIGGER records_created AFTER INSERT ON records BEGIN
  INSERT INTO changes(account_id, item_id, version, payload)
    VALUES(NEW.account_id, NEW.item_id, NEW.version, NEW.payload);
END;
CREATE TRIGGER records_updated AFTER UPDATE ON records BEGIN
  INSERT INTO changes(account_id, item_id, version, payload)
    VALUES(NEW.account_id, NEW.item_id, NEW.version, NEW.payload);
END;
