import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

for (const width of [390, 1440]) {
  test(`catalogue presentation persists across routes and reload at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/login');
    await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/library');
    const size = page.getByLabel(tr.catalogueLayout.posterSize);
    await size.selectOption('small');
    const first = page.getByRole('link', { name: tr.mediaCard.openDetails('Smoke Test Movie') });
    await expect(first).toBeVisible();
    const small = await first.boundingBox();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('small-posters.png') });
    await size.selectOption('large');
    await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(small!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: tr.library.listView, exact: true }).click();
    await expect(size).toBeDisabled();
    for (const route of ['/movies', '/series', '/library']) {
      await page.goto(route);
      await expect(
        page.getByRole('button', { name: tr.library.listView, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(size).toHaveValue('large');
      await expect(page.getByText(tr.errors.boundaryTitle, { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await page.reload();
    await expect(
      page.getByRole('button', { name: tr.library.listView, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: tr.library.gridView, exact: true }).click();
    await expect(page.locator('.cd-catalogue-large')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });
}
