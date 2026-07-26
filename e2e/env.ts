import path from 'node:path';

// Playwright transpiles this to CommonJS, so `import.meta` is unavailable. It
// always loads the config from the repository root, which is therefore cwd.
const repoRoot = process.cwd();

/**
 * A self-contained environment for the end-to-end run: its own ports, its own
 * database and its own admin account, so a suite can start beside the servers a
 * developer already has running and never touch their data.
 */
export const E2E_API_PORT = 3100;
export const E2E_WEB_PORT = 5273;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_WEB_PORT}`;

export const E2E_ADMIN_EMAIL = 'e2e@cinedrive.test';
/** Only ever valid against the throwaway database created below. */
export const E2E_ADMIN_PASSWORD = 'e2e-smoke-test-password';

export const serverRoot = path.join(repoRoot, 'apps/server');
/** Passed explicitly so the CLI does not depend on the working directory. */
export const schemaPath = path.join(serverRoot, 'prisma/schema.prisma');
export const e2eDatabasePath = path.join(serverRoot, 'prisma/data/e2e.db');
export const e2eMediaRoot = path.join(serverRoot, 'prisma/data/e2e-media');
/**
 * Absolute on purpose. Prisma resolves a relative `file:` URL against the
 * schema directory rather than the working directory, so the CLI and the server
 * would otherwise create two different databases — which is how the development
 * database ended up nested at `prisma/prisma/data/app.db`.
 */
export const E2E_DATABASE_URL = `file:${e2eDatabasePath}`;

/** Environment shared by the API server, the seed step and Prisma. */
export const e2eServerEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: E2E_DATABASE_URL,
  PORT: String(E2E_API_PORT),
  ADMIN_EMAIL: E2E_ADMIN_EMAIL,
  ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
  SESSION_SECRET: 'e2e-session-secret-not-used-outside-tests',
  TOKEN_ENCRYPTION_KEY: '0'.repeat(64),
  CORS_ORIGIN: E2E_BASE_URL,
  LOG_LEVEL: 'warn',
  // Keep the suite off the network: metadata lookups would otherwise call TMDB.
  TMDB_API_KEY: '',
  // envSchema requires these. The suite never reaches Google — the fixture
  // library is local — but the server refuses to start without them, and CI
  // has no repository .env to fall back on.
  GOOGLE_CLIENT_ID: 'e2e-google-client-id',
  GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret',
  GOOGLE_REDIRECT_URI: `http://127.0.0.1:${E2E_API_PORT}/api/auth/google/callback`,
  APP_URL: E2E_BASE_URL,
  API_URL: `http://127.0.0.1:${E2E_API_PORT}`,
  PUBLIC_URL: E2E_BASE_URL,
} satisfies Record<string, string>;
