import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.playerMe().then(({ user }) => { if (active) setUser(user); })
      .catch((err) => {
        if (!active) return;
        if (err.status === 401) setUser(null);
        else setError(err.message);
      })
      .finally(() => { if (active) setLoading(false); });
    const expire = () => { setUser(null); setError(''); };
    window.addEventListener('player-session-expired', expire);
    return () => { active = false; window.removeEventListener('player-session-expired', expire); };
  }, [retry]);

  const logout = useCallback(async () => {
    await api.playerLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, error, logout, retry: () => setRetry((value) => value + 1) }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export function AuthStatus({ children }) {
  const { loading, error, retry } = useAuth();
  if (loading) return <p className="card muted" role="status">Checking your login…</p>;
  if (error) return <div className="card"><p className="alert alert-error" role="alert">{error}</p>
    <button className="btn btn-primary" onClick={retry}>Retry</button></div>;
  return children;
}

export function RequirePlayer({ children }) {
  const { user } = useAuth();
  return <AuthStatus>{user ? children : <Navigate to="/login" replace />}</AuthStatus>;
}

export function RequireCoach({ children }) {
  const [allowed, setAllowed] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    api.adminMe().then(() => { if (active) setAllowed(true); })
      .catch((err) => {
        if (!active) return;
        if (err.status === 401) setAllowed(false);
        else setError(err.message);
      });
    return () => { active = false; };
  }, [retry]);
  if (error) return <div className="card"><p className="alert alert-error" role="alert">{error}</p>
    <button className="btn btn-primary" onClick={() => { setError(''); setRetry((value) => value + 1); }}>Retry</button></div>;
  if (allowed === null) return <p className="card muted" role="status">Checking dashboard access…</p>;
  return allowed ? children : <Navigate to="/admin" replace />;
}
