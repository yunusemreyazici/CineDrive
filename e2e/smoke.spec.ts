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
  await page.getByLabel(tr.auth.password).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: tr.auth.signIn }).click();
  await expect(page).toHaveURL(/\/$/);
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
    await page.goto('/library');

    await page.getByRole('link', { name: tr.mediaCard.openDetails('Smoke Test Movie') }).click();

    await expect(page).toHaveURL(/\/media\/e2e_movie_smoke$/);
    await expect(page.getByRole('heading', { name: 'Smoke Test Movie' })).toBeVisible();
    await expect(page.getByRole('button', { name: tr.mediaDetail.play })).toBeVisible();
  });

  test('plays the media through the streaming endpoint', async ({ page }) => {
    await signIn(page);

    const streamResponse = page.waitForResponse(
      (response) => response.url().includes('/stream') && response.status() < 400,
    );
    await page.goto('/watch/e2e_movie_smoke');

    // The server actually served bytes — not merely that a <video> rendered.
    const response = await streamResponse;
    expect([200, 206]).toContain(response.status());

    await expect(page.getByRole('slider', { name: tr.player.seekLabel })).toBeVisible();

    // The element decoded far enough to have a duration and a buffered range.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const video = document.querySelector('video');
            if (!video) return null;
            return { readyState: video.readyState, error: video.error?.code ?? null };
          }),
        { timeout: 20_000 },
      )
      .toMatchObject({ readyState: 4, error: null });
  });

  test('renders the settings sections and switches tabs', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: tr.settings.profile.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: tr.settings.google.title })).toBeVisible();

    await page.getByRole('tab', { name: new RegExp(tr.settings.tabs.health.label) }).click();
    await expect(page).toHaveURL(/tab=health/);
    await expect(page.getByRole('heading', { name: tr.mediaHealth.title })).toBeVisible();
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
