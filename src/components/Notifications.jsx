import { useEffect, useState } from 'react';
import { api, formatDate } from '../api.js';
import { notificationTypes } from '../notification-types.js';

export default function Notifications() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let controller;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const result = await api.getNotifications({ signal });
        if (!active || signal.aborted) return;
        setData(result);
        setError('');
      } catch (err) {
        if (!active || signal.aborted) return;
        setData(null);
        setError(err.message);
      }
    };
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, []);

  return (
    <div aria-live="polite">
      {error && <div className="alert alert-error" role="alert">Unable to load camp notices: {error}</div>}
      {data?.notifications.length > 0 && (
        <section aria-label="Camp notices">
          <h2>Camp notices and your coaching plan</h2>
          {data.notifications.map((notice) => (
            <article key={notice.notification_id} className={`camp-notice camp-notice-${notice.notification_type}`}>
              <strong>{notificationTypes[notice.notification_type]}</strong>
              <p className="muted">{notice.notification_type === 'coaching_plan' ? 'Camp date' : 'Notice date'}: {formatDate(notice.notification_date)}</p>
              <p>{notice.notification_message}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
