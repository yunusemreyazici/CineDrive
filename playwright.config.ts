import { defineConfig, devices } from '@playwright/test';
import { E2E_API_PORT, E2E_BASE_URL, E2E_WEB_PORT, e2eServerEnv } from './e2e/env.js';

/**
 * System-level smoke coverage: the unit and integration suites verify pieces,
 * this drives a real browser through the paths a user actually takes.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: [
    {
      // Keep one process for Playwright to terminate. Seeding happens inside
      // this entry point before the API starts, against a disposable database.
      command: 'node --import tsx e2e/start-server.ts',
      port: E2E_API_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      env: e2eServerEnv,
    },
    {
      command: 'node apps/web/node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts',
      port: E2E_WEB_PORT,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      env: {
        WEB_PORT: String(E2E_WEB_PORT),
        API_PROXY_TARGET: `http://127.0.0.1:${E2E_API_PORT}`,
      },
    },
  ],
});
