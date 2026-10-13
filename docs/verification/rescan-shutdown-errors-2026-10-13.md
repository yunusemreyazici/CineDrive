# Rescan shutdown lease and web error reporting — 2026-10-13

## Observed failure

Read-only live inspection showed an admitted Drive source scan (HTTP 202) later
interrupted by server shutdown. Subsequent source/full scans returned HTTP 409.
No scan remained running, but its ten-minute operation lease still blocked
admission. Separately, web mutations normalized an API error and the toast
normalized it again, losing the server's explanation and request ID.

No live catalogue, tokens, rooms, scan rows or leases were modified to diagnose
or work around this failure.

## Fix

- Track Drive and local scan execution independently of active/running status.
  Interruption can remove active state before the underlying I/O finishes.
- On orderly shutdown, reject new registrations, abort active scans and drain
  tracked execution, including its token-scoped lease release, before Prisma
  disconnects. Already-interrupted but still-draining work is included.
- Never clear a lease while old work can still write; stale workers retain the
  existing token check and cannot release another operation's lease.
- Make `parseApiError` idempotent for the fully validated internal error shape.
  Toasts retain structured status/code/message/request ID. Malformed shapes
  still receive the safe generic fallback.

No migration or breaking API change. Hard-killed processes still rely on the
existing lease expiry; this fix does not bypass locks or clear them at startup.
Graceful shutdown may wait for in-flight bounded I/O to finish.

## Verification

- Focused scan/lifecycle/library suites: 30 passed across 4 files.
- Focused web toast/hooks suites: 26 passed across 2 files.
- Regression verifies aborted execution drains before DB disconnect, lease
  release persists, and a subsequent scan acquires immediately after shutdown.
  Existing stale-token/replacement-operation protections remain passing.
- Tests cover already-interrupted draining work, rejected executions, shutdown
  registration rejection and normalized 409/network/auth/server errors.
  Missing/malformed fields are rejected without exposing arbitrary objects.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`: passed.
- Full combined verification with automatic lyrics work: server 502 tests / 65
  files, shared 30 / 4 and web 177 / 34 passed; docs link check passed.

Changes coexist with pending automatic missing-lyrics work on
`codex/automatic-missing-lyrics` for review packaging. No production deployment performed.
