# Elite Badminton - Availability Tracker

React + Vite frontend, Cloudflare Worker API, and Cloudflare D1 database.
Use Node.js 22.8 or later for development and the built-in SQLite regression tests.

## Player access

- `/login`: sign in with a username and password, or request a new account with a
  full name, unique username, and password. Usernames are case-insensitive,
  3-32 letters/numbers/dots/underscores/hyphens. Passwords must be 12-128 characters.
- New registrations are **pending** and cannot sign in until approved by the coach.
  The username is reserved immediately, including while pending or rejected.
- `/admin`, **Manage people**: review registration requests. Approve by linking an
  existing camp player (preserving their ID and availability history) or creating
  a new player. Only one account can link to each player. Duplicate player names
  require linking instead of creating another player. Requests can also be rejected.
- `/`: signed-in players see "Hi [name]", tomorrow's session date, and Available /
  Not Available buttons. The latest response wins. No name dropdown is shown.
  Once a response is saved (including after reloading), the buttons are replaced
  by "You already marked as [status]" and **Change your response**. Selecting
  that option reveals the two buttons; a successful update hides them again.
  A failed update keeps the buttons available for retry and preserves the saved status.
- `/dashboard`: **coach-only**, accessed through the Availability dashboard link
  inside the admin page. Select Today or Tomorrow (default), view available
  players and response counts. Data refreshes every 30 seconds. Normal players
  cannot open the dashboard or retrieve its data through the API.
- Player names, dashboards, and camp notices are no longer public API data.
  `/api/people` is coach-only. A player cannot submit on behalf of another player.
- A persistent HttpOnly cookie restores the login on page load. No passwords,
  tokens, or profile data are saved in localStorage. The browser manages the cookie;
  it has a sliding 400-day lifetime (browser limits/privacy settings may shorten it).
  Log out revokes the server session as well as clearing the cookie. Removing a
  camp player deletes their account and revokes all their device sessions.

## Admin and notifications

The coach still signs in separately at `/admin` using `ADMIN_PASSWORD`.
**Manage people** and **Set notifications** are separate keyboard-accessible tabs;
drafts are preserved when switching between them.

Admins can create, edit, or delete **Camp holiday** or **Coaching plan** notices
from Set notifications. Messages/key focus items support up to 2000 characters.
Holiday notices use a display date of today or later and appear to all signed-in
players on that date. Holiday notices do not disable availability submissions.

Coaching plans require a student selection and key focus items (one per line is
supported). The date is the **camp date**, tomorrow or later. A plan for tomorrow
appears to the assigned student today as they mark tomorrow's availability.
Other students cannot retrieve or see it. Plans for later camp dates stay hidden
until the day before. Editing can change the recipient, date, content, or type.
Deleting removes the notice immediately; already-open forms update on their next
30-second refresh or window focus.

All dates use `TIMEZONE` in `wrangler.jsonc` (default `Asia/Kolkata`).
Existing coaching plans without a student assignment remain visible to the admin
but are hidden from every student until edited to assign a student and a future
camp date. A student can be a camp player awaiting an account; visibility begins
when their approved account links to that camp player.

The `notifications` table contains `notification_id`, `notification_message`,
`notification_date`, `notification_type` (`camp_holiday` / `coaching_plan`), and
`person_id` (required by the API for coaching plans; null for holidays).
Deleting a camp player also deletes their individual plans.

On every API request, the server deletes availability outside today/tomorrow,
past-dated notices, expired sessions, and expired authentication request records.
Future notices and camp players are retained. Cleanup is request-driven; if nobody
uses the app, cleanup waits until the next API request.

## Passwords and personal data

- Production must use **HTTPS**. TLS protects the entire request/response, including
  profile names displayed by authorized screens. The app adds browser-side hybrid
  encryption (RSA-OAEP/SHA-256 wrapping a random AES-256-GCM key) to login,
  registration, username checks, admin login, and new-player requests. Passwords
  and submitted profile fields are not plaintext JSON fields on the wire.
- Encrypted requests are bound to an endpoint, expire after five minutes, and have
  single-use nonces. Sign-in/registration/username-check endpoints are rate-limited
  using database-backed, keyed IP lookup hashes, not raw IP addresses.
- Passwords are **one-way hashed**, not reversibly encrypted: PBKDF2-HMAC-SHA-256,
  independent random 16-byte salts, 100,000 iterations (Cloudflare Web Crypto's
  supported limit), with the iteration count recorded for future upgrades.
- Player names, registration names, and usernames are AES-256-GCM encrypted in D1.
  Separate-purpose keyed lookup hashes enforce uniqueness without plaintext indexes.
  IDs, approval status, dates, and availability statuses remain queryable metadata.
  Individual coaching-plan content is encrypted in D1 using AES-256-GCM;
  holiday messages remain readable in D1. Notification create/edit API requests
  use encrypted envelopes.
- Session tokens are random, stored only as SHA-256 hashes in D1, and issued as
  Secure, HttpOnly, SameSite=Strict cookies. Mutating cross-origin requests are rejected.
- Existing names are converted to encrypted values in place on the first app API
  request after the keys and migration are installed. IDs and responses remain
  intact. Historical backups/exports made before this update can still contain
  plaintext names; manage those separately.
- `AUTH_PRIVATE_KEY` and `PERSONAL_DATA_KEY` are server secrets, never Vite client
  variables. Back them up securely. **Do not regenerate the data key after data
  has been encrypted**: existing profiles would become unreadable. Key rotation
  requires an explicit decrypt/re-encrypt migration. Do not copy production keys
  or production profile data into development.

## Run locally

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars # Only for a NEW local setup; do not overwrite existing secrets!
# Edit ADMIN_PASSWORD and SESSION_SECRET in .dev.vars.
npm run auth:setup:local             # Once; appends encryption keys to ignored .dev.vars
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173. Register a player account, sign in as coach at `/admin`,
approve the request, then sign in as that player. Existing camp players do not
automatically get accounts or default passwords.

```powershell
npm test       # Real SQLite integration tests and Web Crypto tests
npm run build
```

## Deploy or upgrade

Authenticate Wrangler in your terminal, using `CLOUDFLARE_API_TOKEN` if browser
OAuth is unavailable. Do not commit the token or paste it into chat.

For a new database, run `npx wrangler d1 create elite-availability` and put its
`database_id` in the `DB` binding in `wrangler.jsonc`. Reuse the existing database
when upgrading.

Generate production encryption keys **once**:

```powershell
npm run auth:keys:production
npx wrangler secret bulk .auth-secrets.json
```

The generator writes an ignored `.auth-secrets.json`, refuses to overwrite an
existing file, and never prints key values. Keep a secure backup before deleting
the local file. On subsequent deployments reuse the installed secrets; do not
run the generator again or upload different keys for an existing database.

Set the existing admin secrets if not already configured:

```powershell
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

Apply migrations **before deploying** the updated Worker:

```powershell
npm run db:migrate:remote
npm run deploy
```

The account update adds `0003_player_accounts.sql`; student-targeted plans add
`0004_student_plans.sql`. Run pending migrations before deploying. The notification migration tolerates
databases where the notification table was previously created by the initial
migration. No player or availability table is dropped.

After deployment, sign in as coach and open Manage people to encrypt legacy
player names and process registrations. Verify one player registration, approval,
sign-in, response, reload, and logout on the deployed HTTPS site.

## API

| Method | Path | Access / purpose |
| --- | --- | --- |
| GET | `/api/auth/key` | Public encryption key only |
| POST | `/api/auth/username` | Encrypted `{ username }`; uniqueness check |
| POST | `/api/auth/register` | Encrypted `{ name, username, password }`; request approval |
| POST | `/api/auth/login` | Encrypted `{ username, password }`; approved players only |
| GET | `/api/auth/me` | Player session/profile; refresh persistent cookie |
| POST | `/api/auth/logout` | Revoke this device session |
| GET | `/api/availability?day=today` or `tomorrow` | Coach only; tomorrow is default |
| GET | `/api/availability/me` | Player only; tomorrow's date and their own status, no other players |
| POST | `/api/availability` | Player only; `{ status }`, identity comes from cookie |
| GET | `/api/notifications` | Player only; today's holidays and their own tomorrow coaching plans |
| POST | `/api/admin/login` | Encrypted `{ password }`; coach login |
| POST | `/api/admin/logout` | Clear coach session |
| GET | `/api/admin/me` | Check coach session |
| GET | `/api/people` | Coach only; decrypted names |
| POST | `/api/admin/people` | Coach; encrypted `{ name }` |
| DELETE | `/api/admin/people/:id` | Coach; remove player, account, sessions, responses |
| GET | `/api/admin/registrations` | Coach; pending registrations and unlinked players |
| POST | `/api/admin/registrations/:id/approve` | Coach; `{ personId }`, null creates new player |
| POST | `/api/admin/registrations/:id/reject` | Coach; reject a pending registration |
| GET / POST | `/api/admin/notifications` | Coach; list with student choices / schedule encrypted notice |
| PUT / DELETE | `/api/admin/notifications/:id` | Coach; edit encrypted notice / delete notice |

Encrypted request bodies are `{ key, iv, ciphertext }` envelopes produced with
the public key. Decrypted payloads include the endpoint, timestamp and nonce.
Plaintext credential requests are rejected. Admin passwords remain deployment
secrets; changing `SESSION_SECRET` invalidates coach sessions.
