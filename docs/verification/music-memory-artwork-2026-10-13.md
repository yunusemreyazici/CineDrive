# Music memory / artwork experiment — 2026-10-13

## Scope

Local branch `codex/music-memory-artwork`, based on main `e8d40af`.
No live service/configuration/catalogue writes, deployments, migration,
client changes, commits or pushes. Do not infer a production memory leak from
a single RSS snapshot. Production RSS savings and user-visible network latency
have not been measured for these changes.

## Changes

- Keep the existing 512-entry thumbnail LRU, variants, JPEG quality and two
  concurrent renders. No Sharp global cache/concurrency changes.
- Authorize every artwork request with the existing library-scoped relation
  filter. Select only checksum/MIME on thumbnail and conditional requests.
  RAM/disk hits and 304 responses never load the original BLOB.
- Coalesce disk reads, source loads and rendering by checksum/variant. Obtain
  a render slot before invoking a lazy source loader so queued foreground
  requests do not hold original BLOBs. Promote queued background work if a
  visible request needs that variant; foreground work is FIFO ahead of prewarm.
- Original unconditional responses still use one database read. A cold
  thumbnail uses a metadata read plus one lazy BLOB read, with authorization
  and checksum rechecked. This extra cold database read is a tradeoff; the
  synthetic service benchmark below does not quantify it. A fallback reuses
  the same per-request load. Deleted/revoked/version-changed sources return 404.
- Buffer responses use the existing database byte view without another full
  copy. ETags, MIME/fallback, private cache headers and legacy dimensions remain.
- Lyrics provider cache: 512 entries / 8 MiB weighted payload budget; keep the
  existing 12-hour found and 15-minute missing TTLs. No retry/throttle changes.
- MusicBrainz caches: 12-hour positive TTL, 15-minute negative TTL where misses
  were already cached; bounded entries and payloads. Album/artist image results
  are weighted by Buffer bytes without JSON-serializing the image. These are
  enrichment caches, not the thumbnail cache or persisted artwork.

MusicBrainz per-instance budgets: album 128 entries / 8 MiB; recording
1024 / 2 MiB; artist image 32 / 8 MiB; discovery artist image 32 / 8 MiB;
artist identity 512 / 1 MiB; Deezer identity 512 / 1 MiB. Two existing consumers
can each instantiate a service. Limits are per cache/instance, not process RSS.
Weights include keys/payloads, not all JS/Map/native overhead. TTL pruning is
opportunistic on access/insertion; there are no lifecycle-retaining timers.

## Reproducible source-load experiment

```sh
pnpm --filter @cinedrive/server exec vitest run \
  tests/music-artwork-memory-experiment.test.ts --silent=false --reporter=verbose
```

Synthetic 960×720 random-noise PNG (1.98 MiB), production Sharp renderer,
isolated temporary disk cache, identical output bytes. Compare the old eager
source-loading pattern against the new lazy pattern with the same thumbnail
service. This isolates source loading, not a complete before/after deployment.
Assertions occur outside latency measurements; timing is diagnostic, not a
flaky performance gate. One local run:

| Scenario                    | Eager original loads / MiB | Lazy original loads / MiB | Eager → lazy time     |
| --------------------------- | -------------------------- | ------------------------- | --------------------- |
| 20 concurrent cold requests | 20 / 39.64                 | 1 / 1.98                  | 12.69 → 7.02 ms total |
| 100 RAM hits                | 100 / 198.18               | 0 / 0                     | 0.177 → 0.001 ms p50  |
| Disk hit after restart      | 1 / 1.98                   | 0 / 0                     | 1.23 → 0.17 ms        |

MiB values are **cumulative source bytes loaded**, not peak resident memory
or measured database traffic. Numbers vary with hardware/GC/load; original load
counts and output equivalence are deterministic assertions. Production rollout
should compare RSS/heap/external memory and cold/warm artwork latency under the
same workload before claiming end-to-end savings or speed guarantees.

## Verification

The new route cache/304 regression failed against the old implementation, then
passed after the fix. Tests cover lazy/disk/RAM coalescing, queued source
loading, foreground promotion, failed-load cleanup, original/legacy/fallback,
ETags, authenticated/unauthenticated/inaccessible artwork and revoked access
between metadata/source loads. Cache tests cover LRU, byte/entry budgets,
oversized replacements, negative TTL and 10,000 distinct keys. Provider cache
tests use mocks only; no real HTTP provider requests.

Passed locally: server **470** tests / 62 files; shared **30** / 4;
web **155** / 34. Updated benchmark rerun separately: 1 passed. Typecheck,
zero-warning lint, production build/bundle budget, documentation links and
diff whitespace checks passed. No new CI run or native build claimed.

```sh
pnpm --filter @cinedrive/server test
pnpm --filter @cinedrive/shared test
pnpm --filter @cinedrive/web exec vitest run --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
pnpm docs:check
git diff --check
```
