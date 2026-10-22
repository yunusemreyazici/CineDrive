# Local playlist recommendations — 2026-10-23

## Behavior

- Authenticated `POST /api/music/studio/playlists/:id/recommendations` accepts a bounded generation ID and at most 100 excluded track IDs. Extra fields are rejected; the endpoint is rate limited to 12 requests per minute and returns `private, no-store`.
- Authorize playlist access before loading candidates. For shared playlists, intersect the caller's and owner's readable catalogues; playlist membership grants no library access. Favorites/history signals belong to the caller. Existing candidate-loader callers keep their previous access behavior.
- Use the existing seeded weighted Discovery selector, then safe batched hydration. Return up to eight suggestions, excluding playlist entries, dismissed suggestions and their alternate recordings before diversity relaxation. Recording groups use explicit user families, MusicBrainz recording IDs and conservative title-suffix normalization. Missing/inaccessible anchors return an empty result.
- Genre, artist and nearby-year affinity comes only from local metadata. If related candidates exist, an unrelated favorite cannot pad the list. Generation seeds allow repeatable refreshes. A final permission/version read rejects concurrent playlist changes.
- Optional per-track `reasons` contain confirmed genre/artist/era affinities only, keyed by returned track IDs. Unknown evidence yields an empty reason array. No AI/provider call or catalogue export is used.
- Suggestions never modify a playlist automatically. Existing version-checked workshop writes handle explicit additions, attribution and history; listeners may read suggestions but cannot edit.

## Compatibility and deployment

Changes are limited to the server and additive shared contracts. No schema migration, dependency or environment changes. No production data or native source files are changed. The native UI can consume the optional explanations independently.

## Verification

Unit coverage includes metadata explanations, bounded input, recording exclusions, preferred versions, 10,000-candidate deterministic selection/diversity and empty seeds. Integration coverage includes authentication, owner/editor/listener/unrelated-user permissions, hidden catalogues, versioned additions and contributor attribution.

Commands passed:

```sh
pnpm --filter @cinedrive/shared build
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm docs:check
git diff --check
```

Full workspace results: **30 shared, 261 web and 549 server tests passed** (69 server test files). Production build/bundle budget passed (357.46 kB raw / 106.08 kB gzip web entry). The tests use isolated databases and mock external providers. No browser or device run is claimed for this server/shared-only change. Logs remain under `/private/tmp/cinedrive-playlist-recommendations-*`, outside version control.
