import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const serverRoot = path.resolve(__dirname, '..');
// Prisma's native SQLite schema engine can be denied writes inside macOS
// protected Downloads folders even when Node itself can edit the workspace.
// A disposable OS temp database also keeps test I/O out of the repository.
export const testDbPath = '/tmp/cinedrive-vitest.db';

/**
 * Absolute on purpose. Prisma resolves relative `file:` URLs against the
 * schema directory; the app and global setup must instead share one exact
 * disposable path.
 *
 * The setup and the app under test must agree on this exact value, which is
 * why both `vitest.config.ts` and `globalSetup.ts` read it from here.
 */
export const TEST_DATABASE_URL = `file:${testDbPath}`;
