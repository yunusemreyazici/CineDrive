# Configuration

[Documentation](../README.md#documentation) · [Türkçe](CONFIGURATION.tr.md)

Copy `.env.example` to `.env` and replace every example credential and deployment URL. Use [`.env.example`](../.env.example) for deployment defaults and the [environment schema](../packages/shared/src/schemas/env.schema.ts) for validated core settings.

## Core settings

| Variable                           | Purpose                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | SQLite URL. Use an absolute path in containers and production.                                                       |
| `NODE_ENV`, `PORT`                 | Runtime mode and API listening port (default `3000`).                                                                |
| `APP_NAME`, `LOG_LEVEL`            | Application name and server logging verbosity.                                                                       |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID`      | Initial root folder for the administrator's automatically created Drive library; does not override later UI changes. |
| `SESSION_SECRET`                   | Cookie-signing secret; at least 32 characters.                                                                       |
| `TOKEN_ENCRYPTION_KEY`             | Exactly 64 hexadecimal characters used to encrypt Google refresh tokens.                                             |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`    | Initial administrator created on first boot.                                                                         |
| `APP_AUTH_MODE`                    | Set to `multi-user` for administrator-managed accounts.                                                              |
| `APP_URL`, `PUBLIC_URL`, `API_URL` | Browser-visible application and API addresses.                                                                       |
| `CORS_ORIGIN`                      | Allowed browser origin; normally the public application origin.                                                      |
| `TRUST_PROXY`                      | Enable only behind the included Nginx or another trusted reverse proxy.                                              |

Generate separate values for the two secret fields:

```bash
openssl rand -hex 32
```

Never commit `.env`, OAuth secrets, encryption keys, or downloaded credential files.

## Google Drive and metadata

| Variable                                   | Purpose                                                             |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web client credentials.                                |
| `GOOGLE_REDIRECT_URI`                      | OAuth callback; must exactly match the URL registered with Google.  |
| `METADATA_LANGUAGE`                        | Language stored by future metadata scans; default `tr-TR`.          |
| `MUSIC_METADATA_ONLINE`                    | Enables conservative MusicBrainz completion for missing local tags. |
| `TMDB_API_KEY`                             | Deployment-wide fallback for movie and series metadata.             |
| `OPENSUBTITLES_API_KEY`                    | Deployment-wide fallback for subtitle discovery.                    |
| `ACOUSTID_API_KEY`                         | Deployment-wide fallback for acoustic matching.                     |

TMDB, OpenSubtitles, and AcoustID keys can also be saved per user under **Settings → API management**. User-specific values take precedence over deployment-wide fallbacks. `METADATA_LANGUAGE` is separate from the interface language: changing it affects future scans, not metadata already stored in SQLite.

See [Google Drive setup](GOOGLE_DRIVE.md) for the OAuth consent screen, scopes, and callback configuration.

## Playback and optional services

| Variable                                       | Purpose                                     |
| ---------------------------------------------- | ------------------------------------------- |
| `HLS_MAX_ACTIVE_JOBS`                          | Maximum simultaneous HLS encoding jobs.     |
| `HLS_CACHE_MAX_BYTES`                          | On-disk HLS cache quota.                    |
| `TRANSCODE_MAX_ACTIVE_SESSIONS`                | Maximum simultaneous compatibility streams. |
| `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | Optional lyrics translation provider.       |
| `FPCALC_PATH`                                  | Optional Chromaprint executable path.       |

Playback limits protect the host from unbounded FFmpeg work. Raise them only after observing available CPU, memory, and disk capacity. See [Playback](PLAYBACK.md) for the mode and recovery model.

## Optional AI playlist planning

Natural-language playlist planning is disabled unless `MUSIC_AI_API_KEY` is set. It is server-side only and does not affect the regular Music Discovery V2 endpoints.

| Variable              | Purpose                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `MUSIC_AI_PROVIDER`   | Provider adapter; `groq` is the default.                              |
| `MUSIC_AI_API_KEY`    | Server-only provider credential. Leave empty to disable the feature.  |
| `MUSIC_AI_MODEL`      | OpenAI-compatible model ID; default `qwen/qwen3.8-27b`.               |
| `MUSIC_AI_BASE_URL`   | OpenAI-compatible API root; default `https://api.groq.com/openai/v1`. |
| `MUSIC_AI_TIMEOUT_MS` | Provider deadline, validated between 8000 and 12000 ms.               |

The provider receives only the listener prompt plus a bounded aggregate of canonical genres, genre counts, total track count, year range, and decade counts. Track titles, albums, catalogue artists, favourites, listening history, file paths, and credentials are never included. The model returns a declarative intent; filtering, scoring, seeded selection, and track hydration remain local to CineDrive.

Language constraints are evaluated entirely locally from persisted track evidence. Existing lyrics metadata wins, otherwise cached lyrics text is detected locally with `franc-min`; explicit language-bearing genres such as `turkish rock` or `anatolian rock` are the final deterministic fallback. Generic genres, artist names, and title characters are not language evidence. Hard language constraints accept only manual, lyrics-metadata, high-confidence lyrics-detection, or explicit-genre evidence; unknown tracks are excluded and the target count is never filled by relaxing the language constraint.

Existing catalogues can be enriched in the background with authenticated maintenance endpoints. `POST /api/music/maintenance/languages/enrich` first processes lyrics already cached in SQLite in local batches of 200, then submits still-unknown tracks with missing lyrics to the existing LRCLIB lookup/cache layer in batches of 25 with at most two workers. Provider requests remain globally rate-limited and use bounded retries for 429, 5xx, and network failures. Persisted queue state, a 15-minute processing lease, increasing error backoff, and a seven-day retry delay for `not_found` results prevent every run from restarting the full catalogue. New library scans trigger only the fast local/cache pass; provider fetching runs only in the user-started background maintenance job.

An optional `maxTracks` POST body can cap a pilot run, for example `{ "maxTracks": 200 }`. The limit applies only to external provider lookups; cached lyrics are always processed first without consuming it. A bounded pilot deterministically samples evenly across the full eligible queue instead of taking its first rows. Omitting the field preserves the existing full background order and behavior with the same batch and concurrency controls. Valid values are 1–5000.

`GET /api/music/maintenance/languages/stats` reports `lyricsAvailable`, `lyricsMissing`, `pendingEnrichment`, `queued`, `processing`, `completed`, `notFound`, `retryWaiting`, `failed`, `lyricsDetected`, `languagesResolvedThisRun`, `providerLookups`, `providerHttp429`, `providerHttp5xx`, `lastJobStartedAt`, and `lastJobCompletedAt` in addition to known/unknown counts, languages, sources, and job status. Provider counters describe the last completed in-process job. Only title, artist, album, and duration are sent for a provider lookup. Returned lyrics are cached in SQLite and detected locally with `franc-min`; lyrics content is never sent to the AI provider.

Year filtering currently uses the persisted track year, falling back to the album edition year. CineDrive does not yet persist a verified original recording/release year from MusicBrainz, so a reissue such as a 1998 remaster can still match a 1990s constraint. No year is guessed from the title. Original-release-year enrichment remains a future metadata-maintenance task.

## Multi-user mode

The administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` exists in both authentication modes. To enable administrator-managed accounts:

```dotenv
APP_AUTH_MODE=multi-user
```

Restart CineDrive, then use **Settings → Account** to create users and grant listener or editor access to libraries. Libraries, favourites, history, playlists, playback state, API keys, and Google connections are user-scoped. Playback state is also separated by playback client so browser tabs and mobile clients do not overwrite one another.
