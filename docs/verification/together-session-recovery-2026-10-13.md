# Together session recovery — 2026-10-13

## Scope

Companion CineMusic QA reproduced successful admission before owner binding:
membership persisted on the server while a late client activation discarded
local state. Subsequent admissions returned 409 and the missing local key could
not restore the old room. This server change provides an additive recovery path;
it does not relax the one-room-per-account rule or reset live rooms.

- Authenticated `GET /api/music/listening-sessions/current?clientId=...` returns
  only `{ sessionId: string | null }` for exact account/device membership.
- No participant, invitation, queue, lyrics or track metadata is returned. A
  different account/device receives null, not another participant's identity.
- The bounded in-memory room store and existing expiration behavior are reused.
- Responses are private/no-store. Full snapshot and streaming requests retain
  existing library and active-file access checks.
- Identity-only lookup permits explicit departure even after access is revoked.
- `listeningSessionRecovery` is an optional additive bootstrap capability.
  Existing clients and endpoints remain compatible; no migration or env change.

## Verification

- Focused Together service/HTTP/WebSocket suite: 16 passed across 2 files.
- Full server suite: 492 passed across 64 files.
- Shared: 30 passed across 4 files; web: 164 passed across 34 files.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed. Web bundle budget unchanged
  at 371.43 kB raw / 108.60 kB gzip.
- Tests cover anonymous rejection, invalid client ID, no membership, exact
  account/device isolation, guest recovery, host departure, room expiry, private
  cache policy, revoked-track access still denied and authenticated departure.
- Existing two-party readiness, scheduled future start, command revision,
  invitation/access and WebSocket tests remain passing.

No live accounts, rooms, production database or deployment were changed. Work is
on `codex/together-session-recovery`; commit/push/deploy are separate steps.
