import { expect, test } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_BASE_URL } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

for (const width of [1440, 390]) {
  test(`playlist search preserves saved entries at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/login');
    await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
    await expect(page.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
    const created = await page.request.post('/api/music/playlists/from-tracks', {
      headers: { origin: E2E_BASE_URL },
      data: {
        name: `Search QA ${testInfo.project.name} ${width}`,
        trackIds: ['00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000105'],
      },
    });
    expect(created.status()).toBe(201);
    const { playlist } = (await created.json()) as { playlist: { id: string; name: string } };
    const endpoint = `/api/music/playlists/${playlist.id}`;
    try {
      const before = await (await page.request.get(endpoint)).json();
      await page.goto(`/music/playlists/${playlist.id}`);
      await expect(page.getByRole('heading', { name: playlist.name })).toBeVisible();
      const search = page.getByRole('searchbox', { name: tr.music.playlistSearch });
      await expect(page.locator('.cd-track-row[draggable="true"]')).toHaveCount(2);
      await search.fill('missing song');
      await expect(page.getByRole('heading', { name: tr.music.playlistNoMatches })).toBeVisible();
      await expect(
        page.getByRole('button', { name: tr.music.playlistPlayMatches(0) }),
      ).toBeDisabled();
      await search.fill('fixture smoke');
      await expect(page.getByText(tr.music.playlistMatches(2, 2))).toBeVisible();
      await expect(page.locator('.cd-track-row[draggable="true"]')).toHaveCount(0);
      const after = await (await page.request.get(endpoint)).json();
      expect(after.playlist.items).toEqual(before.playlist.items);
      await page.getByRole('button', { name: tr.music.playlistPlayMatches(2) }).click();
      await expect(page.getByRole('button', { name: tr.music.pause, exact: true })).toBeVisible();
      await page.getByRole('button', { name: tr.music.pause, exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath('playlist-search.png') });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.getByRole('button', { name: tr.music.playlistClearSearch }).click();
      await expect(page.locator('.cd-track-row[draggable="true"]')).toHaveCount(2);
      // A transient detail failure is a recoverable error, not an infinite skeleton.
      await page.route(`**${endpoint}`, (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'UNAVAILABLE', message: 'Temporarily unavailable' },
          }),
        }),
      );
      await page.reload();
      await expect(page.getByRole('alert')).toBeVisible();
      await page.unroute(`**${endpoint}`);
      await page.getByRole('button', { name: tr.common.retry, exact: true }).click();
      await expect(page.getByRole('heading', { name: playlist.name })).toBeVisible();
    } finally {
      await page.request.delete(endpoint, { headers: { origin: E2E_BASE_URL } });
    }
  });
}
