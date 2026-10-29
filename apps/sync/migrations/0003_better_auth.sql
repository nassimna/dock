-- Keep sync ownership and legacy sessions while Better Auth takes over credentials.
CREATE TABLE auth_user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE auth_account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX auth_account_provider ON auth_account(providerId, accountId);
CREATE INDEX auth_account_user ON auth_account(userId);
CREATE TABLE auth_session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  deviceName TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE
);
CREATE INDEX auth_session_user ON auth_session(userId);
CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX auth_verification_identifier ON auth_verification(identifier);

INSERT INTO auth_user(id, name, email, emailVerified, createdAt, updatedAt)
  SELECT id, email, email, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM accounts;
INSERT INTO auth_account(id, accountId, providerId, userId, password, createdAt, updatedAt)
  SELECT id, id, 'credential', id, 'rivnote-v1:' || password_salt || ':' || password_hash,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM accounts;
-- Credentials have one owner after migration; old columns must never authenticate.
UPDATE accounts SET password_hash = '', password_salt = '';

CREATE TRIGGER auth_user_sync_identity AFTER INSERT ON auth_user BEGIN
  INSERT INTO accounts(id, email, password_hash, password_salt) VALUES(NEW.id, NEW.email, '', '');
END;
