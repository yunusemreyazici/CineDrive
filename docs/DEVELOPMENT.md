# Development

[Documentation](../README.md#documentation) · [Türkçe](DEVELOPMENT.tr.md)

See [Installation](INSTALLATION.md#local-development) for the local environment and database bootstrap.

## Architecture

| Layer | Technology                                                           |
| ----- | -------------------------------------------------------------------- |
| Web   | React 19, Vite, React Router, TanStack Query, Zustand, Tailwind CSS  |
| API   | Node.js, TypeScript, Fastify, Zod, Pino                              |
| Data  | Prisma and SQLite with versioned migrations                          |
| Media | Google Drive API, FFmpeg/HLS, `music-metadata`, Chromaprint/AcoustID |
| Tests | Vitest, Testing Library, Playwright                                  |

```text
CineDrive/
├── apps/
│   ├── server/
│   │   ├── prisma/          # Schema and migration history
│   │   ├── scripts/         # Maintenance utilities
│   │   └── src/
│   │       ├── routes/      # Fastify HTTP API
│   │       ├── services/    # Drive, scans, metadata, playback, music, lyrics
│   │       ├── plugins/     # Authentication and Prisma
│   │       └── utils/
│   └── web/
│       └── src/
│           ├── pages/       # Route-level screens
│           ├── features/    # Video and music players
│           ├── components/  # Shared UI
│           └── i18n/        # Turkish and English dictionaries
├── packages/shared/         # Shared types, Zod schemas, and parsers
├── e2e/                     # Isolated Playwright environment
├── nginx/                   # Production reverse proxy
├── scripts/install-vps.sh   # Interactive Debian/Ubuntu installer
└── docker-compose.yml
```

The central ownership path is:

```text
User ──< Library ──< DriveFile ──< Movie / Episode / MusicTrack
  └──< GoogleConnection ──< DriveScanSource
  └──< Favourites / History / Playlists / PlaybackState
```

All media and transport endpoints validate that the requested file is reachable through one of the signed-in user's libraries.

## Commands

```bash
pnpm typecheck      # TypeScript checks in every workspace package
pnpm lint           # ESLint, React hooks, JSX accessibility, React Refresh
pnpm test           # Shared, web, and server Vitest suites
pnpm test:e2e       # Playwright scenarios in Chromium and WebKit
pnpm build          # Shared, server, and web production builds
pnpm db:backup      # Create and verify a retained SQLite snapshot
pnpm db:restore     # Verify a backup; requires --apply to restore it
pnpm release:check  # Validate lockstep SemVer and changelog metadata
pnpm format         # Format TypeScript, JSON, and Markdown with Prettier
```

Install both E2E browsers before the first local run:

```bash
pnpm exec playwright install --with-deps chromium webkit
```

Run a single browser with `pnpm test:e2e --project=chromium` or `pnpm test:e2e --project=webkit`.

## Test coverage

Vitest covers the shared parsers and schemas, React components and hooks, API routes and services, migrations, backup and restore behaviour, and security regressions. Release tooling and documentation links use separate Node.js test suites (`pnpm release:test` and `pnpm docs:test`).

Playwright uses an isolated API, media fixture, SQLite database, and cwd-relative caches. It verifies:

- sign-in and protected routes;
- library browsing, search, details, settings, and dialog accessibility;
- real video and music playback;
- forward/backward seeking and resume after reload;
- HLS manifests, segments, seek windows, and encoder lifecycle;
- controlled transport interruption and bounded HLS recovery; and
- Chromium and WebKit browser paths.

The HLS fault proxy is test-only and injects HTTP 503 responses into actual HLS requests, including native WebKit media traffic. It introduces no production endpoint or browser media mock. These are controlled transport failures, not real Wi-Fi or cellular handover tests.

## Continuous integration

Run the HLS scenarios with `pnpm test:e2e e2e/hls.spec.ts`. They use an H.264/PCM MKV fixture to exercise compatibility playback. CI runs Chromium on Linux and WebKit on macOS; codec support depends on the browser and operating system. [Playwright WebKit](https://playwright.dev/docs/browsers#webkit) is not branded Safari or a physical iOS-device test.

`pnpm docs:check` checks local file links, images, and heading anchors in root Markdown files and `docs/`; external URLs are not fetched. Run `pnpm docs:test` when changing the checker.

CI runs typecheck, tests, and production builds at the supported Node 22.13 floor and on Node 24. It starts the production Docker Compose stack and probes the API through Nginx, then runs Chromium and WebKit E2E jobs.

Dependency auditing runs independently via `pnpm audit:ci`, with a ten-minute step limit. It first runs the production-only npm audit with bounded request retries. A high/critical npm finding, malformed output, configuration/authentication error, or interrupted process blocks the gate without fallback. Only recognized transient network errors and temporary audit-endpoint responses (408/429/500/502/503/504) can invoke OSV-Scanner.

The fallback downloads [OSV-Scanner](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/) at a fixed version and verifies its pinned SHA-256 before execution. It scans the **entire** canonical pnpm v9 lockfile, including development and optional/platform packages; this is broader than the primary production audit, not identical coverage or advisory data. Every locked name/version must appear in the JSON report. CVSS scores of 7.0 or higher block; unknown severity, missing packages, empty/malformed reports, checksum failures, and scanner/network errors also block. No vulnerability/package exclusions or reachability-based dismissals are enabled. Reports, stderr, and a provider verdict are retained as `dependency-audit-reports` for seven days. A successful fallback is explicitly reported as OSV, never as a successful npm audit.

Audit-service outages do not block application checks through job dependencies; package installation still needs registry access or cached packages. The existing required `e2e` check aggregates verification, both browsers, and the final audit verdict. Failed, cancelled, or skipped audit results keep this gate red. `pnpm ci:test` checks the fallback policy, package coverage, workflow dependencies, and all 125 upstream-result combinations. `pnpm audit:prod` remains available for an unmodified npm-only scan. Review and update the OSV version and asset digests together in `scripts/audit-dependencies.mjs`; unsupported lockfile layouts fail closed until reviewed.

A separate least-privilege workflow scans both production images for fixable high/critical vulnerabilities and retains CycloneDX SBOMs. CodeQL scans JavaScript and TypeScript. Release pull requests dry-run both target architectures; `v*` tags publish provenance-attested, keyless-signed GHCR images with SBOMs and immutable digest manifests. Dependabot updates digest-pinned base images and SHA-pinned actions.

## Contribution workflow

Read [CONTRIBUTING.md](../CONTRIBUTING.md) before editing. Keep changes focused, add regression coverage for behaviour changes, run the documented checks, and update both English and Turkish documentation when user-visible behaviour changes.

Version work must also follow [Releasing CineDrive](RELEASING.md) and update [CHANGELOG.md](../CHANGELOG.md).
