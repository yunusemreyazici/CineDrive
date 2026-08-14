# CineDrive

**[Türkçe](README.tr.md)** · English

CineDrive is a self-hosted media server for movies, series, and music stored in Google Drive or local folders. It scans your files, builds a metadata-rich library, and streams them through a responsive browser interface.

Browser-compatible video is served unchanged with HTTP byte-range requests. When a container or codec is not supported, CineDrive creates an HLS stream with FFmpeg on demand. Music is indexed from embedded tags and comes with albums, artists, mixes, playlists, lyrics, listening history, and a synchronised queue.

## Screenshots

| Home                                                   | Media detail                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| ![CineDrive home](docs/screenshots/home_dashboard.png) | ![CineDrive media detail](docs/screenshots/media_detail_page.png) |

> These screenshots show the movie and series interface. The newer music and maintenance screens are not pictured yet.

## Highlights

### Movies and series

- **Google Drive and local folders** — scan regular folders, Shared Drives, or server-local paths. Drive access uses the read-only OAuth scope.
- **Multiple Drive sources** — connect more than one Google account and manage source folders independently, with per-source scan status and history.
- **Automatic metadata** — artwork, summaries, genres, cast, ratings, age ratings, and trailers from TMDB; TVMaze is used when TMDB is not configured.
- **Library navigation** — full-text search with `⌘K` / `Ctrl+K`, server-side pagination, genre/rating/year filters, and a random picker.
- **Personal state** — favourites, watch history, resume position, completed-state tracking, and automatic next-episode playback.
- **Subtitles** — discover subtitles through OpenSubtitles, upload `.srt` or `.vtt`, adjust timing, and customise their appearance in the player.

### Music

- **Tag-based library** — indexes artists, albums, discs, tracks, genres, release years, credits, and embedded artwork from Drive or local audio files.
- **Discovery** — daily and library-aware mixes, artist/track radio, mood and decade collections, continuous play, and reusable playlists.
- **Replay** — listening statistics by period and year, top artists/albums/tracks, and historical listening summaries.
- **Personal playback** — favourites, history, editable playlists, shuffle/repeat, and an account-synchronised queue and playback position.
- **Lyrics** — sidecar `.lrc` import, LRCLIB lookup, synchronised or plain lyrics, timing alignment, revisions, manual translations, and optional LibreTranslate integration.
- **Audio controls** — ReplayGain loudness normalisation, gapless playback, crossfade, and a five-band equaliser with presets.
- **Library care** — metadata suggestions, bulk editing, duplicate archiving, ReplayGain analysis, Chromaprint/AcoustID matching, and automatic artist artwork discovery.
- **Client sync API** — ETag-aware library sync, batched listening history, download manifests, and authenticated track downloads for mobile/offline clients.

### Platform

- Turkish and English interface languages, seven colour themes, cinema mode, and responsive desktop/mobile navigation.
- User-scoped libraries, favourites, history, playlists, API keys, and encrypted Google refresh tokens.
- Automatic Google access-token refresh and bounded retries for transient Drive failures.
- Storage, codec, FFmpeg job, scan, and database maintenance screens.
- Rate limiting, secure cookies, CORS, Helmet headers, structured logging, and graceful shutdown.

## Playback modes

Every video is probed during a scan. CineDrive stores its container, video codec, audio codec, dimensions, and duration, then creates a browser-specific playback plan.

| Mode     | Behaviour                                                                     |
| -------- | ----------------------------------------------------------------------------- |
| `direct` | The original file is streamed with HTTP Range support; nothing is re-encoded. |
| `audio`  | Video is copied and only the audio track is converted to AAC.                 |
| `hls`    | An HLS stream is generated on demand; compatible tracks can be copied.        |
| `full`   | Video and audio are converted to H.264 + AAC for maximum compatibility.       |

Safari and Chromium may receive different plans for the same file. HLS concurrency and cache size are bounded, and least-recently-used streams are evicted when the cache reaches its quota.

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

All media queries and transport endpoints validate that the requested file is reachable through one of the signed-in user's libraries.

## Quick start

### Requirements

- Node.js 20 or newer
- pnpm 11 (the repository is a pnpm workspace)
- OpenSSL for generating secrets
- A Google Cloud OAuth client with the Drive API enabled when using Google Drive
- No separate FFmpeg installation for normal Node/Docker use; `ffmpeg-static` is included
- Optional `fpcalc`/Chromaprint for acoustic fingerprinting

### Local development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create the environment file:

   ```bash
   cp .env.example .env
   openssl rand -hex 32  # SESSION_SECRET
   openssl rand -hex 32  # TOKEN_ENCRYPTION_KEY
   ```

   For local development, change the copied production URLs to:

   ```dotenv
   NODE_ENV=development
   APP_URL=http://localhost:5173
   API_URL=http://localhost:3000/api
   PUBLIC_URL=http://localhost:5173
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   CORS_ORIGIN=http://localhost:5173
   DATABASE_URL="file:./data/app.db"
   TRUST_PROXY=false
   ```

   Paste the generated secrets into `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`, then set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and your Google OAuth credentials. Register the same local callback URL in Google Cloud.

3. Generate Prisma Client and apply migrations:

   ```bash
   pnpm prisma:generate
   pnpm --filter @cinedrive/server prisma:deploy
   ```

   A relative SQLite URL is resolved from `apps/server/prisma/`, so the example above creates `apps/server/prisma/data/app.db`.

4. Start the API and web app:

   ```bash
   pnpm dev
   ```

   - Web: `http://localhost:5173`
   - API: `http://localhost:3000`
   - Health check: `http://localhost:3000/api/health`

The administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` is created on first boot. After signing in, connect Drive accounts and create libraries from Settings.

## Configuration

`.env.example` contains the deployment-oriented defaults. The most important settings are:

| Variable                                       | Purpose                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`                                 | SQLite URL. Use an absolute path in containers and production.           |
| `SESSION_SECRET`                               | Cookie-signing secret; at least 32 characters.                           |
| `TOKEN_ENCRYPTION_KEY`                         | Exactly 64 hexadecimal characters used to encrypt Google refresh tokens. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | Google OAuth client credentials.                                         |
| `GOOGLE_REDIRECT_URI`                          | OAuth callback; must exactly match the URL registered with Google.       |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                | Initial administrator created on first boot.                             |
| `METADATA_LANGUAGE`                            | Language used for metadata fetched during future scans; default `tr-TR`. |
| `MUSIC_METADATA_ONLINE`                        | Enables conservative MusicBrainz completion for missing local tags.      |
| `HLS_MAX_ACTIVE_JOBS`                          | Maximum simultaneous HLS encoding jobs.                                  |
| `HLS_CACHE_MAX_BYTES`                          | On-disk HLS cache quota.                                                 |
| `TRANSCODE_MAX_ACTIVE_SESSIONS`                | Maximum simultaneous live compatibility sessions.                        |
| `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | Optional lyrics translation provider.                                    |
| `FPCALC_PATH`, `ACOUSTID_API_KEY`              | Optional acoustic fingerprinting configuration.                          |

TMDB, OpenSubtitles, and AcoustID keys can be saved per user under **Settings → API management**. Deployment-wide `TMDB_API_KEY`, `OPENSUBTITLES_API_KEY`, and `ACOUSTID_API_KEY` values act as fallbacks.

`METADATA_LANGUAGE` is separate from the interface language. Metadata is written to the database while scanning; changing the variable affects future scans, not existing rows.

## Deployment

### Docker Compose

Configure `.env` with production URLs and secrets, then run:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Nginx serves the web app and proxies `/api` to the server on port 80. The server container applies versioned Prisma migrations before starting. Application data, subtitle cache, and Nginx logs live in named volumes.

### Debian/Ubuntu VPS

For a fresh VPS, the interactive installer configures a dedicated system user, Node.js, pnpm, FFmpeg, systemd, Nginx, the database, and TLS:

```bash
sudo bash scripts/install-vps.sh
```

The installer supports Cloudflare Origin Certificates, Certbot/Let's Encrypt, or HTTP-only mode. Review the script before running it on an existing server because it writes systemd and Nginx configuration.

### Upgrades

After pulling a new version, install locked dependencies, regenerate Prisma Client, apply migrations, and rebuild before restarting the service:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
pnpm build
```

Migrations are versioned and applied with `prisma migrate deploy`. The server test suite and end-to-end environment use isolated SQLite databases and do not touch the development database.

## Development commands

```bash
pnpm typecheck      # TypeScript checks in every workspace package
pnpm lint           # ESLint, React hooks, JSX accessibility, React Refresh
pnpm test           # Vitest suites for shared, web, and server
pnpm test:e2e       # Playwright smoke scenarios
pnpm build          # Production builds for shared, server, and web
pnpm format         # Format TypeScript, JSON, and Markdown with Prettier
```

CI runs typecheck, lint, unit tests, and production builds for every pull request and push to `main`; Playwright runs after those checks pass.

## Troubleshooting

- **The local login redirects or the cookie is not saved:** confirm `NODE_ENV=development`, the localhost URLs above, and `TRUST_PROXY=false`.
- **Google rejects the OAuth callback:** `GOOGLE_REDIRECT_URI` must be identical in `.env` and the Google Cloud OAuth client.
- **A scan finishes with missing files:** inspect the library source and scan history under Settings. Failed items retain their error and can be analysed again.
- **A title plays in Chromium but not Safari:** this is usually a container/audio-codec difference. Settings → Storage and media health shows the playback plan for each browser.
- **Playback waits before starting:** inspect active FFmpeg jobs and the queue. Increase `HLS_MAX_ACTIVE_JOBS` only when the host has enough CPU and memory.
- **Music metadata is incomplete:** check embedded tags first, then run Music library care suggestions. MusicBrainz completion never overrides authoritative local tags automatically.
- **Lyrics translation is unavailable:** configure `LIBRETRANSLATE_URL`; lyric lookup itself does not require LibreTranslate.
