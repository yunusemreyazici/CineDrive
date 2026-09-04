<div align="center">
  <img src="docs/assets/cinedrive-mark.svg" alt="CineDrive logo" width="156" height="156" />

  <h1>CineDrive</h1>

  <p><strong>Your movies, series and music. Your storage. Your server.</strong></p>

  <p>
    Self-hosted streaming for movies, series, and music from Google Drive or local folders.<br />
    Direct play when possible. On-demand HLS transcoding when needed.
  </p>

  <p><a href="README.tr.md">Türkçe</a> · <strong>English</strong></p>

  <p>
    <a href="https://github.com/yunusemreyazici/CineDrive/actions/workflows/ci.yml"><img src="https://github.com/yunusemreyazici/CineDrive/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
    <a href="https://github.com/yunusemreyazici/CineDrive/actions/workflows/codeql.yml"><img src="https://github.com/yunusemreyazici/CineDrive/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL status" /></a>
    <a href="https://github.com/yunusemreyazici/CineDrive/actions/workflows/container-security.yml"><img src="https://github.com/yunusemreyazici/CineDrive/actions/workflows/container-security.yml/badge.svg?branch=main" alt="Container security status" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-06B6D4" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Node.js-22.13%20%7C%2024-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22.13 or 24" />
    <img src="https://img.shields.io/badge/deployment-Docker%20Compose-2496ED?logo=docker&logoColor=white" alt="Docker Compose deployment" />
  </p>

</div>

<p align="center">
  <a href="#why-cinedrive">Why CineDrive?</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#features">Features</a> ·
  <a href="#quick-start">Get started</a> ·
  <a href="#documentation">Documentation</a>
</p>

## Why CineDrive?

**CineDrive turns Google Drive or server-local folders into a personal streaming library for movies, TV series, and music.** Keep your files where they are, browse a poster-led library, and pick up where you left off.

Run the application and database on your own server. Google Drive is an optional storage source, not a requirement for local libraries.

| Built for                   | What you get                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| ☁️ Google Drive collections | Multiple Google accounts, regular folders, Shared Drives, and read-only access.   |
| 💾 Local media              | Server-local libraries without moving your collection into a new storage service. |
| 🎬 Movie nights             | Metadata, subtitles, resume playback, and browser-aware compatibility playback.   |
| 🎵 Your music collection    | Albums, mixes, radio, lyrics, Replay statistics, and a persistent queue.          |
| 🛠️ Library care             | Metadata editing, duplicate archiving, acoustic matching, and media health tools. |
| 🔐 Self-hosting             | Your server and database, user-scoped access, and an MIT-licensed codebase.       |

## Screenshots

| Movies and series                                      | Media details                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| ![CineDrive home](docs/screenshots/home_dashboard.png) | ![CineDrive media details](docs/screenshots/media_detail_page.png) |

| Music library                                                       | Listening statistics                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| ![Album and track details](docs/screenshots/music_album_detail.png) | ![CineDrive Replay](docs/screenshots/music_replay.png) |

<details>
<summary>More: lyrics, mixes, library care, and media health</summary>

| Synced lyrics                                              | Mixes and radio                                      |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| ![Synced lyrics](docs/screenshots/music_player_lyrics.png) | ![Mixes and radio](docs/screenshots/music_mixes.png) |

| Library care                                                 | Storage and media health                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| ![Music maintenance](docs/screenshots/music_maintenance.png) | ![Storage and media health](docs/screenshots/settings_storage_health.png) |

</details>

Screenshots show the Turkish interface; English is also available.

## Features

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
- Admin-only CPU, memory, disk I/O, network, temperature and seven-day bandwidth monitoring alongside codec, FFmpeg job, scan, and database maintenance screens.
- Rate limiting, secure cookies, CORS, Helmet headers, structured logging, and graceful shutdown.

Read the [playback guide](docs/PLAYBACK.md) for direct/audio/HLS/full modes, browser differences, quality controls, and bounded stream recovery.

## Quick start

| Your goal                               | Start here                                                       |
| --------------------------------------- | ---------------------------------------------------------------- |
| Self-host on an existing Docker host    | Docker quick start below                                         |
| Use versioned container images          | [Verified release images](docs/RELEASING.md)                     |
| Provision a dedicated Debian/Ubuntu VPS | [VPS installer](docs/INSTALLATION.md#debianubuntu-vps)           |
| Develop locally                         | [Node.js and pnpm setup](docs/INSTALLATION.md#local-development) |

### Docker Compose

Requires Docker Compose and OpenSSL. Run these commands from the repository directory:

```bash
git clone https://github.com/yunusemreyazici/CineDrive.git
cd CineDrive
cp .env.example .env
openssl rand -hex 32 # Generate SESSION_SECRET
openssl rand -hex 32 # Generate TOKEN_ENCRYPTION_KEY separately
```

Before starting, edit `.env`:

- Paste the two generated secrets and choose your own administrator email and password.
- Set the public URLs, CORS origin, and callback to match your deployment.
- For Drive libraries, follow [Google Drive setup](docs/GOOGLE_DRIVE.md).
- For local-only use, keep non-empty OAuth placeholders; mount your media directory into the server container as described in [Installation](docs/INSTALLATION.md#local-media-in-docker).
- If you do not have a TMDB key, leave the value empty: `TMDB_API_KEY=`.

```bash
docker compose up -d --build
docker compose ps
```

Nginx listens on port 80. Sign in with your configured administrator account, then create a library in Settings. Configure HTTPS before exposing the service publicly; see the [production checklist](docs/OPERATIONS.md#production-checklist).

This quick start builds from source. For reproducible deployments without a local build, use the [release Compose override and verified image digests](docs/RELEASING.md).

### Before you begin

- **Runtime:** source installations support Node.js 22.13+ on the 22 line, or Node.js 24, with pnpm 11. Docker does not require Node on the host.
- **Media processing:** normal Node/Docker installations include FFmpeg; Chromaprint is optional.
- **Accounts:** local media needs no Google connection. CineDrive still requires an application login.
- **Multi-user:** enable administrator-managed accounts and library roles through [Configuration](docs/CONFIGURATION.md#multi-user-mode).
- **Updates:** the project is under active development. Keep verified off-host backups and read upgrade notes before updating.

## Documentation

Choose a guide rather than scrolling through every installation and operating detail:

| Guide                                  | Covers                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [Installation](docs/INSTALLATION.md)   | Docker, local media mounts, VPS installer, and local development            |
| [Configuration](docs/CONFIGURATION.md) | Environment variables, API keys, resource limits, and multi-user mode       |
| [Google Drive](docs/GOOGLE_DRIVE.md)   | OAuth client, read-only scopes, callback URLs, and troubleshooting          |
| [Playback](docs/PLAYBACK.md)           | Video modes, subtitles, music playback, HLS recovery, and browser coverage  |
| [Operations](docs/OPERATIONS.md)       | HTTPS, health checks, logs, upgrades, backups, restore, and troubleshooting |
| [Development](docs/DEVELOPMENT.md)     | Architecture, commands, tests, CI, and contribution workflow                |
| [Releasing](docs/RELEASING.md)         | SemVer, GHCR images, signatures, SBOMs, and release rollback                |

Every guide has an English/Turkish language link at the top.

## Contributing and security

Contributions, reproducible bug reports, and focused feature requests are welcome.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and required checks.
- Review [CHANGELOG.md](CHANGELOG.md) for changes and upgrade context.
- [Open an issue](https://github.com/yunusemreyazici/CineDrive/issues/new/choose) for bugs and feature proposals.
- Do not report vulnerabilities publicly; follow [SECURITY.md](SECURITY.md).

## Support CineDrive

If CineDrive is useful to you, give the repository a star, share it with other self-hosters, or contribute a focused improvement.

## License

CineDrive is available under the [MIT License](LICENSE).

<p align="center"><strong>Your media. Your storage. Your server.</strong><br /><a href="#cinedrive">Back to top</a></p>
