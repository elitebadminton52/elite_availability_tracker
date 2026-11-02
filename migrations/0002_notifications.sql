CREATE TABLE notifications (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_message TEXT NOT NULL CHECK (length(trim(notification_message)) BETWEEN 1 AND 2000),
  notification_date TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('camp_holiday', 'coaching_plan'))
);

CREATE INDEX idx_notifications_date ON notifications (notification_date);
