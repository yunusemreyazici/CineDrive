# CineDrive web redesign — 2026-10-15

## Scope and design

Web-only redesign on `codex/web-redesign`. Ink surfaces, a warm cinema accent,
clearer typography, quieter borders and consistent spacing replace the previous
mixed visual treatments. Existing accent themes and their persisted selection
remain available. New interface copy uses the Turkish/English dictionaries.

- Responsive application shell, compact navigation beside the music sidebar,
  mobile drawers, search and keyboard skip link.
- Home masthead, featured media, poster/resume cards, filters, media/episode
  detail, people, favorites and history.
- Music home/discovery, albums/artists/tracks, detail pages, playlists, Replay,
  maintenance and floating player; lyrics and audio-setting surfaces.
- Login, setup, settings navigation/cards, invitation, error/empty/modal and
  not-found surfaces.

`apps/web/src/styles/cinema.css` uses explicit component roles rather than
selectors coupled to generated Tailwind utility names. Shared tokens live in
`index.css`; no UI framework or external image/font dependency was added.
Existing locally bundled fonts and artwork endpoints are retained. Album grids
adapt to available width; track metadata uses a container query, so the extra
music sidebar cannot squeeze desktop columns into a mobile-width content area.
Motion reduction, visible focus and touch-accessible poster actions are included.

`MusicCollectionState` separates failed requests from genuinely empty music
collections and exposes the existing retry action. Authentication, streaming,
AI selection/provider calls, queue persistence and backend authorization were
not rewritten. No shared DTO, server, database schema or CineMusic changes.
No migration, production deployment or automatic playlist creation is needed.

## Verification

- `pnpm --filter @cinedrive/web test --maxWorkers=1`: 187 tests passed, 35 files.
- `pnpm --filter @cinedrive/web typecheck`: passed.
- `pnpm lint`: passed, zero warnings.
- `pnpm --filter @cinedrive/web build`: passed.
- `pnpm bundle:check`: passed; entry approximately 371.83 kB raw / 108.68 kB gzip.
- `pnpm docs:check`: passed.
- `git diff --check`: passed.
- `pnpm exec playwright test e2e/redesign.spec.ts e2e/smoke.spec.ts`: 40 passed
  across Chromium and WebKit (4.7 minutes).

The first full browser run exposed Safari's default link-tab behavior. Explicit
`tabIndex={0}` keeps the new skip link in the sequential keyboard order in both
engines. The music smoke test now waits for the newly created playlist's actual
heading before reloading; waiting only for its sidebar link could abort the
lazy route module fetch in WebKit. The destination and post-reload error-boundary
absence are now asserted, not just the persistent player's restored state.
After that test synchronization fix, the focused music/playlist smoke rerun
passed in both browsers (2 tests, 17.5 seconds), without the module-load error.

`e2e/redesign.spec.ts` exercises 29 routes plus login at 1440, 1024 and 390 px
in Chromium/WebKit, checks runtime exceptions/horizontal document overflow and
captures screenshots for visual inspection. It also checks mobile navigation,
search, persisted theme, keyboard focus, collection retry, explicit-only AI
submission, and mobile player/lyrics/queue access. The existing smoke suite
checks actual fixture streaming/seeking/resume, episode switching, music and
playlist/queue restoration, settings, authentication and dialog focus.

All browser tests use the disposable E2E database and local tagged audio/video.
AI availability/failure responses are mocked; no external AI requests are made.
Fixture artwork is deliberately sparse, so production posters and very large
real catalogs are not claimed as visually verified. Physical-device Safari and
production deployment remain release checks, not covered by desktop WebKit.

Screenshots are generated under ignored `test-results/`; no credentials,
production databases or screenshot binaries are included in this change.
