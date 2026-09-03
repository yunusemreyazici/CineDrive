import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseBackup, restoreDatabaseBackup } from '../src/lib/database-backup.js';
import { serverRoot } from './test-database.js';

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
  runPrisma(
    [
      'migrate',
      'diff',
      '--from-config-datasource',
      `--to-schema=${schemaPath}`,
      '--exit-code',
      '--config',
      productionConfigPath,
    ],
    databaseUrl,
  );
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => fs.rm(temporaryRoot, { recursive: true, force: true })),
  );
});

describe('production database migrations', () => {
  it.each([
    ['video', '20260101000000_init', 'seed-initial', 'verify-initial'],
    ['music', '20260809040000_music_discovery_lyrics_tools', 'seed-music', 'verify-music'],
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
