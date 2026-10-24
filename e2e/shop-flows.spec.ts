import { expect, test, type Page } from '@playwright/test';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';

function legacyPin(pin: string): string {
  let hash = 0;
  const str = `adimat_salt_${pin}_pos`;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function seedShop(page: Page): Promise<void> {
  const now = new Date().toISOString();
  await page.evaluate(async ({ now, pinHash, ids }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('AdimatPOS');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(
          ['stores', 'users', 'app_config', 'products', 'locations', 'stock_batches'],
          'readwrite'
        );
        tx.objectStore('stores').put({
          id: ids.store,
          name: 'Care Test Shop',
          address: 'Accra',
          support_number: '0240000000',
          discount_cap_percentage: 0,
          pin_on_discount_enabled: 0,
          momo_account_name: '',
          momo_number: '',
          momo_network: '',
          created_at: now,
          synced: 1,
        });
        tx.objectStore('users').put({
          id: ids.user,
          store_id: ids.store,
          name: 'Ama Owner',
          role: 'owner',
          pin_hash: pinHash,
          phone: '0240000000',
          is_active: 1,
          created_at: now,
          synced: 1,
        });
        tx.objectStore('app_config').put({
          id: 'main',
          current_store_id: ids.store,
          current_user_id: null,
        });
        tx.objectStore('products').put({
          id: ids.product,
          store_id: ids.store,
          name: 'Test Rice',
          category: 'Food',
          sku_type: 'unit',
          barcode: 'RICE1',
          cost_price: 2,
          selling_price: 5,
          stock_level: 10,
          is_active: 1,
          created_at: now,
          updated_at: now,
          synced: 1,
        });
        tx.objectStore('locations').put({
          id: ids.location,
          store_id: ids.store,
          name: 'Shop',
          location_type: 'shop',
          is_default: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          synced: 1,
        });
        tx.objectStore('stock_batches').put({
          id: ids.batch,
          store_id: ids.store,
          product_id: ids.product,
          location_id: ids.location,
          batch_code: 'OPENING',
          expiry_date: null,
          quantity: 10,
          cost_price: 2,
          created_at: now,
          updated_at: now,
          synced: 1,
        });
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    now,
    pinHash: legacyPin('1234'),
    ids: { store: STORE_ID, user: USER_ID, product: PRODUCT_ID, location: LOCATION_ID, batch: BATCH_ID },
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForTimeout(500);
  await seedShop(page);
  await page.reload();
  await page.getByLabel('Store PIN').fill('1234');
  await expect(page.getByRole('button', { name: 'POS', exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

test('owner can sign in', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Care Test Shop').first()).toBeVisible();
});

test('POS sale completes checkout', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'POS', exact: true }).first().click();
  await page.getByRole('button', { name: /Test Rice/ }).click();
  await page.getByRole('button', { name: /Checkout/ }).first().click();
  await page.getByRole('button', { name: 'Cash Payment' }).click();
  await page.getByLabel(/Cash received/).fill('5');
  await page.getByRole('button', { name: 'Complete Sale' }).click();
  await expect(page.getByText(/#ADM-/).first()).toBeVisible({ timeout: 15_000 });
});

test('ADIMAT AI opens from the sidebar', async ({ page }) => {
  await login(page);
  const sidebar = page.locator('aside');
  await expect(sidebar.getByRole('button', { name: 'ADIMAT AI', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Help & Support', exact: true })).toBeVisible();
  await sidebar.getByRole('button', { name: 'ADIMAT AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ADIMAT AI', exact: true })).toBeVisible();
  await expect(page.getByText('ADIMAT AI runs on this device')).toBeVisible();
  await expect(page.getByText('Ready offline')).toBeVisible();
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('ADIMAT AI opens from the More sheet', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('region', { name: 'Daily Shop Brief' }).getByRole('button', { name: 'ADIMAT AI', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'More menu' }).click();
    const sheet = page.locator('div.fixed.z-50');
    await sheet.getByRole('button', { name: 'ADIMAT AI', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ADIMAT AI', exact: true })).toBeVisible();
    await expect(page.getByText('Ready offline')).toBeVisible();
  });
});

test('offline sale waits to sync and reconnects', async ({ page, context }) => {
  await login(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'POS', exact: true }).first().click();
  await page.getByRole('button', { name: /Test Rice/ }).click();
  await page.getByRole('button', { name: /Checkout/ }).first().click();
  await page.getByRole('button', { name: 'Cash Payment' }).click();
  await page.getByLabel(/Cash received/).fill('5');
  await page.getByRole('button', { name: 'Complete Sale' }).click();
  await expect(page.getByText(/changes waiting|Sync error|Offline/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'New Sale' }).click();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText(/Online|Sync error|Syncing/).first()).toBeVisible();
});
