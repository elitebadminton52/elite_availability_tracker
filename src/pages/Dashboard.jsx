import { useEffect, useState } from 'react';
import { api, formatDate } from '../api.js';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState('tomorrow');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api
      .getAvailability(day, { signal: controller.signal })
      .then((d) => {
        if (controller.signal.aborted) return;
        setData(d);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [day, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setRefresh((value) => value + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const responded = data ? data.available.length + data.notAvailable.length : 0;

  return (
    <section className="card">
      <p><Link to="/admin">Back to camp administration</Link></p>
      <div className="row-between">
        <h1>Available for {day}</h1>
        <button className="btn btn-ghost" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <label className="label" htmlFor="session-day">Session day</label>
      <select
        id="session-day"
        className="input"
        value={day}
        onChange={(e) => {
          setDay(e.target.value);
          setData(null);
          setError('');
          setLoading(true);
        }}
      >
        <option value="today">Today</option>
        <option value="tomorrow">Tomorrow</option>
      </select>
      {loading && !data && <p className="muted" role="status">Loading availability…</p>}
      {data && <p className="muted">Session: {formatDate(data.date)}</p>}
      {error && <div className="alert alert-error">{error}</div>}

      {data && (
        <>
          <div className="stats">
            <div className="stat stat-green">
              <span className="stat-num">{data.available.length}</span>
              <span>Available</span>
            </div>
            <div className="stat stat-red">
              <span className="stat-num">{data.notAvailable.length}</span>
              <span>Not available</span>
            </div>
            <div className="stat">
              <span className="stat-num">{Math.max(data.totalPeople - responded, 0)}</span>
              <span>No response</span>
            </div>
          </div>

          {data.available.length === 0 ? (
            <p className="muted">Nobody has marked themselves available yet.</p>
          ) : (
            <ol className="name-list">
              {data.available.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
