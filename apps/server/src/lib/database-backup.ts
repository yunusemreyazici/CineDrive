import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPrismaClient } from './prisma-client.js';
import { toSqliteAdapterInput } from '../config/database-url.js';

const BACKUP_FILENAME_PATTERN = /^cinedrive-(\d{8}T\d{6}Z)(?:-(\d+))?\.db$/;
const SQLITE_SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm'] as const;

export interface DatabaseIntegrityResult {
  ok: boolean;
  messages: string[];
}

export interface CreateDatabaseBackupOptions {
  databaseUrl: string;
  destinationDirectory?: string;
  retentionCount?: number;
  baseDirectory?: string;
  now?: Date;
}

export interface DatabaseBackupResult {
  backupPath: string;
  bytes: number;
  integrity: DatabaseIntegrityResult;
  removedBackupPaths: string[];
}

export interface RestoreDatabaseBackupOptions {
  databaseUrl: string;
  backupPath: string;
  apply?: boolean;
  baseDirectory?: string;
}

export interface DatabaseRestoreResult {
  applied: boolean;
  targetPath: string;
  backupPath: string;
  preRestoreBackupPath?: string;
  integrity: DatabaseIntegrityResult;
}

const assertRetentionCount = (retentionCount: number): void => {
  if (!Number.isSafeInteger(retentionCount) || retentionCount < 1) {
    throw new Error('Backup retention count must be a positive integer.');
  }
};

const sqliteStringLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const backupTimestamp = (now: Date): string =>
  now
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');

export const resolveSqliteDatabasePath = (
  databaseUrl: string,
  baseDirectory = process.cwd(),
): string => {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('Database backup is supported only for file-based SQLite URLs.');
  }

  const configuredPath = toSqliteAdapterInput(databaseUrl).url;
  if (!configuredPath || configuredPath === ':memory:') {
    throw new Error('An in-memory SQLite database cannot be backed up.');
  }

  return path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(baseDirectory, configuredPath);
};

const nextAvailableBackupPath = async (directory: string, timestamp: string): Promise<string> => {
  let suffix = 0;
  while (true) {
    const filename = `cinedrive-${timestamp}${suffix === 0 ? '' : `-${suffix}`}.db`;
    const candidate = path.join(directory, filename);
    try {
      await fs.access(candidate);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
};

const removeSqliteSidecars = async (databasePath: string): Promise<void> => {
  await Promise.all(
    SQLITE_SIDECAR_SUFFIXES.map((suffix) => fs.rm(`${databasePath}${suffix}`, { force: true })),
  );
};

export const verifySqliteDatabase = async (
  databasePath: string,
): Promise<DatabaseIntegrityResult> => {
  const absolutePath = path.resolve(databasePath);
  const source = await fs.stat(absolutePath);
  if (!source.isFile()) throw new Error(`SQLite database is not a file: ${absolutePath}`);

  const prisma = createPrismaClient(`file:${absolutePath}`);
  try {
    const rows =
      await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('PRAGMA integrity_check');
    const messages = rows.flatMap((row) =>
      Object.values(row).filter((value): value is string => typeof value === 'string'),
    );
    return {
      ok: messages.length === 1 && messages[0]?.toLowerCase() === 'ok',
      messages,
    };
  } finally {
    await prisma.$disconnect();
  }
};

const pruneBackups = async (directory: string, retentionCount: number): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const backupPaths = entries
    .flatMap((entry) => {
      if (!entry.isFile()) return [];
      const match = BACKUP_FILENAME_PATTERN.exec(entry.name);
      if (!match?.[1]) return [];
      return [
        {
          path: path.join(directory, entry.name),
          timestamp: match[1],
          collisionIndex: Number(match[2] ?? 0),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.timestamp.localeCompare(left.timestamp) || right.collisionIndex - left.collisionIndex,
    )
    .map((entry) => entry.path);
  const removedBackupPaths = backupPaths.slice(retentionCount);
  await Promise.all(removedBackupPaths.map((backupPath) => fs.rm(backupPath, { force: true })));
  return removedBackupPaths;
};

export const createDatabaseBackup = async (
  options: CreateDatabaseBackupOptions,
): Promise<DatabaseBackupResult> => {
  const retentionCount = options.retentionCount ?? 14;
  assertRetentionCount(retentionCount);

  const sourcePath = resolveSqliteDatabasePath(options.databaseUrl, options.baseDirectory);
  const source = await fs.stat(sourcePath);
  if (!source.isFile()) throw new Error(`SQLite database is not a file: ${sourcePath}`);

  const destinationDirectory = path.resolve(
    options.destinationDirectory ?? path.join(path.dirname(sourcePath), 'backups'),
  );
  await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o750 });

  const backupPath = await nextAvailableBackupPath(
    destinationDirectory,
    backupTimestamp(options.now ?? new Date()),
  );
  const temporaryPath = path.join(
    destinationDirectory,
    `.cinedrive-backup-${process.pid}-${randomUUID()}.partial`,
  );

  const prisma = createPrismaClient(`file:${sourcePath}`);
  try {
    // VACUUM INTO asks SQLite itself for a consistent snapshot, including data
    // that may currently reside in WAL, instead of copying database files.
    await prisma.$executeRawUnsafe(`VACUUM INTO ${sqliteStringLiteral(temporaryPath)}`);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  try {
    const integrity = await verifySqliteDatabase(temporaryPath);
    if (!integrity.ok) {
      throw new Error(`Backup integrity check failed: ${integrity.messages.join('; ')}`);
    }

    await fs.chmod(temporaryPath, 0o640);
    await fs.rename(temporaryPath, backupPath);
    const { size: bytes } = await fs.stat(backupPath);
    const removedBackupPaths = await pruneBackups(destinationDirectory, retentionCount);
    return { backupPath, bytes, integrity, removedBackupPaths };
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
};

export const restoreDatabaseBackup = async (
  options: RestoreDatabaseBackupOptions,
): Promise<DatabaseRestoreResult> => {
  const targetPath = resolveSqliteDatabasePath(options.databaseUrl, options.baseDirectory);
  const backupPath = path.resolve(options.backupPath);
  if (backupPath === targetPath) throw new Error('Backup and target database paths must differ.');

  const integrity = await verifySqliteDatabase(backupPath);
  if (!integrity.ok) {
    throw new Error(`Backup integrity check failed: ${integrity.messages.join('; ')}`);
  }

  if (!options.apply) {
    return { applied: false, targetPath, backupPath, integrity };
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  let preRestoreBackupPath: string | undefined;
  try {
    const target = await fs.stat(targetPath);
    if (target.isFile()) {
      const preRestore = await createDatabaseBackup({
        databaseUrl: `file:${targetPath}`,
        // Never let pre-restore housekeeping delete the selected restore
        // point. The next scheduled backup will apply the normal retention.
        retentionCount: Number.MAX_SAFE_INTEGER,
      });
      preRestoreBackupPath = preRestore.backupPath;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }

  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.cinedrive-restore-${process.pid}-${randomUUID()}.partial`,
  );
  try {
    await fs.copyFile(backupPath, temporaryPath);
    const copiedIntegrity = await verifySqliteDatabase(temporaryPath);
    if (!copiedIntegrity.ok) {
      throw new Error(
        `Copied backup integrity check failed: ${copiedIntegrity.messages.join('; ')}`,
      );
    }

    await fs.chmod(temporaryPath, 0o640);
    await removeSqliteSidecars(targetPath);
    await fs.rename(temporaryPath, targetPath);
    await removeSqliteSidecars(targetPath);

    const restoredIntegrity = await verifySqliteDatabase(targetPath);
    if (!restoredIntegrity.ok) {
      throw new Error(
        `Restored database integrity check failed: ${restoredIntegrity.messages.join('; ')}`,
      );
    }

    return {
      applied: true,
      targetPath,
      backupPath,
      ...(preRestoreBackupPath ? { preRestoreBackupPath } : {}),
      integrity: restoredIntegrity,
    };
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
};
