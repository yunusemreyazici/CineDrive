import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TEST_DATABASE_URL, serverRoot, testDbPath } from './test-database.js';

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

  execFileSync('npx', ['prisma', 'db', 'push'], {
    cwd: serverRoot,
    // Prisma's schema engine needs its debug path enabled inside the sandboxed
    // macOS app. Scope this workaround to the disposable test database.
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, RUST_LOG: 'debug' },
    stdio: 'inherit',
  });
};

export const teardown = () => {
  removeTestDatabase();
};
