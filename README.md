# الحلم حقيقة — Web Platform

Cloudflare-first web platform for الحلم حقيقة.

## Included in this first migration baseline
- Existing Arabic RTL application interface copied into `public/index.html`.
- Cloudflare Worker entry point and static asset serving.
- D1 initial schema for accounts, user state, shared projects, and study sessions.
- Durable Object WebSocket room foundation with participant presence, shared focus phase, timer configuration, and chat events.
- `/api/health` endpoint.

## Important current limitation
Account registration/login and per-user D1 state persistence are now implemented. The browser keeps a local cache, but D1 is the source of truth after sign-in. Study room authorization, collaborative project membership, and observer invite-token authorization are still not implemented; do not expose private observer links until those layers are implemented.

## Setup
1. Create a GitHub repository and upload this project.
2. Install Node.js LTS, then run `npm install`.
3. Create D1 database: `npx wrangler d1 create el-helm-haqeqa-db`.
4. Copy the returned database ID into `wrangler.jsonc` replacing `REPLACE_WITH_D1_DATABASE_ID`.
5. Apply schema locally: `npx wrangler d1 migrations apply el-helm-haqeqa-db --local`.
6. Start locally: `npm run dev`.
7. Apply remotely: `npx wrangler d1 migrations apply el-helm-haqeqa-db --remote`.
8. Apply the new auth/session migration remotely: `npx wrangler d1 migrations apply el-helm-haqeqa-db --remote`.
9. Deploy: `npm run deploy`.

## API
- `GET /api/health` — Worker and D1 health.
- `GET /api/rooms/:roomId/status` — current in-memory room snapshot.
- `GET /api/rooms/:roomId?name=...` with WebSocket upgrade — join realtime room. Add `role=observer` for observer view (authorization is not yet implemented; keep private until token checks are added).

## Next implementation milestone
Next: add rate limiting and account recovery, then connect Study Rooms, collaborative projects, and Observer invite-token authorization.
