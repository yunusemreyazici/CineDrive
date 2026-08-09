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

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: serverRoot,
    // Prisma 6's macOS schema engine can exit before opening SQLite when no
    // Rust log filter is present under an app sandbox. The engine currently
    // needs its debug path enabled; Prisma still keeps successful runs quiet.
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, RUST_LOG: 'debug' },
    stdio: 'inherit',
  });
};

export const teardown = () => {
  removeTestDatabase();
};
