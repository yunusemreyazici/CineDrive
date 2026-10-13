# Automatic missing original lyrics — 2026-10-13

## Behavior

- Periodic provider maintenance selects one batch of at most 25 active tracks
  without cached lyrics, independently of known/unknown/manual track language.
- Only non-disabled library owners are included. Artist, album and positive
  duration remain required; existing lyrics, fresh leases and retry cooldowns
  are excluded before selection.
- `MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES` defaults to 5; 0 disables it.
  Startup is delayed 30 seconds after listen, never awaited by readiness.
  Subsequent intervals begin after completion; no overlapping periodic passes.
- Reuses the existing LRCLIB cache, two-worker concurrency, globally serialized
  provider limiter, bounded HTTP retries, 15-minute lease, increasing failure
  backoff and seven-day not-found cooldown.
- Atomic per-track claims also protect manual/automatic concurrent runs.
  Shutdown stops new selection and drains in-flight work before DB disconnect.
- Fetched original lyrics immediately enter the existing FTS search index.
  Translations are not searched. Lookup sends title/artist/album/duration, not
  language filters, catalogue lists, history, credentials or AI requests.
- Manual language evidence and existing lyrics saved during an online request
  are preserved. HARD language matching and local language detection are unchanged.
- Batch logs expose aggregate checked/found/notFound/failed/429/5xx only.
  Language-maintenance last-job counters still describe manual jobs; persisted
  lyricsAvailable/lyricsMissing counts reflect automatic progress as well.

## Verification

- Focused lyrics/language/lifecycle suites: 44 passed across 4 files.
- Full server: 500 passed across 65 files.
- Shared: 30 passed across 4 files; web: 164 passed across 34 files.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`,
  `git diff --check`: passed. Web entry 371.43 kB raw / 108.61 kB gzip.
- Eight new tests cover validated config/default/disable, delayed startup,
  non-overlap, drain/cancel, bounded backoff, one 25-row query for a simulated
  10k catalogue, claim conflicts and stop-before-new-work. SQLite integration
  covers known Turkish/English/manual/unknown tracks, concurrent passes,
  fresh/stale leases, due/future retries, inactive/missing metadata, disabled
  owners, existing-lyrics preservation, manual language preservation and FTS.
- Provider traffic is mocked or explicitly forbidden. Periodic enrichment does
  not start under NODE_ENV=test. No test requests hit LRCLIB.

## Delivery

Work is on `codex/automatic-missing-lyrics`. No migration, native update or AI
API key is required. No production deployment or live enrichment run was
performed during development. Deployment enables periodic lookup by
default; set the interval to 0 beforehand if external lookup is unwanted.
Provider coverage is not guaranteed and incomplete track metadata is skipped.
