# CineDrive media/web correctness audit — 2026-10-14

## Scope and evidence

This is the first focused repair batch from a project-wide review, not a claim
that every line/path has been audited. Reviewed web API hooks, detail/season
views, paged history, subtitle/deletion invalidation, global search, server
auth/session and library predicates, media query/edit/playback/subtitle paths,
scan identity/leases, Drive request cancellation and internal capabilities,
lyrics workers, AI history/cache bounds, artwork render limits, shared contracts
and browser coverage. Only verified defects were changed.

Read-only live diagnostics established that the reported Sex and the City
episode requests returned 404 at `/api/seasons/:id/episodes`. The actual route
is `/api/media/seasons/:id/episodes`; stored season counts were 12/18/18/18.
No missing catalogue data, live mutation or provider reset was involved.

## Repairs

| Area | Defect | Repair |
| --- | --- | --- |
| Episodes | Web omitted the media prefix | Use the existing authenticated endpoint; preserve query key/signal |
| Clear history | InfiniteQuery cache replaced with `[]`, breaking `pages` consumers | Correct pages/pageParams shape; cancel pre-delete reads before clearing |
| Media deletion | Invalidated `history`, but actual key is `watchHistory`; resume rows stale | Invalidate watchHistory/continueWatching and episode data |
| Episode state | Reset/progress/history/subtitle changes left separately cached episodes stale | Refresh the episode query family; preserve low-frequency opt-out for player progress |
| Search navigation | Song result opened album, including an empty album ID | Route directly to the existing track detail page |
| Lyrics search | Global search ignored additive lyricsMatches | Show original-lyrics hits/excerpts, deduplicate title hits |
| Search lifecycle | Music requests lacked cancellation; pending music shown as no results | Forward query AbortSignal, include music pending in loading state |
| Rescan | Existing files trigger failed INSERT/unique-error logs on every refresh | Read existing identity, library-scoped atomic update; checked create-first race fallback |
| Local subtitle cache | Null Google ID could collide across local files/libraries/users | Use per-file local identity; never read ambiguous old null-ID cache |

The subtitle service accepts an optional internal cache directory for isolated
tests. Default deployment path and Drive/OpenSubtitles cache keys are unchanged.
Old local subtitles are regenerated under distinct keys; no broad cache deletion
is performed. Authorization still runs before cache reads. Scan update ownership
is included in the write predicate, so the fast path cannot rehome a foreign row.

## Compatibility and architecture

- No migration, new production env variable, response/endpoint removal or
  CineMusic change. Existing native API consumers are unaffected.
- TanStack Query owns server state; changes do not introduce a second cache or
  duplicate server authorization in the client.
- Global search uses the shared MusicSearchDto rather than an incomplete local
  duplicate. Lyrics themselves remain local/provider-cached, not AI-selected.
- Test startup explicitly disables the AI credential inherited from local env.
  E2E uses only disposable DB/media/runtime directories and local HTTP services.
- Rescan optimization removes expected failed writes, not security checks; the
  10k regression counts operations rather than claiming measured latency gains.

## Verification

- `pnpm --filter @cinedrive/server test`: **508 tests / 66 files passed**.
- `pnpm --filter @cinedrive/shared test`: **30 / 4 passed**.
- `pnpm --filter @cinedrive/web exec vitest run --maxWorkers=1`: **187 / 35 passed**.
- **725 unit/integration tests total**. Focused cache/search, identity/race,
  subtitle/security suites also passed.
- `pnpm exec playwright test e2e/smoke.spec.ts`: **28 passed**, Chromium and
  WebKit, real isolated test API. Includes new season-switch and clear-history
  regressions plus login, library, video seek/resume, tagged music, playlists,
  queue restore, settings, not-found and dialog focus. Full HLS/setup E2E suites
  were not run in this batch; related server/unit coverage remains passing.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`: passed.
  Web entry 372.29 kB raw / 108.73 kB gzip, within enforced bundle budget.
- Tests forbid/mock external provider calls for new regressions. No production
  accounts, passwords, catalogue rows or lyrics are printed or mutated.

## Follow-up recommendations (not implemented defects)

1. Expand real API/browser contract fixtures beyond the original movie-only
   seed: the missing series path was not exercised by the earlier smoke suite.
2. Centralize query keys and mutation-to-query dependencies, especially after
   introducing summary detail and paged history. Narrow episode invalidation
   when parent/media identity is explicitly available to the query cache.
3. Measure cold/warm query latency and SQLite plans per endpoint using realistic
   catalogue/history sizes before adding indexes or changing pagination.
4. Expose automatic lyrics-worker counters separately from manual enrichment
   stats; distinguish current failed rows from cumulative failed attempts.
5. Add disk-cache accounting/eviction measurements and local-source change
   checks; avoid speculative cache rewrites without workload data.

Production validation requires a normal deploy; no live deployment, merge or
data repair was performed for this audit batch.
