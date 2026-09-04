# Changelog

All notable changes to CineDrive are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release notes can be prepared before publication. A version is available only
after its matching GitHub Release and verified container artifacts exist.

## [Unreleased]

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

[Unreleased]: https://github.com/yunusemreyazici/CineDrive/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/yunusemreyazici/CineDrive/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yunusemreyazici/CineDrive/releases/tag/v1.0.0
