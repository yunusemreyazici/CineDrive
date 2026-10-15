# Music personalization API

Native companion: CineMusic Discover personalization hub, smart rules and playlist offline readiness. Existing unrelated web playlist-search changes are preserved.

## API

- Authenticated `GET /api/music/personalization`: bounded profile with revision, preferences, smartLists, feedback.
- Authenticated `PUT /api/music/personalization`: validates the complete profile and accessible feedback IDs, requires current revision, and atomically compares the stored JSON before incrementing revision. Stale writes return 409. No arbitrary filters, queries or SQL accepted.
- Authenticated `GET /api/music/personalization/smart/:id`: evaluates the requesting user's saved rule using accessible lightweight candidates plus grouped meaningful listening history. Rate limited to 20/minute. Returns matching IDs, matchedCount, limit and downloadedOnly. Download intersection and limit are applied on the requesting device, not server.
- Responses are private/no-store. User IDs are taken only from authentication, not request bodies.

## Selection

Normal discovery cache keys include personalization revision. Neutral preferences preserve existing 0.65 relevance ratio, artist cap 4 and global artist cap 12. Exploration changes relevance share; artist diversity changes caps; recent-play preference scales existing penalties. Familiar mode includes listened catalogue tracks in the Daily pool. Positive feedback adds bounded artist/genre affinity. Hidden tracks and snoozed artists are filtered before selection, including its relaxation passes. Favorites/history are never mutated.

AI manual/editorial generation and artist radio are intentionally unchanged. Clients describe this scope. No new provider calls or catalogue export.

Smart lists use exact normalized track/album genre matching and language confidence >=0.8; all constraints intersect. Fewer than the target count is valid. Meaningful history uses the existing min(30s, 45% duration), or 15s for unknown duration, threshold. Download availability is device-local.

## Deployment

Additive migration `20261015000000_music_personalization` adds `User.musicPersonalization TEXT NOT NULL DEFAULT '{}'`. Run normal production backup and migration deployment before serving the new binary. No additional environment variables. Older native clients continue using discovery with neutral defaults until the account changes preferences.

## Checks

- Full server suite: 67 files / 514 tests passed, with real migrations on an isolated temporary database. Legacy manually-created User fixture updated for the additive column.
- Shared suite: 4 files / 30 tests passed.
- Server/shared/web typechecks, shared/server builds and changed-file ESLint checks passed.
- Cross-user inaccessible feedback rejection, unknown smart-list ownership, auth requirement, private caching, stale revision, meaningful history date aggregation, hard language and hidden-track exclusion after discovery cache invalidation tested.
- Native: iOS and Mac Catalyst builds; targeted unit and offline-readiness UI tests. Production was not deployed or queried for this task.

Current limits: maximum 30 rules and 200 feedback entries, 10–250 selected smart-list tracks. Rule evaluation returns lightweight matching IDs across the accessible catalogue (rather than full hydrated tracks) so downloaded-only intersection cannot lose matches due to server-side truncation. Very large multi-user catalogues may warrant paginated match snapshots in a later version.
