import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/manage-promotional-campaigns', async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    if (body?.action === 'verify-session') {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ json: { session: 'e2e-admin-session' } });
  });
});

async function openAdmin(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrator portal' }).click();
  await page.getByLabel('Administrator PIN').fill('12345678');
  await expect(page.getByRole('button', { name: 'Overview', exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

test('administrator Broadcast SMS tab is visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAdmin(page);
  await page.getByRole('button', { name: 'Broadcast SMS', exact: true }).click();
  await expect(page.locator('#broadcast-sms-title')).toBeVisible();
  await expect(page.getByLabel('Message')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send broadcast SMS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Care', exact: true })).toBeVisible();
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Broadcast SMS is in the admin More sheet', async ({ page }) => {
    await openAdmin(page);
    await page.getByRole('button', { name: 'More admin tools' }).click();
    await page.locator('div.fixed.z-50').getByRole('button', { name: 'Broadcast SMS', exact: true }).click();
    await expect(page.locator('#broadcast-sms-title')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send broadcast SMS' })).toBeVisible();
  });
});
