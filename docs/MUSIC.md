# Music Studio and discovery

[Documentation](../README.md#documentation) · [Türkçe](MUSIC.tr.md)

## Shared playlists

Open **Music → Music Studio** on the web. Create a playlist, invite an account on the same server, and choose editor or listener access. Invitations must be accepted. Compatible CineMusic clients can also create expiring invitation links; the owner can rotate or revoke them.

Playlist access and library access are separate. Every listener needs access to the underlying media library. Unavailable tracks stay hidden, and incomplete workshops are read-only to avoid accidentally removing inaccessible entries. Legacy owner-only playlist write endpoints retain their permissions.

The workshop supports multiselect, duplicate selection, selected-slot sorting, copying and moving tracks. Changes use version checks: refresh after a conflict before submitting another edit. History shows actors and changed tracks for the last 100 Studio content revisions. Restoration requires explicit confirmation and current edit access. Cross-list moves/copies are inspectable but are not restored one-sided. Deleting an entire playlist also deletes its journal.

Studio catches up through a targeted change feed while visible and on focus/reconnect. This is polling, not a background push notification service. Accepted shared playlists also appear in normal library/sync responses.

## Local recommendations and recording versions

Compatible clients can request up to eight suggestions based on playlist genre, artist and era metadata. The existing seeded Discovery engine handles selection/diversity. Listed tracks, dismissed suggestions and known alternate recordings are excluded before selection. Generation changes refresh suggestions; an unchanged generation stays repeatable for an unchanged catalogue and playlist.

Reasons describe confirmed metadata affinities, not measured mood or audio analysis. Suggestions never automatically modify a playlist. An empty or inaccessible seed playlist can return no suggestions.

In Studio's recordings and sessions tab, link known versions of a recording and choose a preferred version. A preferred track is used only when it is eligible. Saved listening checkpoints restore the saved occurrence/order and position explicitly; unavailable tracks produce a conflict rather than silently changing the queue.

## AI intent and strict constraints

Natural-language playlist generation in **Mixes and Radio** is optional. Configure `MUSIC_AI_*` on the server; leaving the API key empty keeps normal Discovery and local recommendations available.

The AI receives the prompt and bounded genre/year/count summaries, not track-title lists, albums, listening history or favorite-track names. It produces a validated declarative plan. Local metadata filtering, scoring and seeded selection choose tracks.

Explicit language, genre, artist and year constraints remain hard unless the prompt softens them. Missing confirmed metadata can reduce the result count; a target of 50 is not permission to add tracks that violate hard constraints. Small results show coverage diagnostics where supported. Vibes such as “night drive” approximate existing metadata, not BPM/energy measurements.

Discovery preferences, feedback and smart-playlist rules are available through the compatible client APIs. They do not require AI.

## Lyrics coverage and background work

Lyrics search uses original lyrics already stored/indexed on the server. A song with no cached original lyrics cannot match a lyrics-only query. Sidecar `.lrc` files and LRCLIB results can populate the cache; translations do not substitute for original search evidence.

Periodic LRCLIB enrichment defaults to one bounded pass every five minutes, at most 25 tracks per run. It reuses provider concurrency/rate limits, retry backoff and not-found cooldowns. LRCLIB receives song metadata for lookups; this is separate from AI playlist planning. Set `MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES=0` to disable periodic lookups. Existing cached lyrics and their search index remain usable.

Maintenance statistics show missing lyrics/language evidence, queue progress and retry states. Administrators can inspect global worker observations; a manual pilot is bounded to 200 tracks. Viewing status does not launch an unbounded full-catalogue lookup. Unknown language stays unknown until local evidence resolves it; hard language filtering is not relaxed.

## Upgrading

Version 1.3.0 adds persistent collaboration/history, lyrics/search and personalization migrations. Follow the [1.2.0 → 1.3.0 checklist](RELEASING.md#120-to-130-checklist), update server/web together and keep your pre-upgrade database backup. Native controls require a compatible CineMusic build. See [Listen Together](listen-together.md) for the distinct synchronized-listening protocol.
