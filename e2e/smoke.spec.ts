import { test, expect, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

/**
 * Copy is read from the same dictionary the UI renders from, so a wording
 * change updates the assertions instead of breaking them.
 */
const signIn = async (page: Page) => {
  await page.goto('/login');
  await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
  // Exact: the reveal toggle beside the field is labelled "Parolayı göster",
  // which a substring match would also resolve to.
  await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: tr.auth.signIn }).click();
  await expect(page).toHaveURL(/\/$/);
};

const openMovie = async (page: Page) => {
  await signIn(page);
  // Browser contexts are fresh, but projects/retries share the fixture server.
  // Reset only this test movie via the real API before loading its player.
  const reset = await page.request.delete('/api/playback/e2e_movie_smoke');
  expect(reset.status()).toBe(200);
  const streamResponse = page.waitForResponse(
    (response) => response.url().includes('/stream') && response.status() < 400,
  );
  await page.goto('/watch/e2e_movie_smoke');
  expect([200, 206]).toContain((await streamResponse).status());
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('slider', { name: tr.player.seekLabel })).toBeVisible();

  // Respect autoplay restrictions: a real user gesture starts paused media.
  // DOM evaluation below only observes the media, never sets time or calls play().
  if (await video.evaluate((element: HTMLVideoElement) => element.paused)) {
    await video.click();
  }
};

const expectPlaybackAdvance = async (page: Page) => {
  const video = page.locator('video');
  const startTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(startTime + 1);
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        seeking: element.seeking,
        error: element.error?.code ?? null,
      })),
    )
    .toEqual({ paused: false, seeking: false, error: null });
};

const seekMovie = async (page: Page, seconds: number) => {
  const timeline = page.getByRole('slider', { name: tr.player.seekLabel });
  await page.locator('video').hover();
  const duration = Number(await timeline.getAttribute('aria-valuemax'));
  expect(duration).toBe(90);
  const box = await timeline.boundingBox();
  expect(box).not.toBeNull();
  await timeline.click({ position: { x: (box!.width * seconds) / duration, y: box!.height / 2 } });
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate(
          (element: HTMLVideoElement, target) =>
            !element.seeking &&
            element.currentTime >= target - 1 &&
            element.currentTime < target + 4,
          seconds,
        ),
    )
    .toBe(true);
  await expectPlaybackAdvance(page);
};

test.describe('CineDrive smoke', () => {
  test('signs in and lands on a populated home page', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { name: tr.home.recentlyAdded })).toBeVisible();
    await expect(page.getByText('Smoke Test Movie').first()).toBeVisible();
  });

  test('guards protected routes when signed out', async ({ page }) => {
    await page.goto('/library');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('browses the library and filters by search', async ({ page }) => {
    await signIn(page);
    await page.goto('/library');

    await expect(page.getByRole('heading', { name: tr.library.title })).toBeVisible();
    await expect(page.getByText('Smoke Test Movie').first()).toBeVisible();

    // The debounced input must still end up driving the query.
    await page.getByLabel(tr.library.searchLabel).fill('bulunmayan-baslik');
    await expect(page.getByText(tr.library.notFoundTitle)).toBeVisible();
    await expect(page).toHaveURL(/search=bulunmayan-baslik/);
  });

  test('opens a media detail page from a card', async ({ page }) => {
    await signIn(page);
    // Another project may have saved progress; this scenario expects a fresh
    // play action, not the resume button left by a previous browser's test.
    expect((await page.request.delete('/api/playback/e2e_movie_smoke')).status()).toBe(200);
    await page.goto('/library');

    await page.getByRole('link', { name: tr.mediaCard.openDetails('Smoke Test Movie') }).click();

    await expect(page).toHaveURL(/\/media\/e2e_movie_smoke$/);
    await expect(page.getByRole('heading', { name: 'Smoke Test Movie', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: tr.mediaDetail.play, exact: true })).toBeVisible();
  });

  test('plays and advances real media through the streaming endpoint', async ({ page }) => {
    await openMovie(page);
    await expectPlaybackAdvance(page);
  });

  test('seeks forward and backward through the timeline and continues playing', async ({
    page,
  }) => {
    await openMovie(page);
    await expectPlaybackAdvance(page);
    await seekMovie(page, 30);
    await seekMovie(page, 10);
  });

  test('saves a paused position and resumes it after reload', async ({ page }) => {
    await openMovie(page);
    await seekMovie(page, 30);
    const savedResponse = page.waitForResponse((response) => {
      if (
        !response.url().endsWith('/api/playback/progress') ||
        response.request().method() !== 'PUT'
      ) {
        return false;
      }
      const body = response.request().postDataJSON();
      return body.mediaItemId === 'e2e_movie_smoke' && body.positionSeconds > 15;
    });
    await page.locator('video').click();
    await expect
      .poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true);
    const response = await savedResponse;
    expect(response.status()).toBe(200);
    const { progress } = await response.json();
    const savedPosition = progress.positionSeconds as number;
    expect(savedPosition).toBeGreaterThanOrEqual(30);
    expect(savedPosition).toBeLessThan(40);
    expect(progress.completed).toBe(false);
    const storedResponse = await page.request.get('/api/playback/e2e_movie_smoke');
    expect(storedResponse.status()).toBe(200);
    expect((await storedResponse.json()).progress.positionSeconds).toBe(savedPosition);

    await page.reload();
    await expect(page.getByRole('heading', { name: tr.player.resume.title })).toBeVisible();
    await expect
      .poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true);
    // The offered position must be the one saved by the player, not test-seeded state.
    const timestamp = `0:${String(savedPosition).padStart(2, '0')}`;
    await page
      .getByRole('button', { name: tr.player.resume.continueAt(timestamp), exact: true })
      .click();
    await expect(page.getByRole('heading', { name: tr.player.resume.title })).toBeHidden();
    await expect
      .poll(() =>
        page
          .locator('video')
          .evaluate(
            (element: HTMLVideoElement, saved) =>
              element.currentTime >= saved - 1 && element.currentTime < saved + 4,
            savedPosition,
          ),
      )
      .toBe(true);
    await expectPlaybackAdvance(page);
  });

  test('plays tagged music, creates a playlist, and restores the queue after refresh', async ({
    page,
  }, testInfo) => {
    await signIn(page);
    await page.goto('/music');

    await expect(page.getByRole('heading', { name: tr.music.title })).toBeVisible();
    await expect(page.getByText('Fixture Album').first()).toBeVisible();
    await expect(page.getByText('Smoke Test Song').first()).toBeVisible();

    // The spotlight action menu comes first and only contains queue actions;
    // track information lives in the track-row menu below it.
    await page.getByLabel(tr.music.moreActions).last().click();
    await page.getByRole('button', { name: tr.music.trackInfo }).click();
    const trackInfo = page.getByRole('dialog', { name: tr.music.trackInfo });
    await expect(trackInfo).toBeVisible();
    await expect(trackInfo.getByText('Fixture Composer')).toBeVisible();
    await expect(trackInfo.getByText(tr.music.technicalDetails)).toBeVisible();
    await trackInfo.getByRole('button', { name: tr.common.close }).click();

    await page
      .getByRole('link', { name: tr.music.openAlbum('Fixture Album') })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Fixture Album' })).toBeVisible();
    await expect(page.getByText(tr.music.qualitySummary)).toBeVisible();
    await page.goto('/music');

    const streamResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/music/tracks/00000000-0000-4000-8000-000000000105/stream') &&
        response.status() < 400,
    );
    const stateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/music/playback-state') &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: tr.music.playTrack('Smoke Test Song') }).click();
    await expect(page.getByRole('slider', { name: tr.music.seek })).toBeVisible();
    expect([200, 206]).toContain((await streamResponse).status());
    expect((await stateResponse).status()).toBeLessThan(400);

    await page.getByRole('button', { name: tr.music.openNowPlaying }).click();
    await expect(page.getByRole('dialog', { name: tr.music.nowPlaying })).toBeVisible();
    await expect(page.getByText('Smoke Test Song').first()).toBeVisible();
    await expect(page.getByText('AAC · 16-bit · 44.1 kHz')).toBeVisible();
    await page.getByRole('button', { name: tr.music.audioSettings }).click();
    await expect(page.getByRole('dialog', { name: tr.music.audioSettings })).toBeVisible();
    await expect(page.getByText(tr.music.loudnessNormalization)).toBeVisible();
    await expect(page.getByText(tr.music.gaplessPlayback)).toBeVisible();
    await page
      .getByRole('dialog', { name: tr.music.audioSettings })
      .getByRole('button', { name: tr.common.close, exact: true })
      .click();
    await page
      .getByRole('dialog', { name: tr.music.nowPlaying })
      .getByRole('button', { name: tr.common.close, exact: true })
      .click();

    await page.getByRole('button', { name: tr.music.lyrics }).click();
    await expect(page.getByRole('complementary', { name: tr.music.lyrics })).toBeVisible();
    await expect(page.getByText('Smoke test opening line')).toBeVisible();
    await page.getByRole('button', { name: tr.music.lyricsModes.translation }).click();
    await expect(page.getByText('Opening translation')).toBeVisible();
    await page.getByRole('button', { name: tr.music.editLyrics }).click();
    await expect(page.getByRole('dialog', { name: tr.music.lyricsEditor })).toBeVisible();
    await page
      .getByRole('dialog', { name: tr.music.lyricsEditor })
      .getByRole('button', { name: tr.common.close })
      .click();
    await page.getByRole('button', { name: tr.common.close, exact: true }).click();

    await page.getByRole('button', { name: tr.music.createPlaylist }).click();
    const createPlaylistDialog = page.getByRole('dialog', { name: tr.music.createPlaylist });
    const playlistName = `E2E Playlist ${testInfo.project.name} ${testInfo.retry}`;
    await createPlaylistDialog.getByPlaceholder(tr.music.newPlaylist).fill(playlistName);
    const playlistResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/music/playlists') && response.request().method() === 'POST',
    );
    await createPlaylistDialog.getByRole('button', { name: tr.music.create }).click();
    expect((await playlistResponse).status()).toBeLessThan(400);
    // The accessible link name also includes the track count.
    await expect(page.getByRole('link', { name: playlistName }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByText('Smoke Test Song').first()).toBeVisible();
    // Restored state remains paused to comply with browser autoplay policy.
    await expect(page.getByRole('button', { name: tr.music.play }).first()).toBeVisible();
  });

  test('navigates between settings panes', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');

    // One destination per pane now: the profile opens first and Google Drive
    // lives in the consolidated library-management pane.
    await expect(page.getByRole('heading', { name: tr.settings.profile.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: tr.settings.google.title })).toHaveCount(0);

    await page
      .getByRole('button', { name: tr.settings.search.librarySources.label, exact: true })
      .click();
    await expect(page).toHaveURL(/tab=libraries/);
    await expect(page.getByRole('heading', { name: tr.settings.google.title })).toBeVisible();

    await page.getByRole('button', { name: tr.settings.search.storage.label, exact: true }).click();
    await expect(page).toHaveURL(/tab=storage/);
    await expect(page.getByRole('heading', { name: tr.mediaHealth.analysisSummary })).toBeVisible();
  });

  test('keeps old ?tab=general links working', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings?tab=general');

    await expect(page.getByRole('heading', { name: tr.settings.profile.title })).toBeVisible();
  });

  test('shows the not found page for an unknown route', async ({ page }) => {
    await signIn(page);
    await page.goto('/boyle-bir-sayfa-yok');

    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByRole('heading', { name: tr.notFound.heading })).toBeVisible();
    // The shell stays mounted so the user can navigate away.
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('keeps focus inside an open dialog', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: tr.nav.randomPickLabel }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
