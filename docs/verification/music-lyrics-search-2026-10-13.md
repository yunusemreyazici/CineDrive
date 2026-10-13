# Music lyrics search — 2026-10-13

## Architecture

`GET /api/music/search?q=...` retains its metadata results and adds an optional
shared-contract field `lyricsMatches: [{ track, excerpt }]`. Older clients ignore
the additive field. CineMusic renders lyrics-only hits separately and uses normal
track actions and playback.

The migration adds nullable derived `MusicLyrics.searchText`, an external-content
SQLite FTS5 index and insert/update/delete triggers. Existing original lyrics are
backfilled on readiness in ten-row batches with parsing outside short transactions
and an event-loop yield between batches. Updates compare original content so a
concurrent edit cannot be overwritten. Raw updates touch only derived text,
preserving `updatedAt`, timing, original content, translations and revisions.
Persisted progress makes interrupted backfills resumable.

Lyrics imports/provider saves, manual edits and revision restoration maintain the
derived text. Deleting a track cascades into index cleanup. Search itself never
calls providers, AI or background enrichment and never scans the full catalog into
RAM. It queries FTS for full-phrase priority, then literal word-prefix matches,
with at most eight hydrated results and 182 Unicode characters per excerpt.

## Access and safety

- Existing music authentication remains mandatory.
- Library ownership/membership and active drive-file predicates apply **before**
  FTS ranking/limits, then again during track/content hydration.
- Search strings are normalized to literal words, parameterized, capped at 200
  raw characters and 12 terms, and require at least three normalized characters.
- Turkish accents/dotted/dotless I fold deterministically; other scripts remain.
- LRC timestamps and metadata headers do not enter searchable text or excerpts.
- Current hydrated lyrics are checked again so a concurrent replacement cannot
  emit an excerpt against an obsolete index hit.
- No provider request, secret, complete lyrics blob or private catalog is included
  in the new response. Only access-controlled tracks and short matching excerpts.

## Deployment

Startup follow-up: the initially awaited readiness backfill was replaced by a
non-blocking post-listen worker after a production timeout. See
[startup recovery](music-lyrics-background-startup-2026-10-13.md) for the updated
lifecycle, retry and shutdown behavior. The paragraph below records the original
verification/deployment approach, not the current startup requirement.

Use the supported `prisma migrate deploy` path before starting this server; do not
use `db push`. First startup may wait longer for existing lyrics to be indexed.
Subsequent startup only backfills rows with null derived text. FTS tables are
intentionally not Prisma models; migration drift tests allow only the two known
derived search indexes and their actual SQLite shadow tables.

This task did not migrate a live database, deploy, commit, push, or modify secrets.
Existing uncommitted memory/artwork changes were preserved. Operations docs in
English and Turkish explain the startup behavior and feature limits.

## Verification

New tests use isolated SQLite databases and mock providers, never real external
lyrics lookups. Results:

- `pnpm --filter @cinedrive/server exec vitest run`: 479 tests / 63 files passed,
  including the populated lyrics upgrade, FTS drift, permissions, phrase ranking,
  current-content check, editing/restoration/deletion and bounded backfill.
- `pnpm --filter @cinedrive/shared test`: 30 tests / 4 files passed.
- `pnpm --filter @cinedrive/web exec vitest run`: 155 tests / 34 files passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed. Entry bundle budget passed
  at 371.24 kB raw / 108.48 kB gzip.
- `pnpm docs:check`, `git diff --check`: passed.
- Prisma client regenerated; migrations were applied only to temporary test
  databases through the migration deployment tests, not the live database.

CineMusic's full iOS unit suite passed (1,586 tests), followed by a final targeted
31 search unit tests and two lyrics UI tests against the latest code. The UI tests
cover English and Turkish accessibility XXXL text, playback and scope exclusion.
The native verification report records Mac Catalyst results separately.

## Follow-ups

Offline lyrics search is not included. Catalog coverage depends on persisted
lyrics; fetching missing lyrics remains the existing separate background process.
Live deployment and real-device checks are still required before claiming live
coverage or latency improvements.
