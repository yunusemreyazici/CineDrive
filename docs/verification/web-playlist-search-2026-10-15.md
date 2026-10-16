# Playlist search — 2026-10-15

## Scope and behavior

- Added local search within a playlist, matching title, primary/credited artists and album. Turkish diacritics are normalized. The same small matcher now serves the queue drawer.
- Search preserves item IDs, duplicate occurrences and saved order. The explicit play-results action and individual result rows play the filtered sequence; header play-all/shuffle, duplication and add-to-another-list still use the complete playlist.
- Disable drag reordering during search and reject synthetic drops in the handler. Do not send a partial order to the backend. Normal full-list reorder remains available after clearing search.
- Show result counts, clear-search and distinct no-match feedback. Controls wrap on mobile; all strings are localized in English and Turkish.
- Reset detail UI state when navigating between playlist IDs. Failed detail loads now show the shared error/retry UI instead of a permanent skeleton.
- No API, DB, migration, dependency or native-client changes. No provider requests are introduced.

## Verification

- `pnpm --filter @cinedrive/web typecheck` — passed.
- `pnpm --filter @cinedrive/web test` — 248 tests / 41 files passed, including seven new playlist-search regressions using the real track-list and query hooks with mocked HTTP.
- `pnpm lint` — passed.
- `pnpm --filter @cinedrive/web build` and `pnpm bundle:check` — passed.
- `pnpm exec playwright test e2e/playlist-search.spec.ts e2e/music-queue.spec.ts e2e/music-convenience.spec.ts e2e/smoke.spec.ts` — 40 passed in Chromium/WebKit (2.5 minutes), including mobile/desktop search, recovery, queue and playback checks.
- Inspected 390 px and 1440 px screenshots; mobile search occupies a full row, no horizontal overflow.
- `pnpm docs:check` and `git diff --check` — passed.

The first combined browser run had one queue-test timeout waiting for the Pause control; the other seven cases, including all four playlist-search cases, passed. A trace-enabled Chromium repeat run passed all six cases, and the final combined 40-case run also passed. No deterministic cause was established, so this observation is retained rather than reported as a fixed production bug.

Tests create and clean up temporary playlists in the disposable local E2E database. The live server and personal library were not touched.

## Git

Previous convenience batches were committed as `1ff8e54` on `codex/web-library-shortcuts`. This follow-up is included on the same feature branch for a `main`-targeted pull request, alongside the music personalization API changes. No production deployment was performed.
