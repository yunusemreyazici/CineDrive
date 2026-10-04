# Conditional Connect seek — 2026-10-02

## Completed work

- [x] Add optional server bootstrap and per-receiver conditional-seek capability.
- [x] Validate strict expected track/queue-entry metadata on seek only.
- [x] Revalidate capability/item inside existing user-scoped enqueue transaction.
- [x] Carry the precondition to the receiver, which has final local authority.
- [x] Fail pending protected commands on capability downgrade, leaving legacy commands intact.
- [x] Require capability on the poll itself to protect old binaries before heartbeat.
- [x] Preserve old clients and all existing API identifiers/fields.
- [x] Verify all tests, typecheck, lint, build, actual migration upgrade/restore, and schema drift.

`expectedPlayback: { trackId, queueItemId }` is a strict optional seek payload.
It requires both `cineMusicConditionalSeek` server bootstrap capability and
`supportsConditionalSeek` receiver capability. Capability defaults false on old
heartbeat/poll clients. New receivers opt into command polls with
`supportsConditionalSeek=1`; a persisted heartbeat alone is not sufficient to
deliver a protected command. This covers a downgraded binary polling before its
first heartbeat. No protected command is retried as a legacy command.

The enqueue transaction reads only indexed lightweight target state, not track
metadata or a hydrated queue. Mismatch returns 409 `PLAYBACK_ITEM_CHANGED`;
unsupported capability returns 409 `CONDITIONAL_SEEK_UNSUPPORTED`. Protected
duplicate IDs also require matching target/type/payload. Existing legacy
idempotency behavior is preserved.

Receiver-local track/entry validation immediately before seek is necessary:
server snapshots are eventually consistent and do not replace that guard.
CineMusic implements that guard and capability negotiation in the companion
native changes committed separately. This item precondition does not distinguish an
unobserved A→B→A transition back to the identical queue-entry identity.

## Migration and rollout

`20261002000000_connect_conditional_seek` only adds:

- `MusicPlaybackState.supportsConditionalSeek`, default false.
- `MusicPlaybackCommand.requiresConditionalSeek`, default false.

Existing data is retained without table rebuilds. No dependency, environment
variable, minimum client build, or API version change is needed. Use existing
backup + `pnpm --filter @cinedrive/server prisma:deploy` deployment practice
before starting the updated server. Neither local development nor production DB
was migrated in this work; migrations ran only on disposable test databases.

New native endpoints enable protected seek after updated server deployment.
Old native/web endpoints remain supported on their existing unprotected path;
web capability support is intentionally not introduced in this native-focused pass.

## Verification

- `DATABASE_URL=file:/tmp/cinedrive-vitest.db pnpm --filter @cinedrive/server prisma:generate`: passed; generates client code, does not migrate DB.
- `pnpm --filter @cinedrive/shared build`: passed.
- `LOG_LEVEL=fatal MUSIC_AI_API_KEY= pnpm test`: 378 server, 143 web, 30 shared tests passed (551 total).
- Migration tests cover existing queues, permission flags, pending command payload/status, upgrade/restore/re-upgrade, and drift.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed; bundle budget passed.
- `git diff --check`: passed.

Regressions cover unsupported receivers, stale duplicate-entry identity, identical
retries/conflicting protected IDs, legacy seek compatibility, capability
downgrade before heartbeat or via heartbeat, no replay after re-enable,
unauthenticated access, and cross-user command isolation. Shared tests reject
partial/arbitrary/extra-field preconditions and ambiguous capability coercion.

The later-schema migration seed fixture initially lacked already-backfilled
translation and membership rows. The fixture was corrected; the two-column
product migration was unchanged. All final tests passed.

No live/provider requests, deployment, push, PR, client install, or user data
mutation took place. Companion native verification is documented in CineMusic
`docs/verification/connect-conditional-seek-2026-10-02.md`. The verified changes
are committed on `codex/connect-permission-revocation` at the user's request.
