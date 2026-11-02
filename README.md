# 🏸 Elite Badminton – Availability Tracker

Players mark whether they'll attend **tomorrow's** coaching session; the coach sees who's coming.

- **Frontend:** React + Vite + React Router
- **Backend:** Cloudflare Worker (`worker/index.js`) serving `/api/*` and the built React app
- **Database:** Cloudflare D1 (SQLite)

## Pages

| Route        | Who     | What                                                                 |
| ------------ | ------- | -------------------------------------------------------------------- |
| `/`          | Players | Searchable name dropdown + **Available** / **Not Available** buttons |
| `/dashboard` | Players | Choose Today or Tomorrow (default), see available players and counts; auto-refreshes |
| `/admin`     | Coach   | Password login; separate Manage people and Set notifications tabs |

The admin view opens on **Manage people**. Switch to **Set notifications** to
schedule notices. Form entries are preserved while switching tabs; the tabs also
support Left/Right arrow keys, Home, and End.

## Camp notifications

The admin page includes a notification form for **Camp holiday** or **Coaching plan**,
a message (up to 2000 characters), and a display date of today or later.
The availability form shows every notice scheduled for the current calendar date
in the camp timezone, not the next day's session date. Future notices remain hidden
until that date. Holiday notices are informational and do not block responses.
Notices refresh every 30 seconds and when the window regains focus.

The `notifications` table has `notification_id`, `notification_message`,
`notification_date` (YYYY-MM-DD), and `notification_type` (`camp_holiday` or
`coaching_plan`). The type column uses the corrected spelling `notification_type`.
Every API request deletes notifications dated before today, while keeping today's
and all future notices. As with availability cleanup, deletion waits for a request
if nobody is using the app. Scheduled notices are listed in the admin view.

**Updating an existing deployment:** run `npm run db:migrate:remote` **before**
`npm run deploy` to create the notifications table. Locally, run
`npm run db:migrate:local` before starting the updated app.

"Tomorrow" is calculated on the server using the `TIMEZONE` var in `wrangler.jsonc` (default `Asia/Kolkata`).
A player can change their answer any time; the latest answer wins.
The form always submits for tomorrow. The dashboard can display today or tomorrow,
using the same server timezone regardless of the device's timezone.
The form hides players who have already responded for tomorrow (both available and
not available). Use **Change my response** to show all players and update an answer.
Successful submissions immediately remove the player from the default list; saved
name selections are only restored if that player has not responded. Today's
responses do not exclude a player from tomorrow's form.

Only today's and tomorrow's availability is retained. On every API request
(including the requests made when loading the form, dashboard, or admin page),
the server deletes records for all other dates before processing the request.
This permanently removes older responses and any out-of-window future records,
but never deletes camp players. Cleanup also runs on dashboard auto-refresh.
It is request-driven: if nobody uses the app, cleanup waits until the next API request.

## API

| Method | Path                     | Auth  | Description                                     |
| ------ | ------------------------ | ----- | ----------------------------------------------- |
| GET    | `/api/people`            | –     | List players                                    |
| GET    | `/api/availability`      | –     | `?day=today` or `?day=tomorrow` (default); selected date + available / not available; other values return 400 |
| POST   | `/api/availability`      | –     | `{ personId, status: "available" \| "not_available" }` |
| POST   | `/api/admin/login`       | –     | `{ password }` → sets HttpOnly session cookie   |
| POST   | `/api/admin/logout`      | –     | Clears session                                  |
| GET    | `/api/admin/me`          | Admin | Check session                                   |
| POST   | `/api/admin/people`      | Admin | `{ name }` add player                           |
| DELETE | `/api/admin/people/:id`  | Admin | Remove player (and their responses)             |
| GET    | `/api/notifications` | – | Today's camp notices and server date |
| GET    | `/api/admin/notifications` | Admin | Today's and future notices, plus server date |
| POST   | `/api/admin/notifications` | Admin | `{ notification_type, notification_message, notification_date }` |

## Run locally

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars   # then edit ADMIN_PASSWORD / SESSION_SECRET
npm run db:migrate:local               # creates the local D1 tables
npm run dev                            # http://localhost:5173
```

Run `npm test` for timezone, dashboard API, retention, and submission regression tests,
and `npm run build` to validate the production build.

## Deploy to Cloudflare

1. Log in: `npx wrangler login`
2. Create the database and copy the printed `database_id` into `wrangler.jsonc`:
   ```powershell
   npx wrangler d1 create elite-availability
   ```
3. Create the tables in the remote database:
   ```powershell
   npm run db:migrate:remote
   ```
4. Set the admin secrets (you'll be prompted for the values; use a long random string for `SESSION_SECRET`):
   ```powershell
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```
5. Build and deploy:
   ```powershell
   npm run deploy
   ```
   Wrangler prints your URL, e.g. `https://elite-availability-tracker.<your-subdomain>.workers.dev`.
   Share `/` and `/dashboard` with players; keep `/admin` for yourself.

To change the admin password later, re-run `npx wrangler secret put ADMIN_PASSWORD`.

## Notes

- `.npmrc` pins this project to the public npm registry.
- Changing `SESSION_SECRET` logs out all admin sessions.
