import { useEffect, useState } from 'react';
import { api, formatDate } from '../api.js';
import { notificationTypes } from '../notification-types.js';

export default function AdminNotifications({ onLogout }) {
  const [notifications, setNotifications] = useState([]);
  const [today, setToday] = useState('');
  const [type, setType] = useState('camp_holiday');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    api.getAdminNotifications()
      .then((data) => {
        if (!active) return;
        setNotifications(data.notifications);
        setToday(data.date);
        setDate(data.date);
      })
      .catch((err) => {
        if (!active) return;
        if (err.status === 401) onLogout();
        else setError(err.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onLogout]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const { notification } = await api.addNotification({
        notification_type: type,
        notification_message: message,
        notification_date: date,
      });
      setNotifications((previous) => [...previous, notification].sort((a, b) =>
        a.notification_date.localeCompare(b.notification_date) || b.notification_id - a.notification_id
      ));
      setMessage('');
      setSuccess(`Notification scheduled for ${formatDate(notification.notification_date)}.`);
    } catch (err) {
      if (err.status === 401) onLogout();
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="notification-admin" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">Camp notifications</h2>
      <p className="muted">Notices appear on the availability form on the chosen date, in the camp timezone.</p>
      <form onSubmit={submit}>
        <label className="label" htmlFor="notification-type">Notification type</label>
        <select id="notification-type" className="input" value={type} onChange={(e) => setType(e.target.value)} required disabled={busy}>
          {Object.entries(notificationTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="label" htmlFor="notification-message">Message</label>
        <textarea id="notification-message" className="input" rows={4} maxLength={2000}
          value={message} onChange={(e) => setMessage(e.target.value)} required disabled={busy} />
        <label className="label" htmlFor="notification-date">Display date</label>
        <input id="notification-date" className="input" type="date" min={today || undefined}
          value={date} onChange={(e) => setDate(e.target.value)} required disabled={busy} />
        <button className="btn btn-primary full" disabled={loading || busy || !message.trim() || !date}>
          {busy ? 'Saving notification…' : 'Set notification'}
        </button>
      </form>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}
      <h2 className="list-header">Scheduled notifications</h2>
      {loading ? <p className="muted">Loading notifications…</p> : notifications.length === 0 ?
        <p className="muted">{error ? 'Unable to load notifications. Reload to try again.' : 'No notifications scheduled.'}</p> :
        notifications.map((notice) => (
          <article className={`camp-notice camp-notice-${notice.notification_type}`} key={notice.notification_id}>
            <strong>{notificationTypes[notice.notification_type]} - {formatDate(notice.notification_date)}</strong>
            <p>{notice.notification_message}</p>
          </article>
        ))}
    </section>
  );
}
