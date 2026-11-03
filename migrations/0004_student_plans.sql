ALTER TABLE notifications ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE CASCADE;
CREATE INDEX idx_notifications_student_date ON notifications(person_id, notification_date);
