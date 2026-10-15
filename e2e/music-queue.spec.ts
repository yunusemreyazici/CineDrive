import { expect, test } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './env.js';
import { tr } from '../apps/web/src/i18n/tr.js';

for (const width of [1440, 390]) {
  test(`queue search and removal undo at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/login');
    await page.getByLabel(tr.auth.email).fill(E2E_ADMIN_EMAIL);
    await page.getByLabel(tr.auth.password, { exact: true }).fill(E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
    await expect(page.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
    await page.goto('/music');
    await page.getByRole('button', { name: tr.music.playTrack('Smoke Test Song') }).click();
    const pause = page.getByRole('button', { name: tr.music.pause, exact: true });
    await expect(pause).toBeVisible();
    await pause.click();
    await page.getByLabel(tr.music.moreActions, { exact: true }).first().click();
    await page.getByRole('button', { name: tr.music.addQueue, exact: true }).first().click();
    await page.getByRole('button', { name: tr.music.queue, exact: true }).click();
    const queue = page.getByRole('complementary', { name: tr.music.queue, exact: true });
    await expect(queue.getByText(tr.music.queueMatches(2, 2))).toBeVisible();
    await expect(queue.getByText(tr.music.queueCurrent)).toBeVisible();
    await expect(queue.getByText(tr.music.queueUpNext)).toBeVisible();
    await queue.getByRole('searchbox').fill('not-a-track');
    await expect(queue.getByText(tr.music.queueNoMatches)).toBeVisible();
    await queue.getByRole('searchbox').fill('smoke');
    const remove = queue.getByRole('button', { name: tr.music.queueRemove('Smoke Test Song') });
    await remove.nth(1).click();
    await expect(queue.getByText(tr.music.queueMatches(1, 1))).toBeVisible();
    await queue.getByRole('button', { name: tr.music.queueUndo }).click();
    await expect(queue.getByText(tr.music.queueMatches(2, 2))).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('music-queue.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    // Removing the last selected entry must not hide the undo panel.
    await remove.nth(1).click();
    await remove.click();
    await expect(queue.getByText(tr.music.queueMatches(0, 0))).toBeVisible();
    await queue.getByRole('button', { name: tr.music.queueUndo }).click();
    await expect(queue.getByText(tr.music.queueMatches(1, 1))).toBeVisible();
    await expect
      .poll(() =>
        page.locator('audio').evaluateAll((elements) => elements.every((audio) => audio.paused)),
      )
      .toBe(true);
    await queue.getByRole('searchbox').press('Escape');
    await expect(queue).toBeHidden();
  });
}
