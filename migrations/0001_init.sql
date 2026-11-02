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

CREATE TABLE IF NOT EXISTS notifications (
  notification_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_date TEXT NOT NULL, -- YYYY-MM-DD of the notification
  notification_type TEXT NOT NULL, -- Type of the notification (e.g., 'email', 'sms')
  notification_message TEXT NOT NULL -- Message content of the notification
);

CREATE INDEX IF NOT EXISTS idx_availability_date ON availability (session_date, status);
