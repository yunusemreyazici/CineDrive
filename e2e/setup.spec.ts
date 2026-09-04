import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';
import { copy as c } from '../apps/web/src/pages/setup/copy.js';

test('optional setup validates a folder, saves once, scans and resumes after reload', async ({
  page,
}) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cinedrive-e2e-setup-'));
  let libraryId: string | null = null;
  try {
    await page.goto('/login');
    await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: tr.auth.signIn }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: c.title })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('setup-source.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: c.next }).click();
    await page.getByLabel(c.name).fill('Setup smoke library');
    await page.getByLabel(c.path).fill(path.join(directory, 'missing'));
    await page.getByRole('button', { name: c.verify }).click();
    await expect(page.getByRole('alert')).toContainText(c.accessError);
    await page.getByLabel(c.path).fill(directory);
    await page.getByRole('button', { name: c.verify }).click();
    await expect(page.getByText(c.verified, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: test.info().outputPath('setup-review-mobile.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: c.create }).click();
    await expect(page).toHaveURL(/\/setup\?library=/);
    libraryId = new URL(page.url()).searchParams.get('library');
    await expect(page.getByText(c.waiting, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: c.start }).click();
    await expect(page.getByText(c.completed, { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(c.empty)).toBeVisible();
    await page.reload();
    await expect(page.getByText(c.completed, { exact: true })).toBeVisible();
    const response = await page.request.get('/api/libraries');
    const { libraries } = await response.json();
    expect(
      libraries.filter(
        (library: { localFolderPath: string }) => library.localFolderPath === directory,
      ),
    ).toHaveLength(1);
  } finally {
    if (libraryId)
      expect((await page.request.delete(`/api/libraries/${libraryId}`)).ok()).toBeTruthy();
    await rm(directory, { recursive: true, force: true });
  }
});
