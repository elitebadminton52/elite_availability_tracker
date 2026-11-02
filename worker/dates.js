export function sessionDates(env, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.TIMEZONE || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const today = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  const tomorrow = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + 1));
  return {
    today: today.toISOString().slice(0, 10),
    tomorrow: tomorrow.toISOString().slice(0, 10),
  };
}
