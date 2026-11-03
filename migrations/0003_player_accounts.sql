ALTER TABLE people ADD COLUMN name_lookup TEXT;
CREATE UNIQUE INDEX idx_people_name_lookup ON people(name_lookup);

CREATE TABLE user_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  username_lookup TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  person_id INTEGER UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status != 'approved' OR person_id IS NOT NULL)
);

CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_user_sessions_account ON user_sessions(account_id);
CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE auth_requests (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE auth_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
