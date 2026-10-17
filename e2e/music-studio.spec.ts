import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

for (const width of [1440, 390]) {
  test(`Studio workshop, history and quality at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/login');
    await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
    await expect(page.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
    await page.goto('/music/studio');
    const name = `Studio ${testInfo.project.name} ${width}`;
    await page.getByLabel(tr.studio.name, { exact: true }).fill(name);
    await page.getByRole('button', { name: tr.studio.create, exact: true }).click();
    await page.getByRole('button', { name: `${name} · ${tr.studio.owner}`, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    for (let count = 1; count <= 2; count++) {
      await page.getByLabel(tr.studio.search, { exact: true }).fill('Smoke');
      await page.getByRole('button', { name: tr.studio.add, exact: true }).click();
      await expect(page.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(count);
    }
    await page.getByRole('button', { name: tr.studio.duplicates, exact: true }).click();
    await expect(page.getByText(tr.studio.selected(1), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: tr.studio.remove, exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(1);
    await page.getByRole('button', { name: tr.studio.details, exact: true }).first().click();
    await expect(page.getByText(/− Smoke Test Song/)).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: tr.studio.restore, exact: true }).first().click();
    await expect(page.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('studio-workshop.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: tr.studio.profile, exact: true }).click();
    await expect(page.getByRole('heading', { name: tr.studio.family, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: tr.studio.saveSession })).toBeDisabled();
    await page.getByRole('button', { name: tr.studio.health, exact: true }).click();
    await expect(page.getByRole('heading', { name: tr.studio.jobs, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: tr.studio.worker, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('studio-health.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    // Read-only health inspection must not launch enrichment.
    await expect(page.getByRole('button', { name: tr.studio.pilot, exact: true })).toBeEnabled();
  });
}
