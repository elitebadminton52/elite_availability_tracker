import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './sqlite-fixture.js';
import { sessionDates } from './dates.js';

test('camp dates cover local midnight, year-end and leap-day boundaries', () => {
  for (const [now, today, tomorrow] of [
    ['2026-11-02T18:29:59Z', '2026-11-02', '2026-11-03'],
    ['2026-11-02T18:30:00Z', '2026-11-03', '2026-11-04'],
    ['2026-12-31T18:30:00Z', '2027-01-01', '2027-01-02'],
    ['2028-02-28T12:00:00Z', '2028-02-28', '2028-02-29'],
    ['2028-02-29T12:00:00Z', '2028-02-29', '2028-03-01'],
  ]) assert.deepEqual(sessionDates({ TIMEZONE: 'Asia/Kolkata' }, new Date(now)), { today, tomorrow });
  assert.equal(sessionDates({ TIMEZONE: 'America/Los_Angeles' }, new Date('2026-11-03T01:00:00Z')).today, '2026-11-02');
});

test('dashboard requires authentication, selects dates, and retains only today/tomorrow', async (t) => {
  const f = fixture(t);
  const player = await f.approvedPlayer();
  const dates = sessionDates(f.env);
  for (const [date, status] of [['2000-01-01', 'available'], [dates.today, 'available'], [dates.tomorrow, 'not_available'], ['9999-12-31', 'available']]) {
    f.db.prepare('INSERT INTO availability(person_id, session_date, status) VALUES (?, ?, ?)').run(player.user.id, date, status);
  }
  assert.equal((await f.request('/api/availability')).status, 401);
  assert.equal((await f.request('/api/availability', undefined, player.cookie)).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM availability').get().n, 2);
  const admin = await f.admin();
  for (const [query, expectedDate, available] of [['', dates.tomorrow, 0], ['?day=today', dates.today, 1], ['?day=tomorrow', dates.tomorrow, 0]]) {
    const response = await f.request(`/api/availability${query}`, undefined, admin);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.date, expectedDate);
    assert.equal(data.available.length, available);
    assert.equal(data.totalPeople, 1);
    assert.equal((data.available[0] || data.notAvailable[0]).name, 'Test Player');
  }
  assert.equal((await f.request('/api/availability?day=yesterday', undefined, admin)).status, 400);
});

test('only the logged-in player can submit; updates preserve today and reject spoofed IDs', async (t) => {
  const f = fixture(t);
  const player = await f.approvedPlayer();
  const other = await f.approvedPlayer('other.player', 'Other Player');
  const dates = sessionDates(f.env);
  f.db.prepare('INSERT INTO availability(person_id, session_date, status) VALUES (?, ?, ?)').run(player.user.id, dates.today, 'available');
  assert.equal((await f.request('/api/availability', { status: 'available' })).status, 401);
  assert.equal((await f.request('/api/availability', { personId: 999, status: 'available' }, player.cookie)).status, 400);
  assert.equal((await f.request('/api/availability', { status: 'maybe' }, player.cookie)).status, 400);
  for (const status of ['available', 'not_available']) {
    const response = await f.request('/api/availability', { status }, player.cookie);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).date, dates.tomorrow);
    assert.equal(f.db.prepare('SELECT status FROM availability WHERE session_date = ?').get(dates.tomorrow).status, status);
  }
  assert.equal(f.db.prepare('SELECT status FROM availability WHERE session_date = ?').get(dates.today).status, 'available');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM availability').get().n, 2);
  const own = await (await f.request('/api/availability/me', undefined, player.cookie)).json();
  assert.deepEqual(own, { date: dates.tomorrow, status: 'not_available' });
  const otherOwn = await (await f.request(`/api/availability/me?personId=${player.user.id}`, undefined, other.cookie)).json();
  assert.deepEqual(otherOwn, { date: dates.tomorrow, status: null });
  assert.equal((await f.request('/api/availability/me')).status, 401);
});
