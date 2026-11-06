import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = '/opt/cursor/artifacts/screenshots';

function legacyPin(pin: string): string {
  let hash = 0;
  const str = `adimat_salt_${pin}_pos`;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function seed(page: Page): Promise<void> {
  const now = new Date().toISOString();
  await page.evaluate(async ({ now, ownerHash }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('AdimatPOS');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(
          ['stores', 'users', 'app_config', 'products', 'locations', 'stock_batches'],
          'readwrite',
        );
        const store = '11111111-1111-4111-8111-111111111111';
        tx.objectStore('stores').put({
          id: store,
          name: 'Care Test Shop',
          address: 'Accra',
          support_number: '0240000000',
          discount_cap_percentage: 10,
          pin_on_discount_enabled: 0,
          cashier_can_see_stock: 1,
          cashiers_can_view_stock: 1,
          created_at: now,
          synced: 1,
        });
        tx.objectStore('users').put({
          id: '22222222-2222-4222-8222-222222222222',
          store_id: store,
          name: 'Ama Owner',
          role: 'owner',
          pin_hash: ownerHash,
          phone: '0240000000',
          is_active: 1,
          can_view_stock: 1,
          created_at: now,
          synced: 1,
        });
        tx.objectStore('app_config').put({ id: 'main', current_store_id: store, current_user_id: null });
        const location = '33333333-3333-4333-8333-333333333333';
        tx.objectStore('locations').put({
          id: location,
          store_id: store,
          name: 'Shop',
          location_type: 'shop',
          is_default: 1,
          is_active: 1,
          created_at: now,
          updated_at: now,
          synced: 1,
        });
        ['Rice', 'Oil', 'Soap'].forEach((name, index) => {
          const id = `44444444-4444-4444-8444-44444444444${index}`;
          tx.objectStore('products').put({
            id,
            store_id: store,
            name,
            category: index === 2 ? 'Home' : 'Food',
            sku_type: 'unit',
            barcode: `ITEM${index}`,
            cost_price: 2,
            selling_price: 5 + index,
            stock_level: 12,
            is_active: 1,
            created_at: now,
            updated_at: now,
            synced: 1,
          });
          tx.objectStore('stock_batches').put({
            id: `55555555-5555-4555-8555-55555555555${index}`,
            store_id: store,
            product_id: id,
            location_id: location,
            batch_code: 'OPENING',
            expiry_date: null,
            quantity: 12,
            cost_price: 2,
            created_at: now,
            updated_at: now,
            synced: 1,
          });
        });
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { now, ownerHash: legacyPin('1234') });
}

test.use({ serviceWorkers: 'block' });

test('the tablet POS uses the dark order layout and keeps checkout', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/');
  await page.waitForTimeout(400);
  await seed(page);
  await page.reload();
  await page.getByLabel('Store PIN').fill('1234');
  await expect(page.getByText('Owner dashboard')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'SMS wallet' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/food-pos-dashboard.png` });

  await page.getByRole('button', { name: 'POS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Care Test Shop' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Food' })).toBeVisible();
  await page.getByRole('button', { name: /Add Rice/ }).click();
  await expect(page.getByRole('button', { name: 'Continue to Payment' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Orders/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/food-pos-tablet.png` });
});
