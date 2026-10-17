import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseBackup, restoreDatabaseBackup } from '../src/lib/database-backup.js';
import { serverRoot } from './test-database.js';
import { createPrismaClient } from '../src/lib/prisma-client.js';
import { backfillLyricsSearch, searchLyrics } from '../src/services/music-lyrics-search.service.js';

const migrationsRoot = path.join(serverRoot, 'prisma/migrations');
const schemaPath = path.join(serverRoot, 'prisma/schema.prisma');
const productionConfigPath = path.join(serverRoot, 'prisma.config.ts');
const fixtureConfigPath = path.join(serverRoot, 'tests/fixtures/migration-test.config.ts');
const fixtureScriptPath = path.join(serverRoot, 'tests/fixtures/migration-fixture.mjs');
const temporaryRoots: string[] = [];

const runPrisma = (args: string[], databaseUrl: string, extraEnvironment = {}) =>
  execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RUST_LOG: 'debug',
      ...extraEnvironment,
    },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

const createHistoricalDatabase = async (checkpoint: string, seedMode: string) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-migration-test-'));
  temporaryRoots.push(temporaryRoot);
  const databasePath = path.join(temporaryRoot, 'legacy.db');
  const historicalMigrations = path.join(temporaryRoot, 'migrations');
  await fs.mkdir(historicalMigrations);
  await fs.copyFile(
    path.join(migrationsRoot, 'migration_lock.toml'),
    path.join(historicalMigrations, 'migration_lock.toml'),
  );

  const migrationEntries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrationNames = migrationEntries
    .filter((entry) => entry.isDirectory() && entry.name <= checkpoint)
    .map((entry) => entry.name)
    .sort();
  expect(migrationNames.at(-1)).toBe(checkpoint);

  for (const migrationName of migrationNames) {
    await fs.cp(
      path.join(migrationsRoot, migrationName),
      path.join(historicalMigrations, migrationName),
      { recursive: true },
    );
  }

  const databaseUrl = `file:${databasePath}`;
  runPrisma(['migrate', 'deploy', '--config', fixtureConfigPath], databaseUrl, {
    CINEDRIVE_MIGRATION_TEST_SCHEMA: schemaPath,
    CINEDRIVE_MIGRATION_TEST_MIGRATIONS: historicalMigrations,
  });
  execFileSync(process.execPath, [fixtureScriptPath, seedMode, databasePath], {
    cwd: serverRoot,
    stdio: 'pipe',
  });

  return { databasePath, databaseUrl };
};

const deployCurrentMigrations = (databaseUrl: string) =>
  runPrisma(['migrate', 'deploy', '--config', productionConfigPath], databaseUrl);

const verifyFixture = (mode: string, databasePath: string) => {
  execFileSync(process.execPath, [fixtureScriptPath, mode, databasePath], {
    cwd: serverRoot,
    stdio: 'pipe',
  });
};

const verifyNoSchemaDrift = (databaseUrl: string) => {
  const drift = runPrisma(
    [
      'migrate',
      'diff',
      '--from-config-datasource',
      `--to-schema=${schemaPath}`,
      '--script',
      '--config',
      productionConfigPath,
    ],
    databaseUrl,
  );
  // Prisma cannot model SQLite FTS5 virtual/shadow tables. Their intentional
  // presence is the only accepted difference from schema.prisma.
  const withoutFtsTables = drift.replace(
    /-- DropTable\s+PRAGMA foreign_keys=off;\s+DROP TABLE "(?:MediaItemSearch|MusicLyricsSearch)(?:_(?:config|data|docsize|idx))?";\s+PRAGMA foreign_keys=on;\s*/g,
    '',
  );
  expect(withoutFtsTables.trim()).toBe('');
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => fs.rm(temporaryRoot, { recursive: true, force: true })),
  );
});

describe('production database migrations', () => {
  it('adds the Studio journal without rewriting existing collaborative playlists or profiles', async () => {
    const { databaseUrl } = await createHistoricalDatabase(
      '20261016000000_music_studio',
      'seed-music',
    );
    const before = createPrismaClient(databaseUrl);
    let snapshot: unknown;
    try {
      await before.user.create({
        data: {
          id: 'studio-guest',
          email: 'studio-guest@example.test',
          name: 'Guest',
          passwordHash: 'fixture',
        },
      });
      await before.musicPlaylist.create({
        data: {
          id: 'studio-existing',
          userId: 'music-user',
          name: 'Existing',
          items: { create: { id: 'studio-occurrence', trackId: 'music-track', position: 0 } },
          memberships: { create: { userId: 'studio-guest', role: 'editor', accepted: true } },
        },
      });
      await before.musicStudio.create({
        data: { userId: 'music-user', revision: 7, content: '{"families":[],"sessions":[]}' },
      });
      snapshot = {
        playlist: await before.musicPlaylist.findUnique({
          where: { id: 'studio-existing' },
          include: { items: true, memberships: true },
        }),
        studio: await before.musicStudio.findUnique({ where: { userId: 'music-user' } }),
      };
    } finally {
      await before.$disconnect();
    }
    deployCurrentMigrations(databaseUrl);
    const after = createPrismaClient(databaseUrl);
    try {
      expect({
        playlist: await after.musicPlaylist.findUnique({
          where: { id: 'studio-existing' },
          include: { items: true, memberships: true },
        }),
        studio: await after.musicStudio.findUnique({ where: { userId: 'music-user' } }),
      }).toEqual(snapshot);
      expect(await after.musicPlaylistRevision.count()).toBe(0);
      expect(await after.musicStudioOperation.count()).toBe(0);
      expect(await after.musicStudioChange.count()).toBe(0);
    } finally {
      await after.$disconnect();
    }
    verifyNoSchemaDrift(databaseUrl);
  }, 30_000);
  it('upgrades existing synchronized lyrics through migrate deploy and backfills search without rewriting them', async () => {
    const { databasePath, databaseUrl } = await createHistoricalDatabase(
      '20260809040000_music_discovery_lyrics_tools',
      'seed-music',
    );
    deployCurrentMigrations(databaseUrl);
    verifyFixture('verify-music', databasePath);
    const prisma = createPrismaClient(databaseUrl);
    try {
      const before = await prisma.musicLyrics.findUniqueOrThrow({ where: { id: 'music-lyrics' } });
      expect(before.searchText).toBeNull();
      await backfillLyricsSearch(prisma);
      const after = await prisma.musicLyrics.findUniqueOrThrow({ where: { id: before.id } });
      expect(after).toMatchObject({
        content: before.content,
        isSynced: before.isSynced,
        offsetMs: before.offsetMs,
        sourceType: before.sourceType,
        updatedAt: before.updatedAt,
      });
      expect(after.searchText).toBeTruthy();
      const matches = await searchLyrics(prisma, 'music-user', after.searchText!);
      expect(matches.map((match) => match.track.id)).toContain(before.trackId);
      await backfillLyricsSearch(prisma);
      expect(
        (await prisma.musicLyrics.findUniqueOrThrow({ where: { id: before.id } })).searchText,
      ).toBe(after.searchText);
    } finally {
      await prisma.$disconnect();
    }
    verifyNoSchemaDrift(databaseUrl);
  }, 30_000);

  it.each([
    ['video', '20260101000000_init', 'seed-initial', 'verify-initial'],
    ['music', '20260809040000_music_discovery_lyrics_tools', 'seed-music', 'verify-music'],
    [
      'Connect',
      '20260923050000_playback_progress_latest_media_index',
      'seed-connect',
      'verify-connect',
    ],
    [
      'indexed media',
      '20260923050000_playback_progress_latest_media_index',
      'seed-fts',
      'verify-fts',
    ],
  ])(
    'restores the pre-upgrade %s snapshot and can upgrade it again',
    async (_label, checkpoint, seedMode, verifyMode) => {
      const { databasePath, databaseUrl } = await createHistoricalDatabase(checkpoint, seedMode);
      const backup = await createDatabaseBackup({ databaseUrl });
      const snapshotBytes = await fs.readFile(backup.backupPath);

      deployCurrentMigrations(databaseUrl);
      verifyFixture(verifyMode, databasePath);
      const upgradedBytes = await fs.readFile(databasePath);
      expect(upgradedBytes.equals(snapshotBytes)).toBe(false);

      const dryRun = await restoreDatabaseBackup({ databaseUrl, backupPath: backup.backupPath });
      expect(dryRun.applied).toBe(false);
      expect(await fs.readFile(databasePath)).toEqual(upgradedBytes);

      // No server or database connection is running during replacement. The
      // entire file must return to the snapshot, including migration history.
      const restored = await restoreDatabaseBackup({
        databaseUrl,
        backupPath: backup.backupPath,
        apply: true,
      });
      expect(restored.applied).toBe(true);
      expect(await fs.readFile(databasePath)).toEqual(snapshotBytes);
      expect(restored.preRestoreBackupPath).toBeTruthy();
      verifyFixture(verifyMode, restored.preRestoreBackupPath!);

      deployCurrentMigrations(databaseUrl);
      verifyFixture(verifyMode, databasePath);
      verifyNoSchemaDrift(databaseUrl);
    },
    60_000,
  );

  it('upgrades the initial video schema without losing relational data and is repeatable', async () => {
    const { databasePath, databaseUrl } = await createHistoricalDatabase(
      '20260101000000_init',
      'seed-initial',
    );

    deployCurrentMigrations(databaseUrl);
    verifyFixture('verify-initial', databasePath);
    verifyNoSchemaDrift(databaseUrl);

    const secondDeploy = deployCurrentMigrations(databaseUrl);
    expect(secondDeploy).toContain('No pending migrations to apply');
    verifyFixture('verify-initial', databasePath);
  }, 30_000);

  it('upgrades a populated music schema and preserves legacy metadata backfills', async () => {
    const { databasePath, databaseUrl } = await createHistoricalDatabase(
      '20260809040000_music_discovery_lyrics_tools',
      'seed-music',
    );

    deployCurrentMigrations(databaseUrl);
    verifyFixture('verify-music', databasePath);
    verifyNoSchemaDrift(databaseUrl);

    const secondDeploy = deployCurrentMigrations(databaseUrl);
    expect(secondDeploy).toContain('No pending migrations to apply');
    verifyFixture('verify-music', databasePath);
  }, 30_000);
});
