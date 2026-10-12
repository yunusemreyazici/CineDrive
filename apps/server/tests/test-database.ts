import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const serverRoot = path.resolve(__dirname, '..');
// Prisma's native SQLite schema engine can be denied writes inside macOS
// protected Downloads folders even when Node itself can edit the workspace.
// A disposable OS temp database also keeps test I/O out of the repository.
export const createTestDatabase = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cinedrive-vitest-'));
  const databasePath = path.join(directory, 'test.db');
  return { databasePath, databaseUrl: `file:${databasePath}` };
};

/**
 * Absolute on purpose. Prisma resolves relative `file:` URLs against the
 * schema directory; the app and global setup must instead share one exact
 * disposable path.
 *
 * The config allocates this once per invocation and passes the exact URL to
 * global setup and workers through the project's test environment.
 */
export const resolveTestDatabasePath = (databaseUrl: string | undefined) => {
  if (!databaseUrl?.startsWith('file:')) throw new Error('INVALID_TEST_DATABASE');
  const databasePath = databaseUrl.slice(5);
  const directory = path.dirname(databasePath);
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const canonicalDirectory = fs.realpathSync(directory);
  if (
    !path.isAbsolute(databasePath) ||
    path.basename(databasePath) !== 'test.db' ||
    path.dirname(canonicalDirectory) !== temporaryRoot ||
    !path.basename(directory).startsWith('cinedrive-vitest-') ||
    fs.lstatSync(directory).isSymbolicLink()
  )
    throw new Error('INVALID_TEST_DATABASE');
  return databasePath;
};
