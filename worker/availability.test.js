import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from './index.js';
import { sessionDates } from './dates.js';

test('dates use the camp timezone across midnight, month, year, and leap-day boundaries', () => {
  const cases = [
    ['2026-11-02T18:29:59Z', '2026-11-02', '2026-11-03'],
    ['2026-11-02T18:30:00Z', '2026-11-03', '2026-11-04'],
    ['2026-12-31T18:30:00Z', '2027-01-01', '2027-01-02'],
    ['2028-02-28T12:00:00Z', '2028-02-28', '2028-02-29'],
    ['2028-02-29T12:00:00Z', '2028-02-29', '2028-03-01'],
  ];
  for (const [now, today, tomorrow] of cases) {
    assert.deepEqual(sessionDates({ TIMEZONE: 'Asia/Kolkata' }, new Date(now)), { today, tomorrow });
  }
  assert.deepEqual(sessionDates({ TIMEZONE: 'America/Los_Angeles' }, new Date('2026-11-03T01:00:00Z')), {
    today: '2026-11-02',
    tomorrow: '2026-11-03',
  });
});

function fixture() {
  const dates = sessionDates({ TIMEZONE: 'Asia/Kolkata' });
  const people = [{ id: 1, name: 'Today Player' }, { id: 2, name: 'Tomorrow Player' }, { id: 3, name: 'No Response' }];
  let rows = [
    { person_id: 1, session_date: '2000-01-01', status: 'available' },
    { person_id: 1, session_date: dates.today, status: 'available' },
    { person_id: 2, session_date: dates.tomorrow, status: 'not_available' },
    { person_id: 3, session_date: '9999-12-31', status: 'available' },
  ];
  const operations = [];
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async run() {
          operations.push(sql);
          if (sql.startsWith('DELETE FROM availability WHERE session_date NOT IN')) {
            rows = rows.filter((row) => args.includes(row.session_date));
          } else if (sql === 'DELETE FROM notifications WHERE notification_date < ?') {
            return;
          } else if (sql.startsWith('INSERT INTO availability')) {
            const [id, date, status] = args;
            rows = rows.filter((row) => row.person_id !== id || row.session_date !== date);
            rows.push({ person_id: id, session_date: date, status });
          } else {
            assert.fail(`Unexpected run: ${sql}`);
          }
        },
        async all() {
          operations.push(sql);
          if (sql.startsWith('SELECT id, name FROM people')) return { results: people };
          assert.match(sql, /WHERE a.session_date = \?/);
          return {
            results: rows.filter((row) => row.session_date === args[0]).map((row) => ({
              ...people.find((person) => person.id === row.person_id),
              status: row.status,
            })),
          };
        },
        async first() {
          operations.push(sql);
          if (sql.startsWith('SELECT COUNT(*)')) return { total: people.length };
          assert.match(sql, /SELECT id, name FROM people WHERE id = \?/);
          return people.find((person) => person.id === args[0]) ?? null;
        },
      };
    },
  };
  return { env: { DB, TIMEZONE: 'Asia/Kolkata' }, dates, people, operations, rows: () => rows };
}

test('dashboard reads today or tomorrow, defaults to tomorrow, and rejects other dates', async () => {
  const { env, dates } = fixture();
  for (const query of ['', '?day=tomorrow', '?day=today']) {
    const response = await worker.fetch(new Request(`https://camp.test/api/availability${query}`), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    const today = query === '?day=today';
    assert.equal(data.date, today ? dates.today : dates.tomorrow);
    assert.deepEqual(data.available.map((p) => p.name), today ? ['Today Player'] : []);
    assert.deepEqual(data.notAvailable.map((p) => p.name), today ? [] : ['Tomorrow Player']);
    assert.equal(data.totalPeople, 3);
  }
  for (const day of ['yesterday', dates.today, '']) {
    const response = await worker.fetch(new Request(`https://camp.test/api/availability?day=${day}`), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'day must be today or tomorrow');
  }
});

test('loading any app page cleans out-of-window responses before its API runs, preserving players', async () => {
  for (const path of ['/api/people', '/api/availability', '/api/admin/me']) {
    const { env, dates, rows, people, operations } = fixture();
    await worker.fetch(new Request(`https://camp.test${path}`), env);
    assert.match(operations[0], /^DELETE FROM availability WHERE session_date NOT IN/);
    assert.deepEqual(rows().map((row) => row.session_date).sort(), [dates.today, dates.tomorrow].sort());
    assert.equal(people.length, 3);
    await worker.fetch(new Request(`https://camp.test${path}`), env);
    assert.equal(rows().length, 2);
  }
});

test('submissions still upsert tomorrow without altering today', async () => {
  const { env, dates, rows } = fixture();
  for (const status of ['available', 'not_available']) {
    const response = await worker.fetch(new Request('https://camp.test/api/availability', {
      method: 'POST',
      body: JSON.stringify({ personId: 1, status }),
      headers: { 'Content-Type': 'application/json' },
    }), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).date, dates.tomorrow);
    assert.equal(rows().filter((row) => row.person_id === 1 && row.session_date === dates.tomorrow).length, 1);
    assert.equal(rows().find((row) => row.person_id === 1 && row.session_date === dates.tomorrow).status, status);
    assert.equal(rows().find((row) => row.session_date === dates.today).status, 'available');
  }
});

test('cleanup failure is reported as a server error, not a successful load', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (error) => logs.push(error));
  const failure = new Error('Database unavailable');
  const DB = {
    prepare() {
      return { bind() { return this; }, async run() { throw failure; } };
    },
  };
  const response = await worker.fetch(new Request('https://camp.test/api/people'), { DB });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Internal server error');
  assert.deepEqual(logs, [failure]);
});
