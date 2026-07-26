import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const serverRoot = path.resolve(__dirname, '..');
export const testDbPath = path.resolve(serverRoot, 'prisma/data/test.db');

/**
 * Absolute on purpose. Prisma resolves a relative `file:` URL against the
 * *schema* directory rather than the working directory, so the previous
 * `file:./prisma/data/test.db` created `prisma/prisma/data/test.db` while the
 * teardown deleted `prisma/data/test.db`. The throwaway database was never
 * thrown away and accumulated fixture rows across every run.
 *
 * The setup and the app under test must agree on this exact value, which is
 * why both `vitest.config.ts` and `globalSetup.ts` read it from here.
 */
export const TEST_DATABASE_URL = `file:${testDbPath}`;
