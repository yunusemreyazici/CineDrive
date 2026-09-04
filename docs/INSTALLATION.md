# Installing CineDrive

[Documentation](../README.md#documentation) · [Türkçe](INSTALLATION.tr.md)

CineDrive can run from source, with Docker Compose, or as a systemd service on a dedicated Debian/Ubuntu host. Use production-quality secrets for every installation.

## Requirements

Choose one runtime path:

- Docker with Docker Compose; or
- Node.js 22.13+ on the Node 22 line, or Node.js 24, with pnpm 11.

All paths also require OpenSSL for generating secrets. Google Drive libraries require a Google Cloud OAuth client; local-folder-only installations do not access Drive, although the current environment schema still expects syntactically valid placeholder OAuth values. Normal Node and Docker installations use the bundled `ffmpeg-static` binary. `fpcalc`/Chromaprint is optional and enables acoustic fingerprinting.

## Docker Compose

Clone the repository and create the environment file:

```bash
git clone https://github.com/yunusemreyazici/CineDrive.git
cd CineDrive
cp .env.example .env
```

Generate separate values for the two secret fields:

```bash
openssl rand -hex 32 # SESSION_SECRET
openssl rand -hex 32 # TOKEN_ENCRYPTION_KEY
```

Paste the values into `.env`, replace all example credentials and public URLs, and configure the administrator account. Local-only use needs no Google connection, but keep non-empty placeholder OAuth client values and a valid callback URL because the environment schema requires them.

Build and start the stack:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Nginx exposes the application on port 80 and proxies `/api` to the server. The server applies versioned Prisma migrations before starting. Application data, the subtitle cache, and Nginx logs live in named volumes.

Tagged releases also publish `linux/amd64` and `linux/arm64` images to GHCR. For a repeatable deployment, use the release Compose override with the immutable digest references attached to the GitHub Release:

```bash
cp release.env.example release.env
```

Fill `release.env` with the verified image digest references from your chosen release, following [image verification](RELEASING.md). Do not use the example placeholders. Then run:

```bash
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml pull
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml up -d --no-build
```

See [Operations](OPERATIONS.md) before exposing the installation to the internet and [Releasing CineDrive](RELEASING.md) for image verification and rollback procedures.

## First library setup

After signing in as an administrator, open the optional setup wizard from the empty home page or Settings → Libraries. You can also visit `/setup`. Existing libraries and the usual Settings workflow remain available; there is no forced onboarding.

1. Choose a local folder or Google Drive.
2. Check access. For local folders, enter an absolute path visible to the **server** (the container path in Docker). For Drive, connect an account in the new tab, return and refresh the accounts, then select an account. Keep the safer default to scan a specific folder and enter its folder ID, or explicitly choose the whole-account option. A whole-account scan indexes all accessible Drive media and can take substantially longer. See [Google Drive setup](GOOGLE_DRIVE.md) for OAuth configuration.
3. Review and create the source. This does not start a scan.
4. Start the scan and follow its status. A failed scan can be retried without creating another source.

The local access check only opens the selected directory; it does not inspect media or guarantee access to every child. Scanning does not move or delete your media. Once the source is saved, its ID is kept in the page URL, so you can reload or return through the saved-source list. Unsaved form details are not persisted. Scans continue on the server after you leave the page.

## Local media in Docker

The container cannot see host media folders unless you mount them. Add a read-only bind mount to the existing `server.volumes` in `docker-compose.yml`, preserving the named volumes:

```yaml
services:
  server:
    volumes:
      - app_data:/app/data
      - subtitle_cache:/app/data/subtitle_cache
      - /absolute/path/to/media:/media:ro
```

Replace the host path with your collection, ensure the container user can read it, and recreate the service with `docker compose up -d`. Create a local library using `/media` in Settings, not the host path. Do not mount unrelated private directories.

## Debian/Ubuntu VPS

For a fresh Debian or Ubuntu host:

```bash
git clone https://github.com/yunusemreyazici/CineDrive.git
cd CineDrive
sudo bash scripts/install-vps.sh
```

The interactive installer configures a dedicated system user, Node.js, pnpm, FFmpeg, SQLite, systemd, Nginx, and TLS. TLS options include Cloudflare Origin Certificates, Certbot/Let's Encrypt, and HTTP-only mode.

Review the installer before running it on a host that already serves other applications: it writes systemd and Nginx configuration.

## Local development

Install the locked dependencies and create the environment file:

```bash
git clone https://github.com/yunusemreyazici/CineDrive.git
cd CineDrive
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -hex 32 # SESSION_SECRET
openssl rand -hex 32 # TOKEN_ENCRYPTION_KEY
```

Change the copied production URLs for local development:

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

Paste the generated values into `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`, then set `ADMIN_EMAIL` and `ADMIN_PASSWORD`. If you use Google Drive, configure the credentials in [Google Drive setup](GOOGLE_DRIVE.md) and register the same local callback URL.

Generate Prisma Client, apply migrations, and start both applications:

```bash
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
pnpm dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Liveness: `http://localhost:3000/api/health`
- Database readiness: `http://localhost:3000/api/ready`

A relative SQLite URL is resolved from `apps/server/prisma/`, so the example creates `apps/server/prisma/data/app.db`. The administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD` is created on first boot. Sign in, then create a local library or connect Drive from Settings.

For the full environment reference and multi-user mode, see [Configuration](CONFIGURATION.md). For repository commands and tests, see [Development](DEVELOPMENT.md).
