import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import AdminNotifications from '../components/AdminNotifications.jsx';
import RegistrationApprovals from '../components/RegistrationApprovals.jsx';
import { Link } from 'react-router-dom';

export default function Admin() {
  const [authed, setAuthed] = useState(null);
  const [authError, setAuthError] = useState('');
  const [retry, setRetry] = useState(0);
  const logout = useCallback(() => setAuthed(false), []);

  useEffect(() => {
    api
      .adminMe()
      .then(() => setAuthed(true))
      .catch((err) => {
        if (err.status === 401) setAuthed(false);
        else setAuthError(err.message);
      });
  }, [retry]);

  if (authError) return <div className="card"><p className="alert alert-error" role="alert">{authError}</p>
    <button className="btn btn-primary" onClick={() => { setAuthError(''); setRetry((value) => value + 1); }}>Retry</button></div>;
  if (authed === null) return <p className="card muted">Loading…</p>;
  return authed ? <AdminPanel onLogout={logout} /> : <AdminLogin onLogin={() => setAuthed(true)} />;
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
          autoComplete="current-password"
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
  const [activeTab, setActiveTab] = useState('people');

  const load = useCallback(async () => {
    const { people } = await api.getPeople();
    setPeople(people);
  }, []);

  useEffect(() => {
    load().catch((err) => {
      if (err.status === 401) onLogout();
      else setMessage({ type: 'error', text: err.message });
    });
  }, [load, onLogout]);

  const tabs = [
    { id: 'people', label: 'Manage people' },
    { id: 'notifications', label: 'Set notifications' },
  ];

  const handleTabKeyDown = (event, index) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[next].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
  };

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
    if (!confirm(`Remove ${person.name} from the camp list? Their account, sessions, and availability history will also be deleted.`)) return;
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
    try {
      await api.adminLogout();
      onLogout();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const visible = people.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <section className="card">
      <div className="row-between">
        <h1>Camp administration</h1>
        <Link to="/dashboard">Availability dashboard</Link>
        <button className="btn btn-ghost" onClick={logout}>
          Log out
        </button>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Administration">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`admin-tab-${tab.id}`}
            type="button"
            role="tab"
            className="btn-tab btn-ghost"
            aria-selected={activeTab === tab.id}
            aria-controls={`admin-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id="admin-panel-people" role="tabpanel" aria-labelledby="admin-tab-people"
        hidden={activeTab !== 'people'} tabIndex={0}>
      <h2>Manage camp players</h2>
      <RegistrationApprovals onLogout={onLogout} onApproved={load} />
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
      </div>
      <div id="admin-panel-notifications" role="tabpanel" aria-labelledby="admin-tab-notifications"
        hidden={activeTab !== 'notifications'} tabIndex={0}>
        <AdminNotifications onLogout={onLogout} />
      </div>
    </section>
  );
}
