# Web music queue conveniences — 2026-10-15

## Scope

- Extract the queue drawer into `MusicQueuePanel`; search titles, primary artists and album titles locally, including Turkish diacritic-insensitive matching.
- Display matched/total counts, the selected entry and the next entry in actual play order. Repeat-one does not misleadingly mark a different song as next.
- Add one-step removal undo with entry IDs preserved, including duplicate tracks. Undo does not select a track, seek or resume playback.
- Undo is invalidated by subsequent queue edits (including shuffle, radio additions and replacement) or owner changes. A guarded functional state update prevents stale undo callbacks from overwriting a queued edit. No persistent undo history or additional network endpoint is introduced.
- Keep the drawer visible if removing the final selected entry hides the player dock. Cancel pending autoplay in this case, including a single-entry repeat-all queue.
- Localize all new strings in English/Turkish. Include named remove buttons, search status, Escape dismissal and lazy artwork loading. Saving still uses the entire queue, not search results.

## Files

- `apps/web/src/features/music/MusicQueuePanel.tsx`
- `apps/web/src/features/music/MusicPlayerProvider.tsx`
- `apps/web/src/features/music/MusicPlayerBar.tsx`
- `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/tr.ts`
- `apps/web/src/tests/music-queue-panel.test.tsx`
- `e2e/music-queue.spec.ts`

## Verification

- `pnpm --filter @cinedrive/web typecheck` — passed.
- `pnpm --filter @cinedrive/web test` — 241 tests / 40 files passed, including 10 new queue tests.
- `pnpm lint` — passed with zero warnings.
- `pnpm --filter @cinedrive/web build` — passed.
- `pnpm bundle:check` — passed; entry 356.62 kB raw / 105.85 kB gzip.
- `pnpm exec playwright test e2e/music-queue.spec.ts e2e/music-convenience.spec.ts` — 8 passed, Chromium/WebKit at 1440 px and 390 px. Covers search, removal, undo, empty queue recovery, sleep timer and audio remaining paused after undo.
- Inspected desktop/mobile queue screenshots: no horizontal overflow or overlap with the dock.
- `git diff --check` and `pnpm docs:check` — passed.

Initial browser testing exposed a test setup race: checking whether Pause was immediately visible could skip pausing the four-second fixture, allowing playback to advance before the next-entry assertion. The test now waits for the real Pause control before clicking it.

No migration, dependency, API or native client changes. Tests use the local disposable E2E database and fixture audio, not the live server. No commit, push or deployment performed.
