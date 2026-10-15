# Recently browsed detail shortcuts — 2026-10-15

The home page now shows up to 12 recently opened movie/series detail pages,
newest first. Opening a title again moves it to the front without duplication.
The rail supports removing one entry or clearing the whole list; an empty list
does not reserve space. It is separate from watch history and Continue Watching.

Only the media ID, bounded title and movie/series type are stored, under the
authenticated account ID in this browser's localStorage. No artwork URLs, stream
tokens, filesystem paths, playback positions or complete media objects are saved.
This is a local convenience, not cross-device history. Clearing browser data
removes it. A denied write does not break the detail page, and failed removal
shows localized feedback rather than claiming success.

`RememberBrowsedMedia` mounts only in the successful media detail branch.
`RecentlyBrowsed` renders lightweight internal links, with encoded identifiers,
without fetching individual details or artwork. Clicking still uses the normal
authenticated route and API authorization. Deleted/inaccessible entries may
remain as local shortcuts until removed; storing a title grants no access.
Account switching never copies the still-mounted old detail to a new user.

The storage subscription uses `useSyncExternalStore` with a stable string snapshot.
Regression tests caught a mount-order race with an effect-only subscription;
React's subscription recheck now handles writes before the consumer subscribes.
Storage events update other tabs, and clearing a list does not cause an already
mounted recorder to repopulate it. Persisted input is size-bounded and validated.

No backend, shared API, schema, dependency or CineMusic changes. No commit,
deployment or production data modification. Existing uncommitted work is retained.

## Verification

- Full web unit suite: 231 tests passed across 39 files (11 new tests).
- Final combined browser run: 36 passed across Chromium/WebKit in 2.2 minutes.
- Web typecheck, repository lint, production build, bundle budget, documentation
  links and whitespace checks passed. Entry: 354.01 kB raw / 105.13 kB gzip.
- New tests cover bounded recency, deduplication, remount, escaped links, removal,
  clear, account changes/logout, invalid storage, denied writes/removal and tabs.
- Browser tests at 390/1440 px verify opening two details, returning via shortcuts,
  ordering, reload, removal, clearing and no playback-state writes.
- The first browser run exposed a test selector matching old home card headings
  during route transition. The test now waits for the actual detail h1.
- Mobile screenshots were inspected; the shortcut rail scrolls within the page.

Commands:

```sh
pnpm --filter @cinedrive/web test --maxWorkers=1
pnpm --filter @cinedrive/web typecheck
pnpm lint
pnpm --filter @cinedrive/web build
pnpm bundle:check
pnpm exec playwright test e2e/recently-browsed.spec.ts e2e/catalogue-layout.spec.ts e2e/smoke.spec.ts
pnpm docs:check
git diff --check
```

Browsers use a disposable local fixture catalogue, not production accounts.
Physical-device Safari and a large production catalogue are outside this check.
