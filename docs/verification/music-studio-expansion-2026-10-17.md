# Web Music Studio, journal and targeted sync — 2026-10-17

## Implemented

- `/music/studio`: localized, responsive collaborative playlist directory, invitations and roles, multiselect workshop, duplicate occurrence selection, selected-slot sorting, copy/move, paged history and explicit restore. Recording families and saved listening checkpoints are editable on web. Playback resumes the saved occurrence and position; unavailable tracks cause a conflict rather than silently shifting the queue.
- Additive `20261017000000_music_studio_journal`: operation receipts, playlist revisions and recipient-scoped change events. Existing playlists, memberships, profile revisions, item IDs and timestamps remain unchanged. No new environment variables or dependencies.
- Incremental workshop writes retain unchanged rows and timestamps; only changed positions are temporarily parked to satisfy SQLite uniqueness. Deleted/new rows use bounded batches. Copy/move, journal and receipts commit in the same transaction.
- Idempotency keys on Studio create/edit/copy/move/restore. Same account/key/payload replays the committed result after rechecking current playlist permissions. Changed payload returns 409. Receipts are retained for at least 24 hours, limited to 2,000 per account; recent receipts are never evicted to admit a new write. Legacy callers may omit keys on existing workshop endpoints.
- Last 100 Studio content revisions per playlist. Summary pages read precomputed counts, not all snapshots. Expanding a revision loads one bounded snapshot and up to 100 accessible track labels. Removed/inaccessible tracks have no title or track ID in the response. Restore checks current version, actor/owner track access and foreign occurrence IDs.
- Directory cursor pagination (50 rows on web, legacy default 200, maximum 200). Per-user changes are retained to 2,000 events and returned 100 at a time. Membership revocation and playlist deletion retain invalidation tombstones. Existing owner-only playlist endpoints also emit events.
- Visible Studio pages poll changes every 10 seconds and catch up on focus/reconnect. Only affected playlist/history queries are refreshed. Permission changes reset mounted observers immediately. No stream credentials, catalogue metadata, lyrics, or private filesystem paths in events.
- Owner-scoped quality counts, recent library scan status, existing enrichment progress and administrator-only worker observation. Existing 200-track pilot action is explicit; viewing the screen never starts enrichment. Empty normalized lyrics are not falsely counted as awaiting indexing.
- Small AI results include additive local coverage counts: hard matches, eligible recording versions and missing evidence for requested language/year/genre constraints. Missing counts can overlap and are not promises of future matches. HARD filters, local selection and provider request contents are unchanged.

## API additions

All paths below start with `/api/music/studio`, require authentication and return `private, no-store`.

- `POST /playlists` — `{name, operationId}`.
- `GET /playlists?limit=50&cursor=…` — directory and `nextCursor`.
- `GET /changes?cursor=…` — user-scoped invalidations. Without cursor returns a baseline; refresh cached resources after acquiring it. `resetRequired` means discard cached resources and resnapshot. Cursors are opaque to clients even though represented as integers.
- `GET /playlists/:id/history` — paged summaries.
- `GET /playlists/:id/history/:revisionId/items` — paged accessible changed-track labels.
- `POST /playlists/:id/history/:revisionId/restore` — `{version, operationId}`.
- `GET /families/:id/tracks` — at most 30 lightweight accessible labels, expanded on demand.
- `GET /sessions/:id/tracks` — batched accessible hydration, preserving duplicate occurrences, index and position.
- `GET /health` — owner-scoped maintenance counts and scans; global workers only for administrators.

## Deliberate boundaries

- CineMusic has not been modified. Native clients retain existing contracts; consuming the new changes/history/pagination APIs requires a separate CineMusic update. This is cursor polling, not push/SSE, and currently runs on the web Studio screen.
- History snapshots cover Studio workshop operations (including native callers of those endpoints). Legacy item edits emit notifications but do not create restore snapshots. No historical actions are fabricated. Deleting an entire playlist deletes its journal.
- Restore is explicit full-content restoration with optimistic concurrency, not an automatic merge. Cross-playlist moves cannot be undone one-sided; their two history records remain inspectable. Copy records are inspectable but not restorable via this control.
- No unsupported pause/resume controls or fabricated ETA. Scheduler observation is process-local and resets on server restart; enrichment queue states remain in the existing persistent fields. Failure counts and next retry times are shown, but raw provider/scan errors are deliberately not exposed because they can contain server paths or secrets.
- Safe retry state is held in the current view. After navigation/reload or the 24-hour retry window, inspect current data before starting a fresh operation. No mutation is automatically retried.
- No production database, external lyrics/AI provider, commit, push or deployment was used.

## Verification

Commands used:

```sh
pnpm prisma:generate
pnpm --filter @cinedrive/shared build
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test e2e/music-studio.spec.ts
git ls-files --modified --others --exclude-standard -z '*.ts' '*.tsx' | xargs -0 pnpm exec eslint --max-warnings 0
git diff --check
```

The targeted server run passed 65 tests (Studio, AI selection and enrichment worker); targeted web passed 15 (Studio and playback history/checkpoints). Four browser flows passed on Chromium/WebKit at 1440px/390px; screenshots were inspected. Browser fixtures and unit/integration providers are isolated from production. The migration suite checks historical upgrade paths and schema drift; an additional Studio-specific fixture checks preservation of memberships, occurrence IDs, timestamps and profile revision/content.

Full workspace suite: shared **30**, web **256**, server **535** tests passed. The additional Studio upgrade-preservation test then passed in the **8-test** migration suite. After final notification coalescing/cursor changes, Studio server **19** and web/playback **15** tests passed again. Workspace typecheck, changed-file ESLint (zero warnings), production build/bundle-size check, documentation-link check and `git diff --check` passed. Logs are under `/private/tmp/cinedrive-studio-*` and are not repository artifacts.
