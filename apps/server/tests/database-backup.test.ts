import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseBackup,
  resolveSqliteDatabasePath,
  restoreDatabaseBackup,
  verifySqliteDatabase,
} from '../src/lib/database-backup.js';
import { createPrismaClient } from '../src/lib/prisma-client.js';

describe('database backup maintenance', () => {
  let temporaryRoot: string;
  let databasePath: string;

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cinedrive-backup-test-'));
    databasePath = path.join(temporaryRoot, 'app.db');

    const prisma = createPrismaClient(`file:${databasePath}`);
    try {
      await prisma.$executeRawUnsafe(
        'CREATE TABLE "Probe" ("id" INTEGER PRIMARY KEY, "value" TEXT NOT NULL)',
      );
      await prisma.$executeRawUnsafe('INSERT INTO "Probe" ("id", "value") VALUES (1, ?)', 'one');
    } finally {
      await prisma.$disconnect();
    }
  });

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it('creates an integrity-checked snapshot and enforces retention', async () => {
    const now = new Date('2026-08-31T12:34:56.000Z');
    const destinationDirectory = path.join(temporaryRoot, "owner's backups");
    const first = await createDatabaseBackup({
      databaseUrl: `file:${databasePath}`,
      destinationDirectory,
      retentionCount: 2,
      now,
    });
    const second = await createDatabaseBackup({
      databaseUrl: `file:${databasePath}`,
      destinationDirectory,
      retentionCount: 2,
      now,
    });
    const third = await createDatabaseBackup({
      databaseUrl: `file:${databasePath}`,
      destinationDirectory,
      retentionCount: 2,
      now,
    });

    expect(path.basename(first.backupPath)).toBe('cinedrive-20260831T123456Z.db');
    expect(path.basename(second.backupPath)).toBe('cinedrive-20260831T123456Z-1.db');
    expect(path.basename(third.backupPath)).toBe('cinedrive-20260831T123456Z-2.db');
    expect(third.integrity).toEqual({ ok: true, messages: ['ok'] });
    expect(third.removedBackupPaths).toEqual([first.backupPath]);
    await expect(fs.access(first.backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(second.backupPath)).resolves.toBeUndefined();
    await expect(fs.access(third.backupPath)).resolves.toBeUndefined();
  });

  it('verifies a backup before dry-run and applied restores', async () => {
    const backup = await createDatabaseBackup({ databaseUrl: `file:${databasePath}` });
    const changed = createPrismaClient(`file:${databasePath}`);
    try {
      await changed.$executeRawUnsafe('UPDATE "Probe" SET "value" = ? WHERE "id" = 1', 'two');
    } finally {
      await changed.$disconnect();
    }

    const dryRun = await restoreDatabaseBackup({
      databaseUrl: `file:${databasePath}`,
      backupPath: backup.backupPath,
    });
    expect(dryRun.applied).toBe(false);

    const afterDryRun = createPrismaClient(`file:${databasePath}`);
    try {
      const rows = await afterDryRun.$queryRawUnsafe<Array<{ value: string }>>(
        'SELECT "value" FROM "Probe" WHERE "id" = 1',
      );
      expect(rows[0]?.value).toBe('two');
    } finally {
      await afterDryRun.$disconnect();
    }

    const restored = await restoreDatabaseBackup({
      databaseUrl: `file:${databasePath}`,
      backupPath: backup.backupPath,
      apply: true,
    });
    expect(restored.applied).toBe(true);
    expect(restored.preRestoreBackupPath).toBeTruthy();
    expect(await verifySqliteDatabase(restored.preRestoreBackupPath!)).toEqual({
      ok: true,
      messages: ['ok'],
    });

    const afterRestore = createPrismaClient(`file:${databasePath}`);
    try {
      const rows = await afterRestore.$queryRawUnsafe<Array<{ value: string }>>(
        'SELECT "value" FROM "Probe" WHERE "id" = 1',
      );
      expect(rows[0]?.value).toBe('one');
    } finally {
      await afterRestore.$disconnect();
    }
  });

  it('rejects unsupported databases and invalid retention values', async () => {
    expect(() => resolveSqliteDatabasePath('postgresql://example.test/cinedrive')).toThrow(
      'file-based SQLite',
    );
    await expect(
      createDatabaseBackup({ databaseUrl: `file:${databasePath}`, retentionCount: 0 }),
    ).rejects.toThrow('positive integer');
  });
});
