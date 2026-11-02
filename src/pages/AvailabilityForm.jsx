import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { api, formatDate } from '../api.js';

const LAST_PERSON_KEY = 'lastPersonId';

export default function AvailabilityForm() {
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState(null);
  const [sessionDate, setSessionDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    Promise.all([api.getPeople(), api.getAvailability()])
      .then(([{ people }, { date }]) => {
        setPeople(people);
        setSessionDate(date);
        const last = Number(localStorage.getItem(LAST_PERSON_KEY));
        if (people.some((p) => p.id === last)) setPersonId(last);
      })
      .catch((e) => setMessage({ type: 'error', text: e.message }))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (status) => {
    if (!personId) return;
    setSaving(status);
    setMessage(null);
    try {
      const res = await api.setAvailability(personId, status);
      localStorage.setItem(LAST_PERSON_KEY, String(personId));
      setMessage({
        type: 'success',
        text: `Thanks ${res.name}! You're marked as ${status === 'available' ? 'AVAILABLE ✅' : 'NOT AVAILABLE ❌'} for ${formatDate(res.date)}.`,
      });
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="card">
      <h1>Will you be at coaching tomorrow?</h1>
      {sessionDate && <p className="muted">Session: {formatDate(sessionDate)}</p>}

      <label className="label">Your name</label>
      {loading ? (
        <p className="muted">Loading names…</p>
      ) : people.length === 0 ? (
        <p className="muted">No players have been added yet. Ask the coach to add you.</p>
      ) : (
        <SearchableSelect
          options={people}
          value={personId}
          onChange={(id) => {
            setPersonId(id);
            setMessage(null);
          }}
          placeholder="Search your name…"
        />
      )}

      <div className="actions">
        <button className="btn btn-success" disabled={!personId || saving} onClick={() => submit('available')}>
          {saving === 'available' ? 'Saving…' : 'Available'}
        </button>
        <button className="btn btn-danger" disabled={!personId || saving} onClick={() => submit('not_available')}>
          {saving === 'not_available' ? 'Saving…' : 'Not Available'}
        </button>
      </div>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <p className="muted small">
        You can change your response any time before the session. <Link to="/dashboard">See who's coming →</Link>
      </p>
    </section>
  );
}
