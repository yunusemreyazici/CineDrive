import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(fixtureDirectory, '../../prisma/migrations');
const [mode, databasePath] = process.argv.slice(2);

if (!mode || !databasePath) {
  throw new Error(
    'Usage: node migration-fixture.mjs <seed-initial|seed-music|verify-initial|verify-music> <database.db>',
  );
}

const database = new DatabaseSync(databasePath);

const seedInitialDatabase = () => {
  database.exec(`
    PRAGMA foreign_keys=ON;
    BEGIN;
    INSERT INTO "User" ("id", "email", "name", "role", "createdAt", "updatedAt")
      VALUES ('legacy-user', 'legacy@example.test', 'Legacy User', 'admin', '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "Session" ("id", "userId", "token", "expiresAt", "createdAt")
      VALUES ('legacy-session', 'legacy-user', 'legacy-session-token', '2030-01-01T00:00:00.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "GoogleConnection" ("id", "userId", "googleAccountId", "email", "encryptedRefreshToken", "scopes", "createdAt", "updatedAt")
      VALUES ('legacy-connection', 'legacy-user', 'google-account-1', 'legacy@example.test', 'encrypted-token', 'drive.readonly', '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "Library" ("id", "name", "userId", "storageType", "rootFolderId", "googleConnectionId", "createdAt", "updatedAt")
      VALUES ('legacy-library', 'Legacy Library', 'legacy-user', 'gdrive', 'legacy-root', 'legacy-connection', '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "DriveFile" ("id", "libraryId", "googleDriveFileId", "name", "mimeType", "size", "status", "createdAt", "updatedAt")
      VALUES ('legacy-file', 'legacy-library', 'drive-file-1', 'Legacy Movie.mp4', 'video/mp4', 123456, 'active', '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "MediaItem" ("id", "type", "title", "normalizedTitle", "year", "createdAt", "updatedAt")
      VALUES ('legacy-media', 'movie', 'Legacy Movie', 'legacy movie', 2024, '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "Movie" ("id", "mediaItemId", "driveFileId")
      VALUES ('legacy-movie', 'legacy-media', 'legacy-file');
    INSERT INTO "PlaybackProgress" ("id", "userId", "mediaItemId", "positionSeconds", "durationSeconds", "percentage", "completed", "createdAt", "updatedAt")
      VALUES ('legacy-progress', 'legacy-user', 'legacy-media', 120, 1200, 10, false, '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "WatchHistory" ("id", "userId", "mediaItemId", "positionSeconds", "durationSeconds", "completed", "deviceType", "watchedAt", "createdAt", "updatedAt")
      VALUES ('legacy-history', 'legacy-user', 'legacy-media', 120, 1200, false, 'web', '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.000Z');
    INSERT INTO "Favorite" ("id", "userId", "mediaItemId", "createdAt")
      VALUES ('legacy-favorite', 'legacy-user', 'legacy-media', '2026-01-02T03:04:05.000Z');
    INSERT INTO "LibraryScan" ("id", "libraryId", "status", "addedCount", "startedAt", "completedAt")
      VALUES ('legacy-scan', 'legacy-library', 'completed', 1, '2026-01-02T03:04:05.000Z', '2026-01-02T03:05:05.000Z');
    INSERT INTO "LibraryScanError" ("id", "scanId", "driveFileId", "errorMessage", "createdAt")
      VALUES ('legacy-scan-error', 'legacy-scan', 'legacy-file', 'sanitized fixture error', '2026-01-02T03:04:05.000Z');
    COMMIT;
  `);
};

const seedMusicDatabase = () => {
  database.exec(`
    PRAGMA foreign_keys=ON;
    BEGIN;
    INSERT INTO "User" ("id", "email", "name", "role", "createdAt", "updatedAt")
      VALUES ('music-user', 'music@example.test', 'Music User', 'admin', '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "GoogleConnection" ("id", "userId", "googleAccountId", "email", "encryptedRefreshToken", "scopes", "createdAt", "updatedAt")
      VALUES ('music-connection', 'music-user', 'google-account-music', 'music@example.test', 'encrypted-token', 'drive.readonly', '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "Library" ("id", "name", "userId", "storageType", "rootFolderId", "googleConnectionId", "createdAt", "updatedAt")
      VALUES ('music-library', 'Music Library', 'music-user', 'gdrive', 'music-root', 'music-connection', '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "DriveFile" ("id", "libraryId", "googleDriveFileId", "name", "mimeType", "size", "audioCodec", "audioSampleRate", "audioBitrate", "audioBitDepth", "audioLossless", "status", "createdAt", "updatedAt")
      VALUES ('music-file', 'music-library', 'drive-music-1', 'Legacy Song.flac', 'audio/flac', 654321, 'flac', 48000, 1000000, 24, true, 'active', '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "MusicArtist" ("id", "userId", "name", "normalizedName", "createdAt", "updatedAt")
      VALUES ('music-artist', 'music-user', 'Legacy Artist', 'legacy artist', '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "MusicAlbum" ("id", "userId", "artistId", "title", "normalizedTitle", "releaseType", "createdAt", "updatedAt")
      VALUES ('music-album', 'music-user', 'music-artist', 'Legacy Album', 'legacy album', 'album', '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "MusicTrack" ("id", "libraryId", "driveFileId", "albumId", "primaryArtistId", "title", "normalizedTitle", "trackNumber", "duration", "metadataLocked", "createdAt", "updatedAt")
      VALUES ('music-track', 'music-library', 'music-file', 'music-album', 'music-artist', 'Legacy Song', 'legacy song', 1, 240, true, '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "MusicLyrics" ("id", "trackId", "content", "sourceName", "sourceType", "language", "translatedContent", "translationLang", "createdAt", "updatedAt")
      VALUES ('music-lyrics', 'music-track', '[00:00.00]Legacy lyric', 'legacy.lrc', 'sidecar', 'en', 'Eski söz', 'tr', '2026-08-10T03:04:05.000Z', '2026-08-10T03:04:05.000Z');
    INSERT INTO "MusicHistory" ("id", "userId", "trackId", "listenedSeconds", "playedAt")
      VALUES ('music-history', 'music-user', 'music-track', 180, '2026-08-10T03:04:05.000Z');
    INSERT INTO "MusicPlaybackState" ("id", "userId", "currentTrackId", "positionSeconds", "shuffleEnabled", "repeatMode", "revision", "updatedAt")
      VALUES ('music-state', 'music-user', 'music-track', 42, false, 'all', 3, '2026-08-10T03:04:05.000Z');
    INSERT INTO "LibraryScan" ("id", "libraryId", "status", "addedCount", "startedAt", "completedAt")
      VALUES ('music-scan', 'music-library', 'completed', 1, '2026-08-10T03:04:05.000Z', '2026-08-10T03:05:05.000Z');
    COMMIT;
  `);
};

const scalar = (sql) => Object.values(database.prepare(sql).get())[0];

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
};

const verifyDatabaseHealth = () => {
  assertEqual(scalar('PRAGMA integrity_check'), 'ok', 'SQLite integrity_check');
  const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
  assertEqual(foreignKeyViolations.length, 0, 'SQLite foreign_key_check violation count');

  const expectedMigrations = fs
    .readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const appliedMigrations = database
    .prepare(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
    )
    .all()
    .map((row) => row.migration_name);
  assertEqual(
    JSON.stringify(appliedMigrations),
    JSON.stringify(expectedMigrations),
    'Applied migrations',
  );
};

const verifyInitialUpgrade = () => {
  verifyDatabaseHealth();
  assertEqual(
    scalar(`SELECT "email" FROM "User" WHERE "id" = 'legacy-user'`),
    'legacy@example.test',
    'User',
  );
  assertEqual(
    scalar(`SELECT "token" FROM "Session" WHERE "id" = 'legacy-session'`),
    'legacy-session-token',
    'Session',
  );
  assertEqual(
    scalar(`SELECT "name" FROM "Library" WHERE "id" = 'legacy-library'`),
    'Legacy Library',
    'Library',
  );
  assertEqual(
    scalar(`SELECT "name" FROM "DriveFile" WHERE "id" = 'legacy-file'`),
    'Legacy Movie.mp4',
    'DriveFile',
  );
  assertEqual(
    scalar(`SELECT "libraryId" FROM "MediaItem" WHERE "id" = 'legacy-media'`),
    'legacy-library',
    'MediaItem library backfill',
  );
  assertEqual(
    scalar(`SELECT "driveFileId" FROM "Movie" WHERE "id" = 'legacy-movie'`),
    'legacy-file',
    'Movie',
  );
  assertEqual(
    scalar(`SELECT "positionSeconds" FROM "PlaybackProgress" WHERE "id" = 'legacy-progress'`),
    120,
    'PlaybackProgress',
  );
  assertEqual(
    scalar(`SELECT "deviceType" FROM "WatchHistory" WHERE "id" = 'legacy-history'`),
    'web',
    'WatchHistory',
  );
  assertEqual(
    scalar(`SELECT COUNT(*) FROM "Favorite" WHERE "id" = 'legacy-favorite'`),
    1,
    'Favorite',
  );
  assertEqual(
    scalar(`SELECT "errorMessage" FROM "LibraryScanError" WHERE "id" = 'legacy-scan-error'`),
    'sanitized fixture error',
    'LibraryScanError',
  );
  assertEqual(
    scalar(
      `SELECT "role" FROM "LibraryMembership" WHERE "libraryId" = 'legacy-library' AND "userId" = 'legacy-user'`,
    ),
    'owner',
    'Owner membership backfill',
  );
  assertEqual(
    scalar(`SELECT COUNT(*) FROM "DriveScanSource" WHERE "libraryId" = 'legacy-library'`),
    1,
    'Drive scan source backfill',
  );
};

const verifyMusicUpgrade = () => {
  verifyDatabaseHealth();
  assertEqual(
    scalar(`SELECT "name" FROM "MusicArtist" WHERE "id" = 'music-artist'`),
    'Legacy Artist',
    'MusicArtist',
  );
  assertEqual(
    scalar(`SELECT "title" FROM "MusicAlbum" WHERE "id" = 'music-album'`),
    'Legacy Album',
    'MusicAlbum',
  );
  assertEqual(
    scalar(`SELECT "title" FROM "MusicTrack" WHERE "id" = 'music-track'`),
    'Legacy Song',
    'MusicTrack',
  );
  assertEqual(
    scalar(`SELECT "audioBitDepth" FROM "DriveFile" WHERE "id" = 'music-file'`),
    24,
    'DriveFile audio metadata',
  );
  assertEqual(
    scalar(
      `SELECT "content" FROM "MusicLyricsTranslation" WHERE "lyricsId" = 'music-lyrics' AND "language" = 'tr'`,
    ),
    'Eski söz',
    'Legacy lyrics translation backfill',
  );
  assertEqual(
    scalar(`SELECT "listenedSeconds" FROM "MusicHistory" WHERE "id" = 'music-history'`),
    180,
    'MusicHistory',
  );
  assertEqual(
    scalar(`SELECT "clientId" FROM "MusicPlaybackState" WHERE "id" = 'music-state'`),
    'legacy',
    'Playback client backfill',
  );
  assertEqual(
    scalar(
      `SELECT "role" FROM "LibraryMembership" WHERE "libraryId" = 'music-library' AND "userId" = 'music-user'`,
    ),
    'owner',
    'Music library owner membership',
  );
};

try {
  if (mode === 'seed-initial') seedInitialDatabase();
  else if (mode === 'seed-music') seedMusicDatabase();
  else if (mode === 'verify-initial') verifyInitialUpgrade();
  else if (mode === 'verify-music') verifyMusicUpgrade();
  else throw new Error(`Unknown migration fixture mode: ${mode}`);
} finally {
  database.close();
}
