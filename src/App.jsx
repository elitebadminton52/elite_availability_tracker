import { NavLink, Route, Routes } from 'react-router-dom';
import AvailabilityForm from './pages/AvailabilityForm.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <div className="brand">🏸 Elite Badminton</div>
        <nav className="nav">
          <NavLink to="/" end>
            Mark Availability
          </NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<AvailabilityForm />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<p className="card">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
