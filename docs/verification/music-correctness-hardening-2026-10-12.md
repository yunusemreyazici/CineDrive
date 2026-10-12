# Music correctness hardening — 2026-10-12

## Scope

Targeted fixes from the cross-project review. No schema migration, production
catalogue operation, provider credential change, streaming contract removal or
deployment is required. Existing hard language/genre/year matching and the
seeded weighted selector remain unchanged.

## Server changes

- LRC sidecars are staged in a private sibling file and atomically renamed.
  Existing symlink/non-file destinations are rejected; a destination symlink
  raced in before rename is replaced, never opened for writing. Response paths
  remain basenames. The filesystem must still protect library directory entries
  from untrusted process-level mutation; Node does not provide portable dirfd
  relative rename primitives.
- Password changes use a conditional hash/account-state write, revoke previous
  sessions and create the replacement session in one transaction. Hashing stays
  outside the writer lock. Concurrent reset/disable cannot be overwritten.
- Discovery/AI/editorial/radio loading and final hydration share an accessible,
  active-track predicate. Hydrated playCount is scoped to the authenticated user.
- Replay retains the user's own historical totals but only exposes currently
  readable/active track, album and artist metadata. Track ranking filters before
  selecting top ten.
- Lyrics revision application claims the pending revision, backs up current
  content, writes normalized content/language and refreshes non-manual language
  evidence within one transaction. Explicit manual track-language overrides are
  preserved; ambiguous lyrics clear stale evidence.
- Every Connect command retry must match user/source/target/type/payload and
  conditional-seek identity; mismatches are rejected as command ID conflicts.
- Together serializes per-room edits/reads and per-user admission instead of
  using a global async queue. Async permission checks cannot resurrect closed or
  expired rooms; concurrent create/join still enforces one room per user.
- Editorial editions ignore mutable playCount/favorite and queue-bookkeeping
  timestamps when identifying the catalogue. Actual catalogue/access changes
  still invalidate plans. Cache hits rehydrate selected tracks to refresh
  favorites/play counts and recheck access. The cache evicts expired entries and
  is bounded to 128 editions; listener history is loaded on cache misses only.

## Web changes

- Listening history measures actual media progress bounded by elapsed monotonic
  time. Seeking, pausing and buffering break continuity; finishing a track does
  not substitute its full duration for listened time.
- Finalized meaningful sessions use the existing idempotent history batch API
  and retain event IDs for retry. Pending uploads are bounded in memory and
  account-scoped; this is not a durable offline outbox and abrupt browser/process
  termination can still lose unfinished or pending sessions.
- Replay sends an IANA timezone alongside the legacy UTC offset, and passes the
  query cancellation signal to the HTTP client.

## Regression coverage

- Sidecar: new/regular files, outside/inside/dangling symlinks, publication race,
  failed rename cleanup and authenticated endpoint error sanitization.
- Password: update/delete/create fault rollback, concurrent reset/disable and
  usable replacement session with old-session revocation.
- Catalogue: archived/missing tracks, separate listener play counts, revoked
  Replay membership and current editorial hydration.
- Lyrics: updated language, ambiguous evidence, manual override and repeated
  revision application.
- Editorial: daily reuse after listening/bookkeeping, access changes, concurrent
  deduplication and bounded/expired cache.
- Together: independent users and concurrent create/join, alongside existing
  same-room revision/readiness/access tests.
- Connect: identical retry and changed identity fields.
- Web: real listened time, seek-only playback, pause/buffering, short tracks,
  provider integration, failed-upload retry identity, account switch and timezone.

## Verification

Use the normal disposable test DB; do not point tests at the development or live
catalogue. Provider tests use mocks.

Verified: shared 30 tests, web 155 tests (one worker), server 441 tests including
the final added rollback case. All 94 music integration tests also passed in a
focused run. Editorial and
Discovery's final focused 20 tests also passed. Typecheck, zero-warning lint,
production build/bundle budget and documentation link validation passed.

```sh
pnpm --filter @cinedrive/server test
pnpm --filter @cinedrive/shared test
pnpm --filter @cinedrive/web exec vitest run --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

The first cross-platform parallel run caused host resource pressure and test
runner launch failures. Existing test timeouts were not increased. Verification
was rerun with one web worker and sequential native test runners. Final results
are recorded in the task handoff.

Optional follow-ups (not part of these fixes): persistent editorial editions,
durable browser/offline mutation outboxes, local audio-feature
analysis, physical-device latency/energy measurements and larger domain
extractions. They should not weaken hard constraints, ownership checks, or
existing retry/backoff policies.
