import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

for (const width of [390, 1440]) {
  test(`recent detail shortcuts persist without playback side effects at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/login');
    await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/playback') && request.method() !== 'GET')
        writes.push(request.method());
    });
    for (const [id, title] of [
      ['e2e_movie_smoke', 'Smoke Test Movie'],
      ['e2e_series_smoke', 'Smoke Test Series'],
    ]) {
      await page.goto(`/media/${id}`);
      await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
    }
    await page.goto('/');
    const region = page.getByRole('region', { name: tr.recentBrowse.title });
    await expect(region.getByRole('link')).toHaveCount(2);
    await expect(region.getByRole('link').first()).toContainText('Smoke Test Series');
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('recently-browsed.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.reload();
    await expect(region.getByRole('link')).toHaveCount(2);
    await region.getByRole('link', { name: /Smoke Test Movie/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Smoke Test Movie', exact: true, level: 1 }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.goto('/');
    await expect(region.getByRole('link').first()).toContainText('Smoke Test Movie');
    await region.getByRole('button', { name: tr.recentBrowse.remove('Smoke Test Series') }).click();
    await expect(region.getByRole('link')).toHaveCount(1);
    await region.getByRole('button', { name: tr.recentBrowse.clear }).click();
    await expect(region).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
    await expect(region).toHaveCount(0);
    expect(writes).toEqual([]);
    await page.waitForLoadState('networkidle');
  });
}
