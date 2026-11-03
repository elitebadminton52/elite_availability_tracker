import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './sqlite-fixture.js';
import { sessionDates } from './dates.js';

test('student sees today holidays and only their own tomorrow plan; legacy untargeted plans stay private', async (t) => {
  const f = fixture(t);
  const student = await f.approvedPlayer();
  const other = await f.approvedPlayer('other.student', 'Other Student');
  const admin = await f.admin();
  const dates = sessionDates(f.env);
  const holiday = { notification_date: dates.today, notification_type: 'camp_holiday', notification_message: 'Today holiday' };
  assert.equal((await f.sensitive('/api/admin/notifications', holiday, admin)).status, 201);
  const plan = { notification_date: dates.tomorrow, notification_type: 'coaching_plan', notification_message: 'Private footwork focus', person_id: student.user.id };
  const saved = await f.sensitive('/api/admin/notifications', plan, admin);
  assert.equal(saved.status, 201);
  const id = (await saved.json()).notification.notification_id;
  assert.ok(f.db.prepare('SELECT notification_message FROM notifications WHERE notification_id=?').get(id).notification_message.startsWith('v1.'));
  assert.equal((await f.sensitive('/api/admin/notifications', { ...plan, person_id: other.user.id, notification_message: 'Other plan' }, admin)).status, 201);
  f.db.prepare('INSERT INTO notifications(notification_date, notification_type, notification_message) VALUES (?, ?, ?)')
    .run(dates.tomorrow, 'coaching_plan', 'Legacy unassigned plan');
  f.db.prepare('INSERT INTO notifications(notification_date, notification_type, notification_message,person_id) VALUES (?, ?, ?, ?)')
    .run(dates.today, 'coaching_plan', 'Today camp, not tomorrow', student.user.id);
  const own = await (await f.request('/api/notifications', undefined, student.cookie)).json();
  assert.deepEqual(own.notifications.map((notice) => notice.notification_message).sort(), ['Private footwork focus', 'Today holiday']);
  const others = await (await f.request(`/api/notifications?person_id=${student.user.id}`, undefined, other.cookie)).json();
  assert.deepEqual(others.notifications.map((notice) => notice.notification_message).sort(), ['Other plan', 'Today holiday']);
  assert.equal((await f.request('/api/notifications')).status, 401);
  const list = await (await f.request('/api/admin/notifications', undefined, admin)).json();
  assert.equal(list.notifications.length, 5);
  assert.equal(list.people.length, 2);
  assert.equal(list.tomorrow, dates.tomorrow);
});

test('coach can edit, retarget, change type and delete notices; players cannot mutate them', async (t) => {
  const f = fixture(t);
  const student = await f.approvedPlayer();
  const other = await f.approvedPlayer('other.student', 'Other Student');
  const admin = await f.admin();
  const dates = sessionDates(f.env);
  const plan = { notification_date: dates.tomorrow, notification_type: 'coaching_plan', notification_message: 'Focus A', person_id: student.user.id };
  const id = (await (await f.sensitive('/api/admin/notifications', plan, admin)).json()).notification.notification_id;
  const path = `/api/admin/notifications/${id}`;
  assert.equal((await f.sensitive(path, plan, student.cookie, {}, 'PUT')).status, 401);
  assert.equal((await f.request(path, undefined, student.cookie, {}, false, 'DELETE')).status, 401);
  const edited = await f.sensitive(path, { ...plan, person_id: other.user.id, notification_message: 'Focus B' }, admin, {}, 'PUT');
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).notification.notification_message, 'Focus B');
  assert.equal((await (await f.request('/api/notifications', undefined, student.cookie)).json()).notifications.length, 0);
  assert.equal((await (await f.request('/api/notifications', undefined, other.cookie)).json()).notifications[0].notification_message, 'Focus B');
  const holiday = await f.sensitive(path, { notification_type: 'camp_holiday', notification_message: 'Holiday', notification_date: dates.today, person_id: other.user.id }, admin, {}, 'PUT');
  assert.equal(holiday.status, 200);
  assert.equal((await holiday.json()).notification.person_id, null);
  assert.equal((await (await f.request('/api/notifications', undefined, student.cookie)).json()).notifications[0].notification_message, 'Holiday');
  assert.equal((await f.request(path, undefined, admin, {}, false, 'DELETE')).status, 200);
  assert.equal((await f.request(path, undefined, admin, {}, false, 'DELETE')).status, 404);
  assert.equal((await f.sensitive(path, plan, admin, {}, 'PUT')).status, 404);
  assert.equal((await (await f.request('/api/notifications', undefined, other.cookie)).json()).notifications.length, 0);
});

test('plan requires a real student and future camp date; notification validation and retention hold', async (t) => {
  const f = fixture(t);
  const student = await f.approvedPlayer();
  const admin = await f.admin();
  const dates = sessionDates(f.env);
  const plan = { notification_date: dates.tomorrow, notification_type: 'coaching_plan', notification_message: 'Footwork', person_id: student.user.id };
  for (const change of [
    { person_id: null }, { person_id: 9999 }, { person_id: '1' }, { notification_date: dates.today },
    { notification_type: 'invalid' }, { notification_message: '' }, { notification_message: 'a'.repeat(2001) },
    { notification_date: '2000-01-01' }, { notification_date: '9999-02-30' }, { notification_date: null },
  ]) assert.equal((await f.sensitive('/api/admin/notifications', { ...plan, ...change }, admin)).status, 400);
  for (const date of ['2000-01-01', dates.today, '9999-12-31']) {
    f.db.prepare('INSERT INTO notifications(notification_date, notification_type, notification_message) VALUES (?, ?, ?)')
      .run(date, 'camp_holiday', date);
  }
  await f.request('/api/auth/me', undefined, student.cookie);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 2);
  assert.equal((await f.sensitive('/api/admin/notifications', plan, admin)).status, 201);
  f.db.prepare('DELETE FROM people WHERE id=?').run(student.user.id);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE notification_type='coaching_plan'").get().n, 0);
});
