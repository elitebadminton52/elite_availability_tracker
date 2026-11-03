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
  const [tomorrow, setTomorrow] = useState('');
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState('');
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    let active = true;
    api.getAdminNotifications()
      .then((data) => {
        if (!active) return;
        setNotifications(data.notifications);
        setToday(data.date);
        setTomorrow(data.tomorrow);
        setPeople(data.people);
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
      const payload = {
        notification_type: type,
        notification_message: message,
        notification_date: date,
        person_id: type === 'coaching_plan' ? Number(personId) : null,
      };
      const { notification } = editingId ?
        await api.updateNotification(editingId, payload) : await api.addNotification(payload);
      setNotifications((previous) => [...previous.filter((notice) => notice.notification_id !== notification.notification_id), notification].sort((a, b) =>
        a.notification_date.localeCompare(b.notification_date) || b.notification_id - a.notification_id
      ));
      setMessage('');
      setEditingId(null);
      setSuccess(`Notification ${editingId ? 'updated' : 'scheduled'} for ${formatDate(notification.notification_date)}.`);
    } catch (err) {
      if (err.status === 401) onLogout();
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (notice) => {
    if (!confirm('Delete this notification? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.deleteNotification(notice.notification_id);
      setNotifications((previous) => previous.filter((item) => item.notification_id !== notice.notification_id));
      if (editingId === notice.notification_id) { setEditingId(null); setMessage(''); }
      setSuccess('Notification deleted.');
    } catch (err) {
      if (err.status === 401) onLogout();
      else setError(err.message);
    } finally { setBusy(false); }
  };

  const changeType = (nextType) => {
    setType(nextType);
    if (nextType === 'coaching_plan' && date < tomorrow) setDate(tomorrow);
    if (nextType === 'camp_holiday') setPersonId('');
  };

  return (
    <section className="notification-admin" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading">Camp notifications</h2>
      <p className="muted">Holiday notices appear to all players on their display date. Individual coaching plans appear only to the selected student the day before the camp date.</p>
      {editingId && <p role="status">Editing notification #{editingId}</p>}
      <form onSubmit={submit}>
        <label className="label" htmlFor="notification-type">Notification type</label>
        <select id="notification-type" className="input" value={type} onChange={(e) => changeType(e.target.value)} required disabled={loading || busy}>
          {Object.entries(notificationTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {type === 'coaching_plan' && <>
          <label className="label" htmlFor="notification-student">Student</label>
          <select id="notification-student" className="input" value={personId} required disabled={loading || busy}
            onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Select a student</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          {people.length === 0 && <p className="muted">Add a camp player before creating an individual coaching plan.</p>}
        </>}
        <label className="label" htmlFor="notification-message">{type === 'coaching_plan' ? 'Key focus items' : 'Message'}</label>
        <textarea id="notification-message" className="input" rows={4} maxLength={2000}
          value={message} onChange={(e) => setMessage(e.target.value)} required disabled={loading || busy} />
        <label className="label" htmlFor="notification-date">{type === 'coaching_plan' ? 'Camp date' : 'Display date'}</label>
        <input id="notification-date" className="input" type="date" min={(type === 'coaching_plan' ? tomorrow : today) || undefined}
          value={date} onChange={(e) => setDate(e.target.value)} required disabled={loading || busy} />
        <button className="btn btn-primary full" disabled={loading || busy || !message.trim() || !date || (type === 'coaching_plan' && !personId)}>
          {busy ? 'Saving notification…' : editingId ? 'Save changes' : 'Set notification'}
        </button>
        {editingId && <button type="button" className="btn btn-ghost full" disabled={busy} onClick={() => {
          setEditingId(null); setMessage(''); setPersonId(''); setType('camp_holiday'); setDate(today); setError(''); setSuccess('');
        }}>Cancel editing</button>}
      </form>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success" role="status">{success}</div>}
      <h2 className="list-header">Scheduled notifications</h2>
      {loading ? <p className="muted">Loading notifications…</p> : notifications.length === 0 ?
        <p className="muted">{error ? 'Unable to load notifications. Reload to try again.' : 'No notifications scheduled.'}</p> :
        notifications.map((notice) => (
          <article className={`camp-notice camp-notice-${notice.notification_type}`} key={notice.notification_id}>
            <strong>{notificationTypes[notice.notification_type]} - {formatDate(notice.notification_date)}</strong>
            {notice.notification_type === 'coaching_plan' && <p>
              Student: {people.find((person) => person.id === notice.person_id)?.name || 'Not assigned — edit to select a student'}
            </p>}
            <p>{notice.notification_message}</p>
            <div className="actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {
                setEditingId(notice.notification_id); setType(notice.notification_type);
                setMessage(notice.notification_message); setDate(notice.notification_date);
                setPersonId(notice.person_id ? String(notice.person_id) : ''); setError(''); setSuccess('');
              }}>Edit</button>
              <button type="button" className="btn btn-link-danger" disabled={busy} onClick={() => remove(notice)}>Delete</button>
            </div>
          </article>
        ))}
    </section>
  );
}
