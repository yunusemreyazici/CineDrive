# Account-local catalogue presentation — 2026-10-15

Library, Movies and Series now share grid/list selection and small, medium or
large poster sizing. List mode is newly available on Movies and Series. Poster
size is retained while the selector is disabled in list mode. The responsive
grid fits the content column rather than the viewport; its smallest card width
reserves room for existing playback and favorite actions.

Preferences are stored separately from saved filter shortcuts, under the signed-in
user ID in this browser. They survive navigation and reload, synchronize between
tabs and reset to defaults when switching to a different account or signing out.
No anonymous/global fallback is read or written. Invalid/oversized storage falls
back to bounded defaults. If storage is blocked, the current page remains usable
and localized feedback explicitly says the selection was not saved.

The hook and shared control have three real page consumers. The old global,
nonpersistent `viewMode` field was removed from the UI store to avoid competing
sources of truth. No new dependency, API query, server-side pagination change,
schema/migration or CineMusic change. Existing uncommitted saved-view, search
and music-convenience work was preserved. No commit, push or deployment.

## Verification

- New unit coverage: mode/size remount persistence, account changes/logout,
  malformed/oversized storage, denied storage, cross-tab updates and storage clear.
- Full web unit suite: 220 passed across 38 files.
- Web typecheck, repository lint, production build, bundle budget, documentation
  links and whitespace checks passed. Entry approximately 354.01 kB raw / 105.13 kB gzip.
- Combined browser run with existing shortcuts/music conveniences/smoke: 42 passed
  in 2.8 minutes. A WebKit module-import console message during the pre-existing
  global search scenario prompted an additional clean focused rerun.
- Focused catalogue-layout/global-search rerun with tracing: 6 passed in
  35.1 seconds across both browsers, without the earlier module-import message.
  Small-poster screenshots were inspected at mobile width; controls and cards
  fit without horizontal overflow. Desktop WebKit is not physical-device Safari.
- Browser coverage: actual poster width changes, mode/size restoration on all
  three routes and reload, overflow checks at 390/1440 px in Chromium and WebKit.
- Browser fixtures use only the isolated test database, never production data.

Commands:

```sh
pnpm --filter @cinedrive/web test --maxWorkers=1
pnpm --filter @cinedrive/web typecheck
pnpm lint
pnpm --filter @cinedrive/web build
pnpm bundle:check
pnpm exec playwright test e2e/catalogue-layout.spec.ts e2e/web-shortcuts.spec.ts e2e/music-convenience.spec.ts e2e/smoke.spec.ts
git diff --check
```
