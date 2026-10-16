import { test, expect, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
  await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`saved catalogue views survive reload and restore facets at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await signIn(page);
    await page.goto('/movies');
    await page.getByLabel(tr.filters.yearRange).selectOption('2000s');
    await page.getByLabel(tr.filters.minRating).selectOption('8.0');
    await expect(page).toHaveURL(/minRating=8/);
    await page.getByRole('button', { name: tr.shortcuts.saveView }).click();
    const modal = page.getByRole('dialog', { name: tr.shortcuts.saveView });
    await modal.getByLabel(tr.shortcuts.viewName).fill('My 2000s films');
    await modal.getByRole('button', { name: tr.common.save, exact: true }).click();
    await expect(modal).toBeHidden();
    await page.goto('/library');
    await expect(page.getByRole('heading', { name: tr.library.title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: tr.library.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'My 2000s films', exact: true }).click();
    await expect(page).toHaveURL(/\/movies\?minRating=8&yearRange=2000s$/);
    await expect(page.getByLabel(tr.filters.yearRange)).toHaveValue('2000s');
    await expect(page.getByLabel(tr.filters.minRating)).toHaveValue('8.0');
    await page.screenshot({ path: testInfo.outputPath('saved-views.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: tr.shortcuts.removeView('My 2000s films') }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: tr.movies.title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'My 2000s films', exact: true })).toHaveCount(0);
  });
}

test('global search remembers chosen searches and supports keyboard shortcuts', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.getByRole('button', { name: tr.nav.openSearch }).click();
  const input = page.getByRole('combobox', { name: tr.search.dialogLabel });
  await expect(page.getByRole('heading', { name: tr.shortcuts.quickNavigation })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/movies$/);
  await expect(page.getByRole('heading', { name: tr.movies.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: tr.nav.openSearch }).click();
  await input.fill('Smoke');
  await expect(page.getByRole('option', { name: /Smoke Test Movie/ }).first()).toBeVisible();
  await page
    .getByRole('option', { name: /Smoke Test Movie/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/media\/e2e_movie_smoke$/);
  await expect(page.getByRole('heading', { name: 'Smoke Test Movie', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Smoke Test Movie', exact: true })).toBeVisible();
  await page.getByRole('button', { name: tr.nav.openSearch }).click();
  await expect(page.getByRole('button', { name: tr.shortcuts.searchAgain('Smoke') })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('recent-searches.png') });
  await page.getByRole('button', { name: tr.shortcuts.searchAgain('Smoke') }).click();
  await expect(input).toHaveValue('Smoke');
  await input.fill('');
  await page.getByRole('button', { name: tr.shortcuts.clearSearches }).click();
  await expect(page.getByRole('button', { name: tr.shortcuts.searchAgain('Smoke') })).toHaveCount(
    0,
  );
  await input.press('Shift+Tab');
  await expect(page.getByRole('option').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.goto('/music');
  await expect(page.getByRole('heading', { name: tr.music.title, exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await expect(page.getByRole('heading', { name: tr.shortcuts.quickNavigation })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: tr.music.title, exact: true })).toBeVisible();
  await expect(page.getByText(tr.errors.boundaryTitle, { exact: true })).toHaveCount(0);
});
