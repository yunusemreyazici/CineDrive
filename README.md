<div align="center">
  <img src="docs/assets/cinedrive-mark.svg" alt="CineDrive logo" width="156" height="156" />

  <h1>CineDrive</h1>

  <p><strong>Your personal cinema and music library, powered by your own storage.</strong></p>

  <p>
    Self-hosted streaming for movies, series, and music from Google Drive or local folders.<br />
    Direct play when possible. On-demand HLS transcoding when needed.
  </p>

  <p><a href="README.tr.md">Türkçe</a> · <strong>English</strong></p>

  <p>
    <img src="https://img.shields.io/badge/STATUS-ACTIVE%20DEVELOPMENT-06B6D4?style=for-the-badge&labelColor=18181B" alt="Status: active development" />
    <img src="https://img.shields.io/badge/WEB-REACT%2019-06B6D4?style=for-the-badge&labelColor=18181B" alt="Web: React 19" />
    <img src="https://img.shields.io/badge/API-FASTIFY%205-06B6D4?style=for-the-badge&labelColor=18181B" alt="API: Fastify 5" />
    <img src="https://img.shields.io/badge/DATA-PRISMA%20%2B%20SQLITE-06B6D4?style=for-the-badge&labelColor=18181B" alt="Data: Prisma and SQLite" />
    <img src="https://img.shields.io/badge/MEDIA-FFMPEG%20%2B%20HLS-06B6D4?style=for-the-badge&labelColor=18181B" alt="Media: FFmpeg and HLS" />
  </p>

  <p>⭐ If CineDrive is useful to you, consider giving the project a star.</p>
</div>

---

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

### Google Drive API setup

CineDrive uses a server-side OAuth 2.0 flow. It requests your Google account email and the read-only `drive.readonly` scope so it can discover and stream existing files; it never requests permission to modify Drive content.

1. Open the [Google Cloud Console](https://console.cloud.google.com/), create or select a project, and make sure that project remains selected for the following steps.

2. Enable the Google Drive API:

   - Open **APIs & Services → Library**.
   - Search for **Google Drive API**.
   - Open it and select **Enable**.

   Google also provides a direct [Drive API enablement page](https://console.cloud.google.com/apis/library/drive.googleapis.com).

3. Configure the consent screen under **Google Auth Platform**:

   - **Branding:** set the app name to `CineDrive`, choose a support email, and add a developer contact email.
   - **Audience:** choose **External** for personal Google accounts. A project owned by a Google Workspace organization can use **Internal** when only organization members will connect.
   - **Data Access:** add these exact scopes:

     ```text
     https://www.googleapis.com/auth/drive.readonly
     https://www.googleapis.com/auth/userinfo.email
     ```

   `drive.readonly` is classified by Google as a restricted scope because it can read and download existing Drive files. CineDrive uses it read-only and encrypts the refresh token before storing it.

4. While the app is in **Testing**, add every Google account that will connect to CineDrive under **Audience → Test users**.

   > In Testing mode, Google expires the authorization — including an offline refresh token — after seven days. For a long-running personal installation, switch the publishing status to **In production** after testing. Google allows personal-use apps with fewer than 100 users to remain unverified, but users will see an “unverified app” warning during consent. Public or larger deployments using `drive.readonly` can require Google's restricted-scope verification and security review.

5. Create the OAuth client under **Google Auth Platform → Clients**:

   - Select **Create Client**.
   - Choose **Web application** as the application type.
   - Add the callback that matches your CineDrive installation under **Authorized redirect URIs**:

     ```text
     # Local development
     http://localhost:3000/api/auth/google/callback

     # Production
     https://cinedrive.example.com/api/auth/google/callback
     ```

   Replace the production domain with your own. **Authorized JavaScript origins are not required** because the OAuth code exchange happens on the CineDrive server.

6. Copy the generated values into `.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   ```

   `GOOGLE_REDIRECT_URI` must exactly match one of the authorized redirect URIs, including the protocol, host, port, path, and whether a trailing slash is present. Use the HTTPS production callback on a deployed server.

7. Restart CineDrive, sign in with the CineDrive administrator account, then open **Settings → Google Drive → Connect Google Drive**. Google connection credentials are managed from Settings; they are not the same as the CineDrive login account.

Never commit `.env`, the OAuth client secret, or downloaded Google credential files. See Google's official guides for [enabling Workspace APIs](https://developers.google.com/workspace/guides/enable-apis), [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), and [OAuth audience/publishing status](https://support.google.com/cloud/answer/15549945).

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

For multiple accounts, set `APP_AUTH_MODE=multi-user`, restart the server, then use Settings → Account to create users and grant listener or editor access to libraries. Playback state is isolated per user and playback client, so web tabs and iOS devices do not overwrite one another.

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
| `APP_AUTH_MODE`                                | Use `multi-user` to enable administrator-managed account sign-in.        |
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

## License

CineDrive is available under the [MIT License](LICENSE).
