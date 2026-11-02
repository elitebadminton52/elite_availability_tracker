import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getAvailability()
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const responded = data ? data.available.length + data.notAvailable.length : 0;

  return (
    <section className="card">
      <div className="row-between">
        <h1>Available for tomorrow</h1>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
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
