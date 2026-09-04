# Production Operations

[Documentation](../README.md#documentation) · [Türkçe](OPERATIONS.tr.md)

This guide covers the safeguards required after installation. Read [Installation](INSTALLATION.md) first and keep the exact deployed version plus verified off-host backups in your operations records.

## Production checklist

- Serve CineDrive over HTTPS and expose the Nginx entry point, not the API container, to the internet.
- Replace every example password, OAuth secret, `SESSION_SECRET`, and `TOKEN_ENCRYPTION_KEY`; never reuse development credentials.
- Make `APP_URL`, `PUBLIC_URL`, `CORS_ORIGIN`, and the registered Google callback agree with the same public origin.
- Set `TRUST_PROXY=true` only behind the included Nginx or another trusted reverse proxy.
- Confirm `docker compose ps` reports the server as healthy, or inspect `systemctl status cinedrive` on a VPS.
- Keep verified database snapshots outside the application host or Docker volume.
- Record the deployed commit, release tag, and immutable image digests before every upgrade.

The startup checks use `/api/ready`, which returns `503` until SQLite can answer. `/api/health` is a process-only liveness check. A healthy process is not sufficient evidence that the database is ready.

## Logs and runtime health

Docker logs:

```bash
docker compose ps
docker compose logs -f
```

VPS service state:

```bash
systemctl status cinedrive
journalctl -u cinedrive -f
```

The administration interface includes storage, codec, FFmpeg job, scan, and database maintenance views. Playback concurrency is deliberately bounded; raise `HLS_MAX_ACTIVE_JOBS` or `TRANSCODE_MAX_ACTIVE_SESSIONS` only when the host has enough CPU, memory, and disk capacity.

## Upgrades

Before upgrading:

1. Create and verify a database snapshot.
2. Copy it outside the application host or Docker volume.
3. Record the current commit, release tag, and image digests.
4. Read the release notes and configuration changes.

For a source installation, install locked dependencies, regenerate Prisma Client, apply versioned migrations, and rebuild before restarting:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
pnpm build
```

Production migrations use `prisma migrate deploy`. Do not use `prisma db push` against a production database. After startup, require `/api/ready` to return `200`, then verify sign-in and one existing library before considering the upgrade complete.

For VPS source installations, rerunning `sudo bash scripts/install-vps.sh` performs these steps with additional branch, working-tree, snapshot, and readiness guards. Keep the recovery details printed by a failed run; they identify both commits and the exact pre-migration snapshot.

Tagged releases publish provenance-attested, keyless-signed `linux/amd64` and `linux/arm64` GHCR images plus SBOMs and immutable digest manifests. Follow [Releasing CineDrive](RELEASING.md) to verify artifacts and use `docker-compose.release.yml`.

## Rollback

If migration or startup fails, stop CineDrive and preserve the failed database and logs for diagnosis. Roll back the application to the recorded version and restore the pre-upgrade snapshot. Never start an older binary against a database already changed by newer migrations.

The migration regression suite upgrades populated historical video and music databases, checks SQLite integrity and foreign keys, detects schema drift, and repeats deployment to catch non-idempotent startup behaviour. This reduces risk but does not replace a restorable production backup.

## Backups

Create a consistent SQLite snapshot while CineDrive is running. Every snapshot is checked with SQLite `integrity_check`; the newest 14 are retained by default:

```bash
pnpm db:backup
pnpm db:backup -- --output-dir /secure/cinedrive-backups --retain 30
```

The VPS installer enables `cinedrive-backup.timer`, which runs daily and keeps 14 snapshots under `/var/lib/cinedrive/backups`.

Docker backups remain inside the application data volume:

```bash
docker compose exec server node apps/server/dist/cli/database-backup.js --retain 14
docker compose cp server:/app/data/backups ./cinedrive-backups
```

A Docker volume protects against container replacement, not host or disk loss. Copy important snapshots to independent storage and test restoration periodically.

Restore is a dry run unless `--apply` is present. The dry run verifies the selected file and prints the target. Stop CineDrive before applying the restore. The tool creates an additional pre-restore safety backup and removes stale SQLite WAL sidecars during the atomic replacement.

```bash
pnpm db:restore -- --from /secure/cinedrive-backups/cinedrive-YYYYMMDDTHHMMSSZ.db
# Stop the server, then:
pnpm db:restore -- --from /secure/cinedrive-backups/cinedrive-YYYYMMDDTHHMMSSZ.db --apply
```

## Security maintenance

- Keep Docker base images, GitHub Actions, and package dependencies current through reviewed Dependabot pull requests.
- Do not expose `.env`, SQLite files, caches, backup directories, or the server container directly.
- Review CodeQL, container security, CI, and release workflow results before merging or deploying.
- Report vulnerabilities through the private process in [SECURITY.md](../SECURITY.md), not a public issue.

## Troubleshooting

- **Local login redirects or the cookie is not saved:** confirm `NODE_ENV=development`, the localhost URLs in [Installation](INSTALLATION.md), and `TRUST_PROXY=false`.
- **Google rejects the OAuth callback:** `GOOGLE_REDIRECT_URI` must be identical in `.env` and the Google Cloud OAuth client. See [Google Drive setup](GOOGLE_DRIVE.md).
- **A scan finishes with missing files:** inspect the library source and scan history under Settings. Failed items retain their errors and can be analysed again.
- **A title plays in Chromium but not Safari:** this is usually a container or audio-codec difference. Settings → Storage and media health shows each browser's playback plan.
- **Playback waits before starting:** inspect active FFmpeg jobs and the queue. Raise the limits only after confirming host capacity.
- **Music metadata is incomplete:** inspect embedded tags, then run Music library care suggestions. MusicBrainz completion does not overwrite authoritative local tags automatically.
- **Lyrics translation is unavailable:** configure `LIBRETRANSLATE_URL`; lyric lookup itself does not require LibreTranslate.
