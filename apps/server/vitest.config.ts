import { defineConfig } from 'vitest/config';
import { createTestDatabase } from './tests/test-database.js';

// Created once per invocation; global setup reads this same resolved env value,
// rather than independently deriving a filename in another process.
const { databaseUrl } = createTestDatabase();

export default defineConfig({
  test: {
    // Tests build the real Fastify app, which reads DATABASE_URL through
    // config/env.ts. Pointing it at a throwaway file keeps the suite from
    // writing into — and deleting rows from — the development database.
    //
    // dotenv does not overwrite variables that are already set, so these win
    // over the repository .env that env.ts loads.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
    },
    globalSetup: './tests/globalSetup.ts',
    // Every test file talks to the same SQLite file and clears rows in its
    // own beforeEach, so they must not overlap.
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
