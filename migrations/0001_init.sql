CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS availability (
  person_id    INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL, -- YYYY-MM-DD of the coaching session
  status       TEXT NOT NULL CHECK (status IN ('available', 'not_available')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (person_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_availability_date ON availability (session_date, status);
