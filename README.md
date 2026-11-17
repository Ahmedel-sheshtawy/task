# Sara Essam — Web Platform

Cloudflare-first web migration of the existing Sara Essam app.

## Included in this first migration baseline
- Existing Arabic RTL application interface copied into `public/index.html`.
- Cloudflare Worker entry point and static asset serving.
- D1 initial schema for accounts, user state, shared projects, and study sessions.
- Durable Object WebSocket room foundation with participant presence, shared focus phase, timer configuration, and chat events.
- `/api/health` endpoint.

## Important current limitation
The legacy interface still stores its personal app state in browser `localStorage`. D1 tables and room realtime foundation are prepared, but account authentication, secure cloud-state sync, project collaboration UI, and observer invite-token authorization are not yet wired. Do not treat this baseline as production-ready or expose private observer links until those layers are implemented.

## Setup
1. Create a GitHub repository and upload this project.
2. Install Node.js LTS, then run `npm install`.
3. Create D1 database: `npx wrangler d1 create sara-essam-db`.
4. Copy the returned database ID into `wrangler.jsonc` replacing `REPLACE_WITH_D1_DATABASE_ID`.
5. Apply schema locally: `npx wrangler d1 migrations apply sara-essam-db --local`.
6. Start locally: `npm run dev`.
7. Apply remotely: `npx wrangler d1 migrations apply sara-essam-db --remote`.
8. Deploy: `npm run deploy`.

## API
- `GET /api/health` — Worker and D1 health.
- `GET /api/rooms/:roomId/status` — current in-memory room snapshot.
- `GET /api/rooms/:roomId?name=...` with WebSocket upgrade — join realtime room. Add `role=observer` for observer view (authorization is not yet implemented; keep private until token checks are added).

## Next implementation milestone
Authentication + encrypted/session-based authorization, then cloud persistence and a migration/import flow from existing `sara_state` local data. After that, connect the Study Rooms and Observer screens to Durable Objects.
