import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { AuthStatus, useAuth } from '../AuthContext.jsx';

export default function Login() {
  const { user, setUser } = useAuth();
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [usernameMessage, setUsernameMessage] = useState('');
  const usernameVersion = useRef(0);

  const checkUsername = async () => {
    if (!registering || !/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username.trim())) return;
    const version = ++usernameVersion.current;
    setUsernameMessage('Checking username…');
    try {
      const { available } = await api.usernameAvailable(username);
      if (version === usernameVersion.current) setUsernameMessage(available ? 'Username is available.' : 'Username is already taken.');
    } catch (err) {
      if (version === usernameVersion.current) setUsernameMessage(`Unable to check username: ${err.message}`);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (registering && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      if (registering) {
        const result = await api.register(name, username, password);
        setSuccess(result.message);
        setRegistering(false);
      } else {
        const result = await api.playerLogin(username, password);
        setUser(result.user);
      }
      setPassword('');
      setConfirmation('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthStatus>
      {user ? <Navigate to="/" replace /> : (
        <section className="card narrow">
          <h1>{registering ? 'Join the camp' : 'Player login'}</h1>
          <p className="muted">{registering ? 'Create an account. The coach must approve it before you can sign in.' : 'Sign in to mark your availability.'}</p>
          <form onSubmit={submit}>
            {registering && <>
              <label className="label" htmlFor="player-name">Full name</label>
              <input id="player-name" className="input" autoComplete="name" maxLength={80} required
                value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </>}
            <label className="label" htmlFor="player-username">Username</label>
            <input id="player-username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false}
              minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}" required
              value={username} disabled={busy}
              onChange={(e) => { setUsername(e.target.value); usernameVersion.current++; setUsernameMessage(''); }}
              onBlur={checkUsername} aria-describedby={registering ? 'username-help' : undefined} />
            {registering && <p id="username-help" className="muted small" role="status">
              {usernameMessage || '3–32 letters, numbers, dots, underscores or hyphens. Usernames are not case-sensitive.'}
            </p>}
            <label className="label" htmlFor="player-password">Password</label>
            <input id="player-password" className="input" type="password" autoComplete={registering ? 'new-password' : 'current-password'}
              minLength={12} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            {registering && <>
              <p className="muted small">Use at least 12 characters.</p>
              <label className="label" htmlFor="player-confirmation">Confirm password</label>
              <input id="player-confirmation" className="input" type="password" autoComplete="new-password" minLength={12} maxLength={128}
                required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} />
            </>}
            <button className="btn btn-primary full" disabled={busy}>
              {busy ? 'Please wait…' : registering ? 'Request approval' : 'Sign in'}
            </button>
          </form>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {success && <div className="alert alert-success" role="status">{success}</div>}
          <button type="button" className="btn btn-ghost full" disabled={busy} onClick={() => {
            setRegistering((value) => !value); setError(''); setSuccess(''); setPassword(''); setConfirmation('');
            usernameVersion.current++; setUsernameMessage('');
          }}>{registering ? 'Already registered? Sign in' : 'First time? Request an account'}</button>
        </section>
      )}
    </AuthStatus>
  );
}
