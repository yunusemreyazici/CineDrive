import { test, expect, type Page } from '@playwright/test';
import {
  E2E_BASE_URL,
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_COLLABORATOR_EMAIL,
  E2E_COLLABORATOR_PASSWORD,
} from './env.js';
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
    await page.getByLabel(tr.studio.search, { exact: true }).fill('no-such-studio-track');
    await expect(page.getByText(tr.studio.noSearchMatches, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: tr.studio.add, exact: true })).toHaveCount(0);
    for (let count = 1; count <= 2; count++) {
      await page.getByLabel(tr.studio.search, { exact: true }).fill('Smoke');
      await page.getByRole('button', { name: tr.studio.add, exact: true }).click();
      await expect(page.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(count);
    }
    await page.getByRole('button', { name: tr.studio.duplicates, exact: true }).click();
    await expect(page.getByText(tr.studio.selected(1), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: tr.studio.remove, exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(1);
    // Detail and journal are independent requests: wait for the removal
    // revision before expanding the first row, which may still be an addition.
    await expect(page.getByText(tr.studio.addedRemoved(0, 1), { exact: false })).toBeVisible();
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

test('two accounts accept invitations, receive edits and lose access while the editor is open', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const guestContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const guest = await guestContext.newPage();
  const login = async (target: Page, email: string, password: string) => {
    await target.goto('/login');
    await target.getByLabel(tr.auth.email).fill(email);
    await target.getByLabel(tr.auth.password, { exact: true }).fill(password);
    await target.getByRole('button', { name: tr.auth.signIn, exact: true }).click();
    await expect(target.getByRole('heading', { name: tr.design.homeTitle })).toBeVisible();
    await target.goto('/music/studio');
  };
  const reconnect = async (target: Page) => {
    await target.bringToFront();
    await target.evaluate(() => window.dispatchEvent(new Event('online')));
  };
  try {
    await login(page, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
    const name = `Shared ${testInfo.project.name}`;
    await page.getByLabel(tr.studio.name, { exact: true }).fill(name);
    await page.getByRole('button', { name: tr.studio.create, exact: true }).click();
    await page.getByRole('button', { name: `${name} · ${tr.studio.owner}`, exact: true }).click();
    await page.getByLabel(tr.studio.email, { exact: true }).fill(E2E_COLLABORATOR_EMAIL);
    await page.getByRole('button', { name: tr.studio.invite, exact: true }).click();
    await expect(page.getByText(/Studio Collaborator/)).toBeVisible();

    await login(guest, E2E_COLLABORATOR_EMAIL, E2E_COLLABORATOR_PASSWORD);
    await guest.getByRole('button', { name: tr.studio.accept, exact: true }).click();
    await guest.getByRole('button', { name: `${name} · ${tr.studio.editor}`, exact: true }).click();
    await guest.getByLabel(tr.studio.search, { exact: true }).fill('Smoke');
    await guest.getByRole('button', { name: tr.studio.add, exact: true }).click();
    await expect(guest.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(1);
    await reconnect(page);
    await expect(page.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(1);
    await expect(
      page.getByText(`Studio Collaborator · ${tr.studio.kind.edit}`, { exact: true }),
    ).toBeVisible();

    // Selection belongs to this version only, not a later snapshot from another device.
    await guest.getByRole('button', { name: tr.studio.selectAll, exact: true }).click();
    await page.getByLabel(tr.studio.search, { exact: true }).fill('Smoke');
    await page.getByRole('button', { name: tr.studio.add, exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(2);
    await reconnect(guest);
    await expect(guest.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(2);
    await expect(guest.getByText(tr.studio.selected(0), { exact: true })).toBeVisible();

    await page.getByRole('button', { name: tr.studio.revoke, exact: true }).click();
    await reconnect(guest);
    await expect(guest.getByRole('checkbox', { name: /Smoke Test Song/ })).toHaveCount(0);
    await expect(guest.getByRole('heading', { name, exact: true })).toHaveCount(0);
    await expect(
      guest.getByRole('button', { name: `${name} · ${tr.studio.editor}`, exact: true }),
    ).toHaveCount(0);
    await expect(guest.getByRole('alert')).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath('studio-revoked.png') });
  } finally {
    await guestContext.close();
  }
});
