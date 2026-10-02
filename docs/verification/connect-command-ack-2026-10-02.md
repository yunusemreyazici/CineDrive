# Connect immutable ACK retry follow-up — 2026-10-02

## Task list

- [x] Commit previous conditional-seek work separately (`e07ea8f`; CineMusic `aafe8e6`).
- [x] Reproduce identical completed/failed result retries returning 404.
- [x] Add scoped, immutable ACK handling in the existing Connect command service.
- [x] Verify concurrent identical/conflicting results, user/device isolation and late revocation ACKs.
- [x] Run all server/shared/web tests, typecheck, lint and build.
- [x] Finish companion CineMusic final verification (804 unit tests; Catalyst compile) and commit this follow-up at the user's request.

## Behavior

The route retains authentication and the existing validated request schema.
An atomic conditional update transitions only `pending` results. If no transition
occurs, an indexed lookup restricted to command ID, authenticated user and target
client compares the already stored status and error message:

- Identical result: 200 `{ acknowledged: true }`, without rewriting `completedAt`.
- No scoped command: existing 404 `COMMAND_NOT_FOUND`; no cross-user result leakage.
- Different immutable result: 409 `COMMAND_ACK_CONFLICT`, without changing it.

The conditional update is the serialization point; the subsequent read never
performs another write. Permission revocation/expiry/removal results cannot be
replaced by a late successful ACK. Existing heartbeat, enqueue, selection,
Discovery, conditional-seek negotiation and payload contracts are unchanged.
This follow-up adds no schema migration, environment variable or dependency.

## Tests and verification

Regression tests cover both completed and failed replay, differing status or
message, unchanged timestamps, unauthenticated and wrong-user/device requests,
pending and terminal isolation, concurrent ACKs and permission revocation.

- `LOG_LEVEL=fatal MUSIC_AI_API_KEY= pnpm test`: **557 passed** (server 384, web 143, shared 30).
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with `--max-warnings 0`.
- `pnpm build`: passed, including the web bundle budget.
- `git diff --check`: passed.

The final focused ACK suite also passed 6 cases after test-only formatting.
Logs are `/tmp/cinedrive-connect-ack-all.log`,
`/tmp/cinedrive-connect-ack-final-focused.log`,
`/tmp/cinedrive-connect-ack-typecheck.log`, `/tmp/cinedrive-connect-ack-lint.log`
and `/tmp/cinedrive-connect-ack-build.log`; all verification commands exited 0.

Tests use disposable SQLite databases, including migration fixtures, and mock
providers. No live request, provider call, local catalogue migration, secret
output, push, PR, normal-client update or deployment took place.

Companion native changes are described in CineMusic's
`docs/verification/connect-command-ack-2026-10-02.md`. They retry cached ACKs
without repeating playback, stop on authorization errors, and localize known
failure codes. This is not a durable exactly-once playback execution guarantee
across receiver crashes.
