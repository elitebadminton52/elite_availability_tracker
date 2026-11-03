import { encryptRequest } from '../shared/envelope.js';

async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`The server returned an invalid response (${res.status}). Please try again.`);
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/admin/') && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('player-session-expired'));
    }
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function sensitiveRequest(path, data, method = 'POST') {
  const { publicKey } = await request('/api/auth/key');
  const body = await encryptRequest(publicKey, path, data);
  return request(path, { method, body });
}

export const api = {
  playerMe: () => request('/api/auth/me'),
  playerLogin: (username, password) => sensitiveRequest('/api/auth/login', { username, password }),
  register: (name, username, password) => sensitiveRequest('/api/auth/register', { name, username, password }),
  usernameAvailable: (username) => sensitiveRequest('/api/auth/username', { username }),
  playerLogout: () => request('/api/auth/logout', { method: 'POST' }),
  getRegistrations: () => request('/api/admin/registrations'),
  approveRegistration: (id, personId) => request(`/api/admin/registrations/${id}/approve`, { method: 'POST', body: { personId } }),
  rejectRegistration: (id) => request(`/api/admin/registrations/${id}/reject`, { method: 'POST' }),
  getPeople: () => request('/api/people'),
  getNotifications: (options = {}) => request('/api/notifications', options),
  getAdminNotifications: () => request('/api/admin/notifications'),
  addNotification: (notification) =>
    sensitiveRequest('/api/admin/notifications', notification),
  updateNotification: (id, notification) =>
    sensitiveRequest(`/api/admin/notifications/${id}`, notification, 'PUT'),
  deleteNotification: (id) => request(`/api/admin/notifications/${id}`, { method: 'DELETE' }),
  getMyAvailability: () => request('/api/availability/me'),
  getAvailability: (day = 'tomorrow', options = {}) =>
    request(`/api/availability?day=${encodeURIComponent(day)}`, options),
  setAvailability: (status) => request('/api/availability', { method: 'POST', body: { status } }),
  adminLogin: (password) => sensitiveRequest('/api/admin/login', { password }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST' }),
  adminMe: () => request('/api/admin/me'),
  addPerson: (name) => sensitiveRequest('/api/admin/people', { name }),
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
