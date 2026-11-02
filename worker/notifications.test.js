import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import worker from './index.js';
import { sessionDates } from './dates.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function fixture() {
  const dates = sessionDates({ TIMEZONE: 'Asia/Kolkata' });
  let notices = [
    { notification_id: 1, notification_date: '2000-01-01', notification_type: 'camp_holiday', notification_message: 'Past' },
    { notification_id: 2, notification_date: dates.today, notification_type: 'camp_holiday', notification_message: 'Holiday today' },
    { notification_id: 3, notification_date: dates.today, notification_type: 'coaching_plan', notification_message: 'Plan today' },
    { notification_id: 4, notification_date: dates.tomorrow, notification_type: 'coaching_plan', notification_message: 'Tomorrow' },
    { notification_id: 5, notification_date: '9999-12-31', notification_type: 'coaching_plan', notification_message: 'Future' },
  ];
  const env = {
    TIMEZONE: 'Asia/Kolkata',
    ADMIN_PASSWORD: 'test-password',
    SESSION_SECRET: 'notification-test-only-secret',
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async run() {
            if (sql.startsWith('DELETE FROM availability')) return;
            assert.equal(sql, 'DELETE FROM notifications WHERE notification_date < ?');
            assert.equal(args[0], dates.today);
            notices = notices.filter((notice) => notice.notification_date >= args[0]);
          },
          async all() {
            if (sql.startsWith('SELECT id, name FROM people')) return { results: [] };
            assert.match(sql, /^SELECT \* FROM notifications/);
            const results = notices.filter((notice) => sql.includes('>=') ?
              notice.notification_date >= args[0] : notice.notification_date === args[0]);
            return { results };
          },
          async first() {
            assert.match(sql, /INSERT INTO notifications/);
            const [notification_message, notification_date, notification_type] = args;
            const notification = { notification_id: 6 + notices.length, notification_message, notification_date, notification_type };
            notices.push(notification);
            return notification;
          },
        };
      },
    },
  };
  const request = (path, body, cookie) => worker.fetch(new Request(`https://camp.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const login = async () => {
    const response = await request('/api/admin/login', { password: env.ADMIN_PASSWORD });
    assert.equal(response.status, 200);
    return response.headers.get('Set-Cookie').split(';')[0];
  };
  return { request, login, dates, notices: () => notices };
}

test('public notices show only today; app loading deletes past but preserves future notices', async () => {
  const f = fixture();
  await f.request('/api/people');
  assert.equal(f.notices().length, 4);
  assert.ok(f.notices().some((notice) => notice.notification_date === '9999-12-31'));
  const response = await f.request('/api/notifications');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.date, f.dates.today);
  assert.deepEqual(data.notifications.map((notice) => notice.notification_message), ['Holiday today', 'Plan today']);
  await f.request('/api/notifications');
  assert.equal(f.notices().length, 4);
});

test('notification management requires login and allows both types for today or a future date', async () => {
  const f = fixture();
  assert.equal((await f.request('/api/admin/notifications')).status, 401);
  assert.equal((await f.request('/api/admin/notifications', {})).status, 401);
  const cookie = await f.login();
  for (const [type, date] of [['camp_holiday', f.dates.today], ['coaching_plan', f.dates.tomorrow]]) {
    const response = await f.request('/api/admin/notifications', {
      notification_type: type, notification_date: date, notification_message: '  Test message\nsecond line  ',
    }, cookie);
    assert.equal(response.status, 201);
    const { notification } = await response.json();
    assert.equal(notification.notification_type, type);
    assert.equal(notification.notification_date, date);
    assert.equal(notification.notification_message, 'Test message\nsecond line');
    assert.ok(Number.isInteger(notification.notification_id));
  }
  const response = await f.request('/api/admin/notifications', undefined, cookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).notifications.length, 6);
});

test('invalid type, message, malformed date, impossible date and past dates are rejected', async () => {
  const f = fixture();
  const cookie = await f.login();
  const valid = { notification_type: 'camp_holiday', notification_message: 'Holiday', notification_date: f.dates.today };
  for (const change of [
    { notification_type: 'invalid' }, { notification_type: null },
    { notification_message: '' }, { notification_message: '   ' },
    { notification_message: 'a'.repeat(2001) }, { notification_message: 123 },
    { notification_date: '2000-01-01' }, { notification_date: '9999-02-30' },
    { notification_date: '9999-13-01' }, { notification_date: '03/04/2027' },
    { notification_date: null }, { notification_date: '' },
  ]) {
    const response = await f.request('/api/admin/notifications', { ...valid, ...change }, cookie);
    assert.equal(response.status, 400, JSON.stringify(change));
    assert.ok((await response.json()).error);
  }
  assert.equal(f.notices().length, 4);
});
