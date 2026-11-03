import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export default function RegistrationApprovals({ onLogout, onApproved }) {
  const [data, setData] = useState(null);
  const [selections, setSelections] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const result = await api.getRegistrations();
    setData(result);
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    api.getRegistrations().then((result) => { if (active) setData(result); })
      .catch((err) => {
        if (!active) return;
        if (err.status === 401) onLogout();
        else setError(err.message);
      });
    return () => { active = false; };
  }, [onLogout]);

  const action = async (account, approve) => {
    if (!approve && !confirm(`Reject the registration for ${account.name}?`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (approve) {
        const selection = selections[account.id] || 'new';
        await api.approveRegistration(account.id, selection === 'new' ? null : Number(selection));
        setMessage(`Approved ${account.name}. They can now sign in.`);
        await onApproved();
      } else {
        await api.rejectRegistration(account.id);
        setMessage(`Rejected the registration for ${account.name}.`);
      }
      await load();
    } catch (err) {
      if (err.status === 401) onLogout();
      else setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <section className="registration-approvals" aria-labelledby="registration-heading">
      <div className="row-between">
        <h2 id="registration-heading">Registration requests {data ? `(${data.registrations.length})` : ''}</h2>
        <button className="btn btn-ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await load(); } catch (err) {
            if (err.status === 401) onLogout(); else setError(err.message);
          } finally { setBusy(false); }
        }}>Refresh requests</button>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {!data && !error && <p className="muted" role="status">Loading registration requests…</p>}
      {data?.registrations.length === 0 && <p className="muted">No registrations awaiting approval.</p>}
      {data?.registrations.map((account) => (
        <article className="registration-request" key={account.id}>
          <h3>{account.name}</h3>
          <p>Username: <strong>{account.username}</strong></p>
          <label className="label" htmlFor={`registration-player-${account.id}`}>Camp player for this account</label>
          <select className="input" id={`registration-player-${account.id}`} disabled={busy}
            value={selections[account.id] || 'new'}
            onChange={(e) => setSelections((previous) => ({ ...previous, [account.id]: e.target.value }))}>
            <option value="new">Create a new camp player</option>
            {data.people.map((person) => <option key={person.id} value={person.id}>Link: {person.name}</option>)}
          </select>
          <p className="muted small">Link an existing player to keep their availability history. Only players without an account are listed.</p>
          <div className="actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => action(account, true)}>Approve</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => action(account, false)}>Reject</button>
          </div>
        </article>
      ))}
    </section>
  );
}
