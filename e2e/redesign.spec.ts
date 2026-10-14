import { test, expect, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
  await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function fitsViewport(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}

// Real isolated fixture API; no production accounts, providers or artwork requests.
for (const width of [1440, 1024, 390]) {
  test(`redesigned routes fit a ${width}px viewport`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: tr.design.signInTitle })).toBeVisible();
    await fitsViewport(page);
    await page.screenshot({ path: testInfo.outputPath('login.png') });
    await signIn(page);
    const routes = [
      '/',
      '/library',
      '/movies',
      '/series',
      '/media/e2e_series_smoke',
      '/favorites',
      '/history',
      '/person/Fixture',
      '/music',
      '/music/mixes',
      '/music/albums',
      '/music/albums/00000000-0000-4000-8000-000000000104',
      '/music/artists',
      '/music/artists/00000000-0000-4000-8000-000000000103',
      '/music/tracks',
      '/music/tracks/00000000-0000-4000-8000-000000000105',
      '/music/liked',
      '/music/history',
      '/music/replay',
      '/music/maintenance',
      '/settings',
      '/settings?tab=appearance',
      '/settings?tab=libraries',
      '/settings?tab=manage',
      '/settings?tab=storage',
      '/settings?tab=api',
      '/settings?tab=about',
      '/setup',
      '/missing-page',
    ];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const [index, route] of routes.entries()) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.getByText(tr.errors.boundaryTitle, { exact: true })).toHaveCount(0);
      await fitsViewport(page);
      await page.screenshot({
        path: testInfo.outputPath(`${index}-${route.replace(/[^a-z0-9]/gi, '-')}.png`),
      });
    }
    expect(errors).toEqual([]);
  });
}

test('mobile drawers, search, theme and keyboard navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole('button', { name: tr.nav.toggleMenu }).click();
  const mainNav = page.getByRole('navigation', { name: tr.nav.mainNavigation });
  await expect(mainNav).toBeVisible();
  await mainNav.getByRole('link', { name: tr.nav.music, exact: true }).click();
  await page.getByRole('button', { name: tr.music.musicNavigation }).click();
  await page
    .getByRole('navigation', { name: tr.music.musicLibrary })
    .getByRole('link', { name: tr.music.albums })
    .click();
  await expect(page.getByRole('heading', { name: tr.music.albums, exact: true })).toBeVisible();
  await page.goto('/settings?tab=appearance');
  await page
    .getByRole('radio', { name: new RegExp(tr.settings.appearance.themes.neon.name) })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon');
  await page.getByRole('button', { name: tr.nav.openSearch }).click();
  const search = page.getByRole('combobox', { name: tr.search.dialogLabel });
  await search.fill('Smoke');
  await expect(page.getByRole('option').first()).toBeVisible();
  await search.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: tr.design.skipToContent })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('collection failures can retry and AI planning remains an explicit action', async ({
  page,
}, testInfo) => {
  let failAlbums = true;
  await page.route('**/api/music/albums?*', async (route) => {
    if (failAlbums)
      await route.fulfill({ status: 503, json: { error: { message: 'Fixture unavailable' } } });
    else await route.continue();
  });
  await signIn(page);
  await page.goto('/music/albums');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText(tr.music.emptyTitle, { exact: true })).toHaveCount(0);
  failAlbums = false;
  await page.getByRole('button', { name: tr.common.retry }).click();
  await expect(page.getByRole('link', { name: /Fixture Album/ })).toBeVisible();
  let plannerRequests = 0;
  await page.route('**/api/music/discovery/ai/status', (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  await page.route('**/api/music/discovery/ai', (route) => {
    plannerRequests += 1;
    return route.fulfill({ status: 503, json: { error: { message: 'Fixture unavailable' } } });
  });
  await page.goto('/music/mixes');
  const prompt = page.getByLabel(tr.music.aiPlaylistPromptLabel, { exact: true });
  await expect(prompt).toBeVisible();
  await prompt.fill('Gece sürüşü için rock');
  expect(plannerRequests).toBe(0);
  await prompt.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('ai-planning.png') });
  await page.getByRole('button', { name: tr.music.aiPlaylistCreate, exact: true }).click();
  await expect.poll(() => plannerRequests).toBe(1);
  await expect(
    page.getByRole('button', { name: tr.music.aiPlaylistCreate, exact: true }),
  ).toBeEnabled();
});

test('mobile player, lyrics and queue remain reachable without overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/music');
  await page.getByRole('button', { name: tr.music.playTrack('Smoke Test Song') }).click();
  const dock = page.locator('.cd-player-dock');
  await expect(dock).toBeVisible();
  await fitsViewport(page);
  const box = await dock.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('mobile-player.png') });
  await dock.getByRole('button', { name: tr.music.openNowPlaying }).click();
  const nowPlaying = page.getByRole('dialog', { name: tr.music.nowPlaying });
  await expect(nowPlaying).toBeVisible();
  await fitsViewport(page);
  await page.screenshot({ path: testInfo.outputPath('mobile-now-playing.png') });
  await nowPlaying.getByRole('button', { name: tr.common.close, exact: true }).click();
  await dock.getByRole('button', { name: tr.music.lyrics, exact: true }).click();
  await expect(page.getByRole('complementary', { name: tr.music.lyrics })).toBeVisible();
  await expect(page.getByText('Smoke test opening line')).toBeVisible();
  await fitsViewport(page);
  await page.getByRole('button', { name: tr.common.close, exact: true }).click();
  await dock.getByRole('button', { name: tr.music.queue, exact: true }).click();
  await expect(page.getByRole('button', { name: tr.music.saveQueueAsPlaylist })).toBeVisible();
  await fitsViewport(page);
});
