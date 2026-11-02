import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchableSelect from '../components/SearchableSelect.jsx';
import Notifications from '../components/Notifications.jsx';
import { api, formatDate } from '../api.js';
import { availabilityOptions } from '../availability-options.js';

const LAST_PERSON_KEY = 'lastPersonId';

export default function AvailabilityForm() {
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState(null);
  const [sessionDate, setSessionDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);
  const [availability, setAvailability] = useState({ available: [], notAvailable: [] });
  const [showResponded, setShowResponded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const options = availabilityOptions(people, availability, showResponded);
  const selectedPerson = options.find((person) => person.id === personId);

  useEffect(() => {
    let active = true;
    Promise.all([api.getPeople(), api.getAvailability()])
      .then(([{ people }, data]) => {
        if (!active) return;
        setPeople(people);
        setAvailability(data);
        setSessionDate(data.date);
        const last = Number(localStorage.getItem(LAST_PERSON_KEY));
        if (availabilityOptions(people, data).some((p) => p.id === last)) setPersonId(last);
      })
      .catch((e) => {
        if (!active) return;
        setLoadFailed(true);
        setMessage({ type: 'error', text: e.message });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const submit = async (status) => {
    if (!selectedPerson || saving) return;
    setSaving(status);
    setMessage(null);
    try {
      const res = await api.setAvailability(personId, status);
      setAvailability((previous) => {
        const current = res.date === sessionDate ? previous : { available: [], notAvailable: [] };
        return {
          available: [
            ...current.available.filter((person) => person.id !== personId),
            ...(status === 'available' ? [{ id: personId }] : []),
          ],
          notAvailable: [
            ...current.notAvailable.filter((person) => person.id !== personId),
            ...(status === 'not_available' ? [{ id: personId }] : []),
          ],
        };
      });
      setSessionDate(res.date);
      if (!showResponded) setPersonId(null);
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
      <Notifications />
      <h1>Will you be at coaching tomorrow?</h1>
      {sessionDate && <p className="muted">Session: {formatDate(sessionDate)}</p>}

      <label className="label">Your name {!showResponded? '(only showing players who have not responded)' : ''}</label>
      {loading ? (
        <p className="muted">Loading names…</p>
      ) : loadFailed ? (
        <p className="muted">Unable to load players and responses. Reload the page to try again.</p>
      ) : people.length === 0 ? (
        <p className="muted">No players have been added yet. Ask the coach to add you.</p>
      ) : options.length === 0 ? (
        <p className="muted">Everyone has already responded for tomorrow. Use “Change my response” to update an answer.</p>
      ) : (
        <SearchableSelect
          key={showResponded ? 'all-players' : 'pending-players'}
          options={options}
          value={personId}
          disabled={Boolean(saving)}
          onChange={(id) => {
            setPersonId(id);
            setMessage(null);
          }}
          placeholder="Search your name…"
        />
      )}
      {!loading && !loadFailed && people.length > 0 && (
        <p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={Boolean(saving)}
            aria-pressed={showResponded}
            onClick={() => {
              setShowResponded((value) => !value);
              setPersonId(null);
              setMessage(null);
            }}
          >
            {showResponded ? 'Show only players who have not responded' : 'Change my response'}
          </button>
        </p>
      )}

      <div className="actions">
        <button className="btn btn-success" disabled={!selectedPerson || Boolean(saving)} onClick={() => submit('available')}>
          {saving === 'available' ? 'Saving…' : 'Available'}
        </button>
        <button className="btn btn-danger" disabled={!selectedPerson || Boolean(saving)} onClick={() => submit('not_available')}>
          {saving === 'not_available' ? 'Saving…' : 'Not Available'}
        </button>
      </div>

      {message && <div role={message.type === 'error' ? 'alert' : 'status'} className={`alert alert-${message.type}`}>{message.text}</div>}

      <p className="muted small">
        You can change your response any time before the session. <Link to="/dashboard">See who's coming →</Link>
      </p>
    </section>
  );
}
