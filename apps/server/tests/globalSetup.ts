import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

const TEST_DATABASE_URL = 'file:./prisma/data/test.db';
const testDbPath = path.resolve(serverRoot, 'prisma/data/test.db');

/** SQLite writes these alongside the database in WAL mode. */
const sidecarSuffixes = ['', '-journal', '-wal', '-shm'];

const removeTestDatabase = () => {
  for (const suffix of sidecarSuffixes) {
    fs.rmSync(`${testDbPath}${suffix}`, { force: true });
  }
};

/**
 * Builds a fresh schema in a disposable database before the suite runs.
 *
 * Without this the tests ran against the development database and their
 * `library.deleteMany()` cleanup cascaded real media rows away.
 */
export const setup = () => {
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
  removeTestDatabase();

  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'inherit',
    },
  );
};

export const teardown = () => {
  removeTestDatabase();
};
