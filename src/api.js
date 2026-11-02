async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  getPeople: () => request('/api/people'),
  getAvailability: (day = 'tomorrow', options = {}) =>
    request(`/api/availability?day=${encodeURIComponent(day)}`, options),
  setAvailability: (personId, status) => request('/api/availability', { method: 'POST', body: { personId, status } }),
  adminLogin: (password) => request('/api/admin/login', { method: 'POST', body: { password } }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST' }),
  adminMe: () => request('/api/admin/me'),
  addPerson: (name) => request('/api/admin/people', { method: 'POST', body: { name } }),
  removePerson: (id) => request(`/api/admin/people/${id}`, { method: 'DELETE' }),
};

export function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
