# CineDrive

**[Türkçe](README.tr.md)** · English

A self-hosted media server that turns the movies and series sitting in your Google Drive folders — or on a local disk — into a browsable, streamable library.

CineDrive scans your storage, matches each file against TMDB for artwork and metadata, and streams it back to the browser. Files that a browser cannot play natively are transcoded on the fly; everything else is served directly with byte-range requests, untouched.

## Screenshots

| Home                                         | Media detail                                            |
| -------------------------------------------- | ------------------------------------------------------- |
| ![Home](docs/screenshots/home_dashboard.png) | ![Media detail](docs/screenshots/media_detail_page.png) |

> The screenshots predate the most recent interface work and are due a refresh.

## Features

### Library

- **Google Drive** — read-only OAuth 2.0 access to your folders and any Shared Drives you can reach. CineDrive never writes to Drive.
- **Local folders** — point a library at a path on the server and scan it without involving Drive at all.
- **Multiple accounts** — connect several Google accounts. Each library belongs to a user, and one account's media, favourites and history are invisible to another.
- **Metadata** — titles, summaries, genres, cast, posters and backdrops from TMDB, falling back to TVMaze when no TMDB key is configured.
- **Music library** — indexes tagged audio from Drive and local folders into artists, albums and tracks, with favourites, history, playlists and an account-synchronised queue.
- **Search** — `⌘K` / `Ctrl+K` opens an instant, keyboard-navigable search over the library.
- **Filtering** — sort and filter by rating, release period and genre; results are paginated server-side.

### Playback

- **Direct streaming** — HTTP Range (206) responses, so seeking works without downloading the file.
- **Compatibility transcoding** — when the browser cannot play the source, FFmpeg produces an HLS stream on demand. The number of concurrent encoders and the on-disk cache are both capped.
- **Per-browser playback plans** — the same file may play directly in Chromium and need HLS in Safari; CineDrive decides per file and per browser from the probed codecs.
- **Subtitles** — OpenSubtitles search and one-click download, `.srt` / `.vtt` upload, timing offset and styling.
- **Resume** — playback position, watch history and automatic next-episode transitions.

### Interface

- **Two languages** — Turkish and English, switched from Settings → Language.
- **Seven colour themes** plus a cinema mode that dims the interface during playback.
- **Maintenance screens** — bulk data management, storage analysis (size, resolution distribution, duplicates), media health (codec compatibility, live FFmpeg jobs, playback telemetry) and database management (row counts, leftover-record cleanup).

## Architecture

```
CineDrive/
├── apps/
│   ├── server/          # Fastify REST API and media server
│   │   ├── prisma/      # Schema, migration history, runtime data
│   │   ├── scripts/     # One-off maintenance scripts
│   │   └── src/
│   │       ├── routes/      # HTTP surface
│   │       ├── services/    # Drive, scanning, metadata, HLS, subtitles
│   │       ├── plugins/     # Prisma and auth as Fastify plugins
│   │       └── utils/       # Shared helpers (ownership filters, concurrency)
│   └── web/             # React + Vite front end
│       └── src/
│           ├── pages/       # Route-level screens
│           ├── features/    # Player and its hooks
│           ├── components/  # Shared UI
│           └── i18n/        # tr / en dictionaries
├── packages/
│   └── shared/          # Types, Zod schemas, filename parsers
├── e2e/                 # Playwright scenarios and isolated environment
├── nginx/               # Reverse proxy configuration
├── .github/workflows/   # CI
├── Dockerfile.server
├── Dockerfile.web
└── docker-compose.yml
```

### How playback is decided

Every video file is probed during the scan, and its container, video codec and audio codec are stored. When a client asks to play something, the server picks one of four modes per browser:

| Mode     | What happens                                                            |
| -------- | ----------------------------------------------------------------------- |
| `direct` | The file is streamed as-is over HTTP Range. No transcoding.             |
| `audio`  | Video is copied, only the audio track is re-encoded to AAC.             |
| `hls`    | An HLS stream is produced on demand; video may be copied or re-encoded. |
| `full`   | Both tracks are re-encoded to H.264 + AAC.                              |

Safari and Chromium get separate answers because their codec support differs — Settings → Media health shows the distribution across your library.

### Data model

Sixteen tables, of which the core chain is:

```
User ──< Library ──< DriveFile ──< Movie / Episode
             └──< MediaItem ──< Season / SubtitleTrack / Favorite / …
```

`Library.userId` and `MediaItem.libraryId` are what every access check keys on: a request only ever sees rows reachable from the caller's own libraries.

## Getting Started

### Requirements

- Node.js 20 or newer — the Docker images build on `node:20-alpine`
- pnpm (the repository is a pnpm workspace; the images install it through Corepack)
- FFmpeg — bundled via `ffmpeg-static`, no system install required
- A Google Cloud project with the Drive API enabled, for Drive libraries
- Optionally a TMDB API key for richer metadata, and an OpenSubtitles key for subtitle search

### Development

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Configure the environment**

   ```bash
   cp .env.example .env
   ```

   Fill in your Google OAuth credentials, a `SESSION_SECRET` of at least 32 characters, a 64-character hex `TOKEN_ENCRYPTION_KEY`, and the admin account you want created on first boot.

3. **Prepare the database**

   ```bash
   pnpm --filter "@cinedrive/server" exec prisma migrate deploy
   ```

   > Prisma resolves a relative `file:` URL against the **schema directory**
   > (`apps/server/prisma/`), not the working directory. The default
   > `file:./data/app.db` therefore means `apps/server/prisma/data/app.db`.

4. **Run it**

   ```bash
   pnpm dev
   ```

   - Web: `http://localhost:5173`
   - API: `http://localhost:3000`

   The admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` is created on first boot. Connect Google Drive afterwards from the Settings page — the OAuth flow needs a signed-in user.

### Upgrading an existing installation

Libraries carry `Library.userId` and media rows carry `MediaItem.libraryId`. Both columns live in the migration history, so `migrate deploy` is enough.

If your database predates the migration history entirely, backfill ownership first. The script is a dry run by default:

```bash
pnpm --filter "@cinedrive/server" exec tsx scripts/add-library-owner.ts --apply
```

## Testing

```bash
pnpm typecheck     # tsc across every package
pnpm lint          # ESLint, including react-hooks / jsx-a11y / react-refresh
pnpm test          # Vitest: shared + web + server
pnpm test:e2e      # Playwright end-to-end scenarios
```

The server suite creates its own throwaway SQLite database and removes it afterwards; it never touches the development database. The end-to-end run starts its own API and web servers on separate ports, renders a real H.264 clip with FFmpeg and drives sign-in, browsing, playback and settings against it.

CI runs typecheck, lint, unit tests and a build on every push, with the end-to-end suite gated behind them.

## Configuration

`.env.example` documents every variable. The ones you are most likely to touch:

| Variable                        | Description                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | SQLite location. A relative path resolves against the Prisma schema directory.           |
| `SESSION_SECRET`                | Session cookie signing key, 32 characters minimum.                                       |
| `TOKEN_ENCRYPTION_KEY`          | 64-character hex key used to encrypt stored Google refresh tokens.                       |
| `METADATA_LANGUAGE`             | Language TMDB titles and summaries are fetched in (default `tr-TR`).                     |
| `MUSIC_METADATA_ONLINE`         | Complete missing music fields through conservative MusicBrainz matches (default `true`). |
| `HLS_MAX_ACTIVE_JOBS`           | How many FFmpeg transcodes may run at once.                                              |
| `HLS_CACHE_MAX_BYTES`           | HLS cache quota; least-recently-used streams are evicted past it.                        |
| `TRANSCODE_MAX_ACTIVE_SESSIONS` | Concurrent live compatibility sessions.                                                  |

**`METADATA_LANGUAGE` is not the interface language.** The interface language is each browser's own choice; TMDB text is written into the database during a scan and shared by everyone reading the library. Changing this variable affects **future scans only** — existing records keep the language they were fetched with until you rescan.

## Deployment

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

The server container runs `prisma migrate deploy` on start, so the schema is built from the versioned migration history rather than inferred from the schema file.

Nginx sits in front as a reverse proxy with buffering disabled on the streaming routes, so byte-range and HLS responses reach the client as they are produced.

## Troubleshooting

**The library is empty after a scan.** Check Settings → Media health: files that failed to probe are listed there with their error, and can be re-analysed individually.

**A title plays in Chrome but not in Safari.** That is expected for HEVC and some audio codecs. Settings → Media health shows which playback mode each browser gets; the player also has a manual audio/Safari compatibility toggle.

**Playback stalls or never starts.** Media health shows active FFmpeg jobs, the wait queue and how far ahead each stream has buffered. If the queue is full, raise `HLS_MAX_ACTIVE_JOBS` — subject to the CPU you have.

**Metadata came back in the wrong language.** See `METADATA_LANGUAGE` above; it applies to new scans only.

**Records point at files that no longer exist.** Settings → Database has a leftover-record cleanup that removes media with nothing playable behind it and clears scans that were interrupted mid-run.

## License

MIT
