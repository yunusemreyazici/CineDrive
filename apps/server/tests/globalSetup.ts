import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { resolveTestDatabasePath, serverRoot } from './test-database.js';

/** SQLite writes these alongside the database in WAL mode. */
const sidecarSuffixes = ['', '-journal', '-wal', '-shm'];

const removeTestDatabase = (testDbPath: string) => {
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
export default function setup(project: TestProject) {
  const databaseUrl = project.config.env.DATABASE_URL;
  const testDbPath = resolveTestDatabasePath(databaseUrl);

  // Exercise the real migration path. `db push` omits the hand-written FTS5
  // virtual table and triggers used by media search.
  const cleanup = () => {
    removeTestDatabase(testDbPath);
    // Only remove this empty invocation-owned directory, never a recursive root.
    fs.rmdirSync(path.dirname(testDbPath));
  };
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: serverRoot,
      // Prisma's schema engine needs its debug path enabled inside the sandboxed
      // macOS app. Scope this workaround to the disposable test database.
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' },
      stdio: 'inherit',
    });
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}
