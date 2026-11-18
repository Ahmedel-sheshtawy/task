# Architecture — El-Helm Haqeqa v2

## Runtime
- Cloudflare Worker (`src/index.ts`) serves API routes and static assets.
- Cloudflare D1 is the authoritative persistence layer.
- Cloudflare Durable Object (`src/study-room.ts`) provides the study-room realtime endpoint; the Worker now requires an authenticated session before proxying room requests.
- Static frontend is separated into HTML, CSS, and JavaScript files under `public/`.

## Authentication flow
1. Registration validates display name, normalized email, and password length.
2. Password is derived with PBKDF2-SHA256, 100,000 iterations, and a random 16-byte salt. This matches the algorithm and parameters in the supplied education platform Worker.
3. A random opaque session token is generated. Only SHA-256(token) is stored in `auth_sessions`.
4. User row, empty `user_state`, and session row are inserted with one D1 batch.
5. Raw session token is issued as `__Host-hh_session; Secure; HttpOnly; SameSite=Lax; Path=/`.
6. Authenticated requests hash the cookie token, resolve the active session, and extend expiry.

## Data isolation and persistence
- Each user owns one `user_state` row, keyed by `user_id`.
- The browser cache is keyed by the authenticated user ID (`hh_state_<userId>`).
- Legacy unscoped local data is never silently attached to an account; the user must explicitly confirm import.
- Autosave serializes writes through a promise chain. Logout waits for the final cloud write and remains blocked if that write fails.
- `user_state.state_json` is currently a JSON document capped at 256 KiB. Normalized domain tables are a later migration, not claimed as complete in this foundation.

## Database migrations
- `0001_initial.sql`: users, state, projects, project membership, study sessions, and study events.
- `0002_auth_sessions.sql`: opaque session records and indexes.
- `0003_auth_password_salt.sql`: per-user password salt column.

## Security boundaries
- Browser write requests with an Origin header must match the request origin.
- Auth cookie is Secure, HttpOnly, SameSite=Lax, and host-only.
- Room API proxy requires a valid user session.
- No admin or room-invite authorization model is claimed in this release.
