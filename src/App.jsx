import { NavLink, Route, Routes } from 'react-router-dom';
import AvailabilityForm from './pages/AvailabilityForm.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import Login from './pages/Login.jsx';
import { AuthProvider, RequirePlayer, RequireCoach, useAuth } from './AuthContext.jsx';
import { useState } from 'react';

export default function App() {
  return <AuthProvider><AppContent /></AuthProvider>;
}

function AppContent() {
  const { user, logout } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    setError('');
    try { await logout(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="app">
      <header className="header">
        <div className="brand">🏸 Elite Badminton</div>
        <nav className="nav">
          <NavLink to="/" end>
            Mark Availability
          </NavLink>
          <NavLink to="/admin">Admin</NavLink>
          {user ? <button className="btn btn-ghost" onClick={signOut} disabled={busy}>{busy ? 'Logging out…' : 'Log out'}</button> :
            <NavLink to="/login">Player login</NavLink>}
        </nav>
      </header>
      <main className="main">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RequirePlayer><AvailabilityForm /></RequirePlayer>} />
          <Route path="/dashboard" element={<RequireCoach><Dashboard /></RequireCoach>} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<p className="card">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
