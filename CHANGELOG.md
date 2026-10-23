# Changelog

All notable changes to CineDrive are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release notes can be prepared before publication. A version is available only
after its matching GitHub Release and verified container artifacts exist.

## [Unreleased]

## [1.3.0] - 2026-10-23

### Added

- Add Music Studio on the web: collaborative playlists, invitations and roles, multiselect editing, duplicate selection, copy/move, change history and explicit version-checked restoration.
- Add revocable seven-day playlist invitation links, contributor attribution and accepted shared playlists in normal library/sync responses. Playlist sharing never grants access to private media libraries.
- Add local playlist recommendations with genre/artist/era explanations, recording-family deduplication and seeded refreshes; suggestions are added only on explicit user action.
- Add recording families, preferred versions and saved listening checkpoints, plus discovery preferences, feedback and smart-playlist rules for compatible clients.
- Add two-person Listen Together sessions, invitation links, shared queues and authenticated device-scoped recovery for compatible CineMusic clients.
- Add indexed lyrics search and rate-limited background LRCLIB enrichment, with persistent language evidence, queue statistics and bounded maintenance pilots.
- Add web catalogue layout controls, saved browse views, recent browsing, playback shortcuts, queue filtering/undo and a sleep timer.

### Changed

- Redesign the responsive web interface and navigation; expose Music Studio quality and background-job observations alongside existing maintenance tools.
- Enforce explicit language/genre/year constraints throughout AI playlist selection and show local metadata coverage for small results. AI plans intent only; track selection remains local.
- Refresh affected Studio resources through a bounded user-scoped change feed; preserve unchanged playlist occurrence IDs and timestamps, and prevent duplicate Studio writes after response loss.
- Bound artwork/metadata caches and use lightweight catalogue reads and batched hydration for large-library workflows.

### Fixed

- Harden Connect command ownership, queue editing, seek/handoff, permission revocation and retries while preserving independent device playback.
- Correct Replay timezone handling, listening-state ordering, startup/session recovery, web login redirects and lyric timing/revision handling.
- Recover interrupted/rescanned libraries and repair episode loading, search, history clearing and subtitle-cache access without discarding existing user data.
- Correct Studio track search parameters and cancel stale lookups; validate real browser-test audio duration across Linux and macOS.

### Security

- Strengthen library isolation across catalogue, streaming, subtitles, downloads, lyrics and shared playlists; keep invitation tokens hashed at rest and access-checked metadata out of unauthorized responses.
- Update runtime dependencies and image-processing binaries and retain signed, provenance-attested AMD64/ARM64 release images with SBOMs.

### Upgrade notes

- Back up the database, runtime configuration and `TOKEN_ENCRYPTION_KEY`, and record both old image digests before upgrading from 1.2.0. This release includes migrations for catalogue/search indexes, scan recovery, playback ordering, lyrics search, personalization and collaborative playlists/history. Normal container startup and the VPS updater apply migrations; do not reset the database or rerun setup.
- Update server and web together using verified image digests from this release. Check readiness, sign-in, an existing video/music library, playback, lyrics search and Music Studio after migration. Rollback requires the pre-upgrade database snapshot as well as the previous images.
- `MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES` defaults to 5: a bounded background pass looks up at most 25 missing original lyrics per run with shared rate/retry limits. Set it to `0` to disable periodic lookups. Existing cached lyrics remain available; LRCLIB lookups send song metadata to that provider.
- AI remains optional and server-side. No AI key is needed for ordinary Discovery, local recommendations, lyrics indexing or Studio. A compatible CineMusic update is needed for the new native collaboration/Together controls; server sharing does not grant library permission.
- See the bilingual 1.2.0 → 1.3.0 checklist in `docs/RELEASING.md` and `docs/RELEASING.tr.md`. Publishing artifacts does not itself deploy or verify a production installation.

## [1.2.0] - 2026-09-14

### Added

- Add opt-in CineMusic Connect device discovery and remote playback commands, including queue copy and acknowledged handoff while keeping independent per-device playback available.
- Add natural-language AI playlist planning, local language enrichment and five personalized editorial mixes; track and lyrics catalog content stays local and deterministic fallbacks remain available without an AI provider.
- Add behavior-based discovery collections for long-unplayed, least-played and hidden-favorite tracks, plus a broader seeded discovery engine with stronger artist, album and cross-section diversity.
- Add admin-only CPU, memory, filesystem, disk I/O, network, best-effort temperature and seven-day bandwidth monitoring with cgroup-aware collection, persistent one-minute samples, five-minute chart buckets and automatic retention.
- Add consumer-facing shared track pages with artwork, artist and album links, quality information and explicit playback.

### Changed

- Calculate Replay calendar boundaries using the client timezone and reduce large-history loading to bounded metadata batches.
- Isolate CineMusic Connect synchronization and command polling in its own rate-limit bucket so device presence does not consume normal API capacity.

### Fixed

- Prevent large music sync, discovery, radio and maintenance queries from exceeding SQLite parameter limits.
- Preserve Range response headers returned through Gaxios 7 `Headers` objects during original Google Drive playback.
- Emit bounded-duration fragments for audio-only fMP4 transcoding so playback can begin before a live input closes.

### Security

- Update the transitive development-tooling dependency `js-yaml` to 4.3.2 to address excessive CPU use from empty YAML merge sources.

### Upgrade notes

- This release adds automatic database migrations for system metrics, music-language enrichment queues and CineMusic Connect clients/commands. Back up the database before upgrading and update the server and web images together.
- AI playlist planning is optional. Existing discovery remains available when `MUSIC_AI_API_KEY` is unset; configure the documented provider variables only when the feature is wanted.
- CineMusic Connect is opt-in per user and keeps remote-control permission separate from device visibility. The VPS installer applies the required migrations automatically.

## [1.1.0] - 2026-09-04

### Fixed

- Build release images on native AMD64/ARM64 runners to avoid QEMU illegal-instruction hangs; validate both platform digests before publishing the signed multi-architecture index.
- Bound HLS transport/media recovery on Chromium and native WebKit, preserving playback position and pause intent with an actionable manual retry after exhaustion.

### Added

- Let administrators explicitly choose a specific Drive folder or the whole Google Drive account in first-library setup; keep the narrower folder scope as the default.
- Optional bilingual first-library setup wizard for local folders and Google Drive, with admin-only local access validation, explicit source creation and scanning, resumable scan status, and unit/browser regression coverage.
- HLS recovery regression tests and real-browser transport-failure coverage using an isolated HTTP fault proxy; no production test endpoints are introduced.
- Offline documentation link validation and regression tests in CI.
- A checksum-pinned OSV-Scanner fallback for recognized npm audit service outages, with full lockfile coverage validation, high/critical and unknown-severity blocking, retained evidence, and fail-closed regression tests. npm findings cannot be overridden by fallback.

### Changed

- Run the production dependency audit independently of application verification so registry outages do not skip Docker/browser tests; keep audit success mandatory through the existing required `e2e` gate, with regression coverage for upstream result combinations.
- Shortened the English and Turkish READMEs into product overviews and quick starts; moved installation, configuration, Drive setup, playback, operations, and development details into bilingual guides.
- Align package and outbound client version identifiers at 1.1.0; show the web package version in Settings → About.

### Security

- Harden the Debian/Ubuntu VPS installer with validated Nginx/TLS inputs, optional Google OAuth for local-only deployments, concurrent and partial-install guards, clean fast-forward-only updates, and a verified pre-update SQLite snapshot with exact recovery details.

### Upgrade notes

- No database schema/migration, dependency, required environment-variable, or Node runtime changes compared with 1.0.0. Existing libraries and settings remain usable; setup is optional and administrator-only.
- Back up the database and retain the existing configuration, encryption key, and both image digests before upgrading. Update server and web together using verified release digests; see the bilingual upgrade checklist in `docs/RELEASING.md` and `docs/RELEASING.tr.md`.
- Live Google OAuth verification and a deployed-image 1.0.0 → 1.1.0 upgrade/rollback smoke test remain manual release checks. Mocked Drive tests and no-push image builds do not replace them.

## [1.0.0] - 2026-09-03

### Added

- Personal video and music libraries backed by Google Drive or local folders, with Turkish and English interfaces.
- Direct playback, compatibility transcoding, on-demand HLS, subtitles, watch history, favorites, and resume playback.
- Music metadata, playlists, listening history, synchronized playback queues, lyrics, discovery mixes, and library maintenance tools.
- Docker Compose and Debian/Ubuntu VPS deployment paths; supported runtimes remain Node.js 22.13+ in major 22, or Node.js 24.
- SQLite backup/restore tools, retained verified snapshots, versioned migrations, and separate liveness/readiness endpoints.
- CI, CodeQL, Dependabot, and production container vulnerability scans.
- Tag-triggered multi-architecture container publishing with immutable digest manifests, CycloneDX SBOMs, provenance attestations, and keyless signatures.

### Changed

- Reduced the web entry bundle and media-list payloads; retained server-side pagination and user-scoped queries.
- Production containers run as a non-root user and omit build-time package-manager tooling.

### Security

- Sanitized unexpected server errors while retaining request-correlated server logs.
- Hardened user/library access checks, subtitle rendering, and transcode process invocation.
- Updated Prisma's transitive `mysql2` to 3.23.1, retaining the earlier authentication-plugin fix and addressing compressed-packet memory exhaustion (GHSA-rgwj-5xj2-c3m3).
- Updated transitive `qs` to 6.16.0 for array-limit bypass and unsafe constructor.isBuffer handling (GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g).
- Kept Node type definitions on major 22 and constrained automated Docker Node major upgrades to the supported runtime policy.

### Verification

- Chromium and WebKit coverage for real direct playback, seeking, resume, HLS segments, and FFmpeg process cleanup.
- Historical video/music database upgrade tests, schema-drift checks, repeatable migrations, and restore/re-upgrade drills using isolated test databases.
- Release metadata and curated-note regression tests; pull-request multi-architecture builds do not publish artifacts to GHCR.

[Unreleased]: https://github.com/yunusemreyazici/CineDrive/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/yunusemreyazici/CineDrive/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/yunusemreyazici/CineDrive/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/yunusemreyazici/CineDrive/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yunusemreyazici/CineDrive/releases/tag/v1.0.0
