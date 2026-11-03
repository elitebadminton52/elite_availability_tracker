import { HttpError, json } from './http.js';
import { decryptField, encryptField, readEncrypted, readPeople } from './privacy.js';

async function decodeNotice(env, notice) {
  return {
    ...notice,
    notification_message: notice.notification_type === 'coaching_plan' && notice.notification_message.startsWith('v1.') ?
      await decryptField(env, notice.notification_message, 'coaching-plan') : notice.notification_message,
  };
}

export async function playerNotifications(env, dates, player) {
  if (!player) throw new HttpError(403, 'Sign in as a player to view your camp notices');
  const { results } = await env.DB.prepare(
    `SELECT notification_id, notification_message, notification_date, notification_type
     FROM notifications
     WHERE (notification_type = 'camp_holiday' AND notification_date = ?)
        OR (notification_type = 'coaching_plan' AND notification_date = ? AND person_id = ?)
     ORDER BY notification_date, notification_id DESC`
  ).bind(dates.today, dates.tomorrow, player.person_id).all();
  return json({ date: dates.today, campDate: dates.tomorrow,
    notifications: await Promise.all(results.map((notice) => decodeNotice(env, notice))) });
}

export async function adminNotifications(request, env, pathname, dates) {
  const match = pathname.match(/^\/api\/admin\/notifications\/(\d+)$/);
  if (pathname === '/api/admin/notifications' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM notifications WHERE notification_date >= ? ORDER BY notification_date, notification_id DESC'
    ).bind(dates.today).all();
    return json({
      date: dates.today, tomorrow: dates.tomorrow, people: await readPeople(env),
      notifications: await Promise.all(results.map((notice) => decodeNotice(env, notice))),
    });
  }
  if (match && request.method === 'DELETE') {
    const removed = await env.DB.prepare('DELETE FROM notifications WHERE notification_id = ? RETURNING notification_id')
      .bind(Number(match[1])).first();
    if (!removed) throw new HttpError(404, 'Notification no longer exists. Refresh the list.');
    return json({ ok: true });
  }
  if (!((pathname === '/api/admin/notifications' && request.method === 'POST') ||
      (match && request.method === 'PUT'))) throw new HttpError(404, 'Not found');
  const body = await readEncrypted(request, env);
  const message = typeof body.notification_message === 'string' ? body.notification_message.trim() : '';
  const date = body.notification_date;
  const type = body.notification_type;
  if (type !== 'camp_holiday' && type !== 'coaching_plan') throw new HttpError(400, 'Select Camp holiday or Coaching plan');
  if (!message || message.length > 2000) throw new HttpError(400, 'Message or key focus items are required (max 2000 characters)');
  const minimum = type === 'coaching_plan' ? dates.tomorrow : dates.today;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date < minimum) {
    throw new HttpError(400, type === 'coaching_plan' ?
      'Select a camp date of tomorrow or later' : 'Select a valid display date of today or later');
  }
  let personId = null;
  if (type === 'coaching_plan') {
    personId = body.person_id;
    if (!Number.isSafeInteger(personId) || personId < 1) throw new HttpError(400, 'Select the student for this coaching plan');
    const person = await env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(personId).first();
    if (!person) throw new HttpError(400, 'Selected student no longer exists. Refresh the list.');
  }
  const storedMessage = type === 'coaching_plan' ? await encryptField(env, message, 'coaching-plan') : message;
  const notification = match ?
    await env.DB.prepare(
      `UPDATE notifications SET notification_message = ?, notification_date = ?, notification_type = ?, person_id = ?
       WHERE notification_id = ? RETURNING *`
    ).bind(storedMessage, date, type, personId, Number(match[1])).first() :
    await env.DB.prepare(
      `INSERT INTO notifications(notification_message, notification_date, notification_type, person_id)
       VALUES (?, ?, ?, ?) RETURNING *`
    ).bind(storedMessage, date, type, personId).first();
  if (!notification) throw new HttpError(404, 'Notification no longer exists. Refresh the list.');
  return json({ notification: await decodeNotice(env, notification) }, match ? 200 : 201);
}
