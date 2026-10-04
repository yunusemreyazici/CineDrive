# Connect permission and queue safety — 2026-10-02

## Scope and completed work

- [x] Retire pending commands when remote-control permission or Connect is disabled.
- [x] Retire pending commands when a device is removed.
- [x] Commit permission/device changes and command invalidation together; notify long-poll waiters only after commit.
- [x] Recheck target permission and online state inside the command-enqueue transaction instead of trusting an earlier eligibility snapshot.
- [x] Preserve user/device isolation, completed commands, and existing response/idempotency contracts.
- [x] Publish optional `queueItemId` in the lightweight client response and shared DTO, allowing duplicate entries of the same track to be distinguished without hydration.

The change uses existing tables; no migration, environment variable, dependency, or client minimum-version change is required. Disabling remote control does not pause local playback. Re-enabling or registering a removed device does not revive its failed commands.

## Regression evidence

Eleven added integration cases cover permission/Connect revocation, removal, re-enable without replay, other-user/device isolation, wake-up of long polls, transaction rollback under injected DB failure, stale eligibility snapshots (permission/offline/removal), and duplicate-track queue identity.

Tests use the disposable `/tmp/cinedrive-vitest.db`. The rollback fixture creates and drops a static trigger there only. No production database, live device, external lyrics provider, or AI provider was used.

## Verification

All commands completed successfully on this branch after the code changes:

| Command | Result |
| --- | --- |
| `pnpm --filter @cinedrive/shared build` | Passed |
| `LOG_LEVEL=fatal MUSIC_AI_API_KEY= pnpm test` | Server: 375 / 51 files; web: 143 / 30 files; shared: 23 / 3 files |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, zero-warning policy |
| `pnpm build` | Passed shared/server/web builds and web bundle budget |
| `git diff --check` | Passed |

## Boundaries / follow-up

Already-delivered commands cannot be retracted by server queue invalidation; receiver-side permission revalidation remains necessary. CineMusic includes that guard in commit `b1da865`. Its native transport already accepts optional `queueItemId`.

The stale-snapshot regression deterministically models an eligibility read preceding revocation; it is not a production concurrency/load benchmark. Conditional seek preconditions across server/native/web and capability negotiation remain a separate contract change, not claimed implemented here.

Physical iOS/Mac validation against this server change still requires deployment. This work did not deploy, push, or open a pull request.
