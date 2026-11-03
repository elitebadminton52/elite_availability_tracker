import { useEffect, useState } from 'react';
import Notifications from '../components/Notifications.jsx';
import { api, formatDate } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

export default function AvailabilityForm() {
  const { user } = useAuth();
  const [sessionDate, setSessionDate] = useState('');
  const [currentStatus, setCurrentStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    api.getMyAvailability()
      .then((data) => {
        if (!active) return;
        setSessionDate(data.date);
        setCurrentStatus(data.status);
      })
      .catch((err) => { if (active) setMessage({ type: 'error', text: err.message }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id]);

  const submit = async (status) => {
    if (saving || loading || !sessionDate) return;
    setSaving(status);
    setMessage(null);
    try {
      const result = await api.setAvailability(status);
      setSessionDate(result.date);
      setCurrentStatus(result.status);
      setEditing(false);
      setMessage({
        type: 'success',
        text: `Thanks ${user.name}! You're marked as ${status === 'available' ? 'AVAILABLE' : 'NOT AVAILABLE'} for ${formatDate(result.date)}.`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="card">
      <Notifications />
      <h1>Hi {user.name}</h1>
      {loading ? <p className="muted" role="status">Loading tomorrow's session…</p> :
        sessionDate && <h2 className="list-header">Will you be available tomorrow, {formatDate(sessionDate)}?</h2>}
      {currentStatus && <p className="muted">You already marked as <strong>{currentStatus === 'available' ? 'Available' : 'Not Available'}</strong>.</p>}
      {currentStatus && !editing ? (
        <button className="btn btn-ghost" onClick={() => { setEditing(true); setMessage(null); }}>
          Change your response
        </button>
      ) : (
      <div className="actions">
        <button className="btn btn-success" disabled={loading || !sessionDate || Boolean(saving)}
          aria-pressed={currentStatus === 'available'} onClick={() => submit('available')}>
          {saving === 'available' ? 'Saving…' : 'Available'}
        </button>
        <button className="btn btn-danger" disabled={loading || !sessionDate || Boolean(saving)}
          aria-pressed={currentStatus === 'not_available'} onClick={() => submit('not_available')}>
          {saving === 'not_available' ? 'Saving…' : 'Not Available'}
        </button>
      </div>
      )}
      {message && <div role={message.type === 'error' ? 'alert' : 'status'} className={`alert alert-${message.type}`}>{message.text}</div>}
    </section>
  );
}
