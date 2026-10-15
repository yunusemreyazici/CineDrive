# Web catalogue and search shortcuts — 2026-10-15

## User behavior

Library, Movies and Series now keep genre, rating, period and sorting in the
URL. Reload and back/forward navigation restore those facets. A named saved
view restores the route, applied search/type and filters without the old page
number. Copy link uses the same canonical URL and reports clipboard failure.
The library's empty-state reset now clears every facet as well as search/type.

Up to 20 named views and eight chosen search terms are stored in this browser
for the signed-in user. There is no anonymous/global fallback, cross-device
sync or server-side saved collection. The interface explains browser-local
persistence; clearing browser storage removes the preferences. Save failures
remain visible in the dialog without claiming success. Removal and clearing
recent searches update mounted consumers and other tabs through storage events.

Global search opens with quick destinations and up to four saved-view shortcuts.
Recent searches are recorded on explicit submission or opening a result, never
on each keystroke. Arrow keys/Enter, Escape, focus containment and scrolling the
active option support keyboard use. Enter before debounce uses the current text
rather than the previous query. Stale result rows are hidden while typing.
The global Ctrl/Cmd+K handler also works on music routes.

## Implementation

- `browseState.ts` allowlists route facets and normalizes saved/copied queries.
- `useMediaBrowseState` handles URL state for the three catalogue consumers.
  Consecutive changes merge pending edits while router transitions commit;
  the mobile browser test originally caught a lost first facet in this case.
- `SavedBrowseViews` uses the shared modal and localized TR/EN feedback.
- `useBrowserShortcuts` scopes storage to session user ID and rejects unavailable
  storage. Stored data is size-bounded and validated, with only the three known
  catalogue routes accepted; arbitrary persisted destinations are rejected.
- `GlobalSearch` owns one shortcut handler in the shell and lazily imports the
  search panel. Heavy validation dependencies are not added to the entry bundle.

No dependency, server, API contract, database migration or CineMusic change.
No production data was modified or deployed.

## Verification

- Full web unit suite: 198 tests passed across 36 files, including 11 new
  regression tests for URL restoration/back navigation, rapid edits, account
  isolation, bounded recents, persistence/removal, malformed storage/URL values,
  save failures, canonical copied links and clipboard permission failure.
- Web typecheck, repository lint, web production build and whitespace checks:
  passed.
- Bundle budget passed: approximately 366.68 kB raw / 107.48 kB gzip entry,
  compared with 371.83 / 108.68 kB before this change.
- `pnpm exec playwright test e2e/web-shortcuts.spec.ts e2e/smoke.spec.ts`:
  34 passed across Chromium and WebKit (1.8 minutes). The focused feature rerun
  passed all six tests after waiting for lazy route headings before reload.
- A final WebKit search rerun waits for network completion before leaving the
  detail page and before closing the browser context, and asserts the music
  heading and absence of the error boundary. It passed without the earlier
  aborted module-import log (1 test, 11.4 seconds).
- `pnpm docs:check`: passed.

Browser coverage in `e2e/web-shortcuts.spec.ts` checks saved-view reload/restore
at 1440 and 390 px, recent-search reuse/clear, keyboard focus and Ctrl+K on the
music page in Chromium/WebKit. The existing smoke suite checks authentication,
catalogue browsing, real fixture streaming/seeking/resume, series switching,
music/playlist restoration, settings and focus containment. Browser tests use
only the isolated fixture database and local media, not the production server.
Physical-device Safari is not covered by desktop WebKit.
