import { test, expect, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
  await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
  await expect(page.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`music sleep timer pauses local audio and preserves the queue at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await signIn(page);
    await page.clock.install();
    await page.goto('/music');
    await page.getByRole('button', { name: tr.music.playTrack('Smoke Test Song') }).click();
    await page.getByRole('button', { name: tr.music.openNowPlaying }).click();
    const nowPlaying = page.getByRole('dialog', { name: tr.music.nowPlaying, exact: true });
    // Keep the four-second fixture playing via the actual repeat control, so
    // expiry must stop active audio instead of an already-ended clip.
    const repeat = nowPlaying.getByRole('button', { name: tr.music.repeat, exact: true });
    for (
      let attempt = 0;
      attempt < 3 && !(await repeat.locator('.lucide-repeat-1').isVisible());
      attempt++
    ) {
      await repeat.click();
    }
    await expect(repeat.locator('.lucide-repeat-1')).toBeVisible();
    const play = nowPlaying.getByRole('button', { name: tr.music.play, exact: true });
    if (await play.isVisible()) await play.click();
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluateAll((elements) =>
            elements.some((element) => !element.paused && element.readyState >= 2),
          ),
      )
      .toBe(true);
    await nowPlaying.getByRole('button', { name: tr.music.sleepTimer, exact: true }).click();
    const timer = page.getByRole('dialog', { name: tr.music.sleepTimer, exact: true });
    await timer.getByRole('button', { name: tr.common.minutes(15), exact: true }).click();
    await expect(timer).toBeHidden();
    const activeTimer = nowPlaying.getByRole('button', {
      name: new RegExp(tr.music.sleepTimerUntil('.*')),
    });
    await expect(activeTimer).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sleep-timer.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluateAll((elements) => elements.some((element) => !element.paused)),
      )
      .toBe(true);
    await page.clock.fastForward(15 * 60_000 + 1);
    await expect(
      nowPlaying.getByRole('button', { name: tr.music.play, exact: true }),
    ).toBeVisible();
    await expect(
      nowPlaying.getByRole('button', { name: tr.music.sleepTimer, exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('audio')
          .evaluateAll((elements) => elements.every((element) => element.paused)),
      )
      .toBe(true);
    await expect(
      nowPlaying.getByRole('heading', { name: 'Smoke Test Song', exact: true }),
    ).toBeVisible();
    await repeat.click();
    await nowPlaying.getByRole('button', { name: tr.common.close, exact: true }).click();
    await page.getByRole('button', { name: tr.music.queue, exact: true }).click();
    await expect(page.getByRole('button', { name: tr.music.saveQueueAsPlaylist })).toBeVisible();
    await expect(page.getByText('Smoke Test Song').first()).toBeVisible();
    await page.getByRole('button', { name: tr.common.close, exact: true }).click();
    await page.goto('/music/albums/00000000-0000-4000-8000-000000000104');
    await expect(
      page.getByRole('button', { name: tr.music.copyMusicLink, exact: true }),
    ).toBeVisible();
    await page.goto('/music/tracks/00000000-0000-4000-8000-000000000105');
    await expect(
      page.getByRole('button', { name: tr.music.copyMusicLink, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(tr.errors.boundaryTitle, { exact: true })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
  });
}
