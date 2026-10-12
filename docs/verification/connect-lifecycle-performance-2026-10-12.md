# Connect lifecycle and test isolation — 2026-10-12

## Changes

- Long-poll waiters accept an AbortSignal. Client abort/unfinished response
  disconnect releases the timer/listener and prevents another command read.
  Normal completed request events do not cancel a healthy long poll.
- Server preClose drains outstanding waiters before database teardown. Register
  before the second query to preserve protection against missed command wakeups.
- Waiter capacity is bounded: 4,096 overall and eight per user/device key.
  Excess long polls get HTTP 429; retry/receipt and capability contracts remain
  unchanged. Polls that already have commands do not allocate a waiter.
- Source-device status polls can expire their own pending command even when the
  receiver is offline. User/source scope is enforced before the conditional
  write; a final read preserves a racing terminal ACK. Ordinary polls remain
  read-only.
- Background receipt retention uses the existing expiry index. Every five
  minutes, one batch of at most 400 receipts is eligible after both expiry and
  terminal acknowledgement are older than seven days. Expired orphaned pending
  rows are eligible too. A guarded delete preserves concurrent fresh ACKs.
  First batch runs at server readiness outside tests; shutdown stops scheduling
  and awaits in-flight work. Failures retry on the next scheduled interval.

Only expired protocol command rows are removed. Listening history, playlists,
favorites and playback queues are untouched. Seven days exceeds the 45-second
command lifetime and the client's five-minute receipt window. No migration,
environment changes or native request/response schema change is required.

## Test isolation

Each Vitest invocation allocates its own OS-temp directory/database. The exact
URL is passed through project test environment to global setup and workers.
Global setup validates the absolute invocation-owned location before migration
and teardown. Cleanup removes only that database, its known SQLite sidecars and
the empty directory; migration failure follows the same cleanup path.

Tests within one server invocation remain serial because they share its database.
Separate invocations no longer use the same fixed filename. Development and live
databases are not test targets.

## Regression coverage and verification

New tests cover real-socket disconnect, shutdown drain, unauthorized expiry,
source expiry without receiver activity, waiter timeout/capacity, notification
scope, stale/active/boundary receipts, batched cleanup, concurrent cleanup calls,
late ACK preservation and separate temporary DB paths.

```sh
pnpm --filter @cinedrive/server test
pnpm --filter @cinedrive/server exec vitest run tests/music-command-waiter.test.ts tests/music-connect-maintenance.test.ts
pnpm --filter @cinedrive/shared test
pnpm --filter @cinedrive/web exec vitest run --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
pnpm docs:check
git diff --check
```

The first full run exposed a missing required name in a new fixture (not a
production error). The fixture was corrected and the complete package rerun.
Final results: server 452 tests across 59 files, shared 30, web 155 (one worker),
all passed. Typecheck, zero-warning lint, production build/bundle budget,
documentation links and diff whitespace checks passed.

The complete server invocation and a separate six-test Connect invocation ran
simultaneously, both passed, used distinct disposable database directories and
removed their own directories at teardown. No test timeout was increased.

Native/socket/cache build commands require local sandbox escalation; production
data, secrets, accounts and deployment were not changed.
