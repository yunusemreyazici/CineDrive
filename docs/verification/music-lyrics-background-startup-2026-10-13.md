# Lyrics index startup recovery — 2026-10-13

## Incident evidence

The first production upgrade to `bcdaaa9` successfully applied the lyrics-search
migration, but the newly added awaited `onReady` backfill exceeded Fastify's hook
timeout. Logs showed `FST_ERR_HOOK_TIMEOUT` / `AVV_ERR_READY_TIMEOUT`; systemd
restarted the process twice. Completed batches persisted, so the third startup
completed and served requests. The installer's short readiness retry window had
already reported a failed deployment.

Read-only checks on October 13: internal and external `/api/health` and
`/api/ready` returned 200; 8,216 persisted lyrics, zero null search documents;
service active/running with two restarts. No manual restart, rollback, database
restore or original-lyrics access was performed. A live startup timeout fix was
not deployed by this task.

## Fix

- `onReady` no longer awaits lyrics backfill. `onListen` schedules one background
  worker and returns immediately, after the socket can accept requests.
- The existing ten-row, short-transaction, content-checked, provider-free backfill
  is preserved. It now observes cancellation before selecting and after reading
  a batch. An already-started transaction completes atomically, then no new batch
  starts. Completed search documents remain resumable on restart.
- The worker deduplicates starts, contains failures and retries after 30 seconds
  with exponential backoff capped at five minutes. Only one run/timer is active;
  scheduled timers are unreferenced and cancelled on shutdown.
- `preClose` signals cancellation and drains the active job before Prisma's
  `onClose` disconnects the database. Failure during shutdown does not schedule a
  retry. Logs contain start/completion/generic retry status, not lyrics or secrets.
- No global Fastify timeout increase, installer timeout workaround, migration,
  provider retry change, public DTO change or CineMusic change is needed.
- Health/readiness continue to indicate core database/schema availability, not
  completion of an optional derived index. Old lyrics matches appear progressively
  while pending rows are indexed; normal metadata search remains available.

## Verification

Regression coverage:

- Real Fastify readiness resolves before a deliberately unfinished backfill can
  start; after listen, health/readiness remain 200 while that task stays pending.
  Closing signals abort and cannot disconnect Prisma before the job drains.
- A rejected background job leaves the API ready and is handled without a process
  rejection. Virtual-clock tests cover single-flight scheduling, retry/backoff cap,
  cancellation of scheduled/retry work, and suppression of shutdown retries.
- 10,000 simulated old documents are processed with 1,000 ten-row transactions;
  no full fixture catalog is held in memory and no external provider is called.
- Already-aborted work performs no DB operation; abort after selection does not
  write. A real SQLite row remains pending and is successfully indexed on resume
  without changing its original content or `updatedAt`.
- Abort inside a started transaction lets all ten writes complete, then prevents
  selection of another batch. Existing access, update, revision, deletion and
  production migration-path tests remain relevant.

The startup regression was run against a temporary reintroduction of the old
awaited `onReady` call. It failed deterministically with `index-inside-ready`
instead of `core-ready`, without a real ten-second sleep. The fix was restored
immediately. The initial focused suite had passed 17 tests before adding the
final transaction-drain case. This intentionally failing red run is separate
from final verification of the fixed code.

Final verification of the fixed code:

- `pnpm --filter @cinedrive/server test`: **489 tests / 64 files passed**, including
  all lyrics/migration/access regressions and the final transaction-drain case.
- `pnpm --filter @cinedrive/shared test`: **30 tests / 4 files passed**.
- `pnpm --filter @cinedrive/web exec vitest run --maxWorkers=1`: **155 tests / 34
  files passed**.
- `pnpm typecheck`: passed for shared, server and web.
- `pnpm lint`, `pnpm build`, `pnpm docs:check`: passed. The web entry bundle budget
  passed at 371.24 kB raw / 108.48 kB gzip; existing image caches/quality are unchanged.
- `git diff --check`: passed. No CineMusic source changes or new migration.

This work is packaged on `codex/lyrics-index-background` for review alongside
the web login session handoff fix. No live deployment was performed by this task.
Deploy this server code through the normal upgrade flow after review; do not
restore the working live database or undo its completed index as a workaround.
