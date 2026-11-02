import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Admin() {
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    api
      .adminMe()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <p className="card muted">Loading…</p>;
  return authed ? <AdminPanel onLogout={() => setAuthed(false)} /> : <AdminLogin onLogin={() => setAuthed(true)} />;
}

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.adminLogin(password);
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card narrow">
      <h1>Admin login</h1>
      <form onSubmit={submit}>
        <label className="label" htmlFor="pw">
          Password
        </label>
        <input
          id="pw"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
        <button className="btn btn-primary full" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {error && <div className="alert alert-error">{error}</div>}
    </section>
  );
}

function AdminPanel({ onLogout }) {
  const [people, setPeople] = useState([]);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .getPeople()
      .then(({ people }) => setPeople(people))
      .catch((e) => setMessage({ type: 'error', text: e.message }));

  useEffect(() => {
    load();
  }, []);

  const handleAuthError = (e) => {
    if (e.status === 401) onLogout();
    else setMessage({ type: 'error', text: e.message });
  };

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { person } = await api.addPerson(name);
      setName('');
      setMessage({ type: 'success', text: `Added ${person.name}` });
      await load();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (person) => {
    if (!confirm(`Remove ${person.name} from the camp list? Their availability history will also be deleted.`)) return;
    setMessage(null);
    try {
      await api.removePerson(person.id);
      setMessage({ type: 'success', text: `Removed ${person.name}` });
      await load();
    } catch (err) {
      handleAuthError(err);
    }
  };

  const logout = async () => {
    await api.adminLogout().catch(() => {});
    onLogout();
  };

  const visible = people.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <section className="card">
      <div className="row-between">
        <h1>Manage camp players</h1>
        <button className="btn btn-ghost" onClick={logout}>
          Log out
        </button>
      </div>

      <form className="add-form" onSubmit={add}>
        <input
          className="input"
          placeholder="New player's full name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add player'}
        </button>
      </form>
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <div className="row-between list-header">
        <h2>Players ({people.length})</h2>
        <input className="input small-input" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <ul className="people-list">
        {visible.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <button className="btn btn-link-danger" onClick={() => remove(p)}>
              Remove
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className="muted">No players found.</li>}
      </ul>
    </section>
  );
}
