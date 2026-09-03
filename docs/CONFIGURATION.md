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

## Multi-user mode

The administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` exists in both authentication modes. To enable administrator-managed accounts:

```dotenv
APP_AUTH_MODE=multi-user
```

Restart CineDrive, then use **Settings → Account** to create users and grant listener or editor access to libraries. Libraries, favourites, history, playlists, playback state, API keys, and Google connections are user-scoped. Playback state is also separated by playback client so browser tabs and mobile clients do not overwrite one another.
