import { expect, test, type Page } from '@playwright/test';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const CASHIER_ID = '66666666-6666-4666-8666-666666666666';
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
  await page.evaluate(async ({ now, ownerHash, cashierHash, ids }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('AdimatPOS');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(
          ['stores', 'users', 'app_config', 'products', 'locations', 'stock_batches', 'transactions'],
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
          cashier_can_see_stock: 0,
          created_at: now,
          synced: 1,
        });
        tx.objectStore('users').put({
          id: ids.owner,
          store_id: ids.store,
          name: 'Ama Owner',
          role: 'owner',
          pin_hash: ownerHash,
          phone: '0240000000',
          is_active: 1,
          created_at: now,
          synced: 1,
        });
        tx.objectStore('users').put({
          id: ids.cashier,
          store_id: ids.store,
          name: 'Kofi Cashier',
          role: 'cashier',
          pin_hash: cashierHash,
          phone: '0240000001',
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
        tx.objectStore('transactions').put({
          id: '77777777-7777-4777-8777-777777777777',
          store_id: ids.store,
          receipt_number: 'ADM-OLD',
          cashier_id: ids.owner,
          cashier_name: 'Ama Owner',
          total_amount: 15,
          discount_applied: 0,
          payment_method: 'cash',
          cash_amount: 15,
          paystack_amount: 0,
          paystack_reference: '',
          status: 'completed',
          created_at: '2026-10-01T10:15:00.000Z',
          synced: 1,
        });
        tx.objectStore('transactions').put({
          id: '88888888-8888-4888-8888-888888888888',
          store_id: ids.store,
          receipt_number: 'ADM-NEW',
          cashier_id: ids.owner,
          cashier_name: 'Ama Owner',
          total_amount: 5,
          discount_applied: 0,
          payment_method: 'cash',
          cash_amount: 5,
          paystack_amount: 0,
          paystack_reference: '',
          status: 'completed',
          created_at: now,
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
    ownerHash: legacyPin('1234'),
    cashierHash: legacyPin('5678'),
    ids: {
      store: STORE_ID,
      owner: OWNER_ID,
      cashier: CASHIER_ID,
      product: PRODUCT_ID,
      location: LOCATION_ID,
      batch: BATCH_ID,
    },
  });
}

async function signIn(page: Page, pin: string): Promise<void> {
  await page.goto('/');
  await page.waitForTimeout(400);
  await seedShop(page);
  await page.reload();
  await page.getByLabel('Store PIN').fill(pin);
}

test('owner restores from cloud, filters sales, and cashiers hide stock until allowed', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '1234');
  await expect(page.getByRole('button', { name: 'POS', exact: true }).first()).toBeVisible({ timeout: 20_000 });

  await page.locator('aside').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Restore store from cloud' }).click();
  await page.getByLabel('Store ID').fill('not-a-store');
  await page.getByLabel('Owner or admin PIN').fill('1234');
  await page.getByRole('button', { name: 'Restore from cloud' }).click();
  await expect(page.getByText(/Supabase not configured/i)).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'POS', exact: true }).click();
  await expect(page.getByText('10 available')).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Sales Records', exact: true }).click();
  await expect(page.getByText('ADM-OLD')).toBeVisible();
  await expect(page.getByText('ADM-NEW')).toBeVisible();
  await page.getByRole('tab', { name: 'Custom' }).click();
  await page.getByLabel('From').fill('2026-10-01T00:00');
  await page.getByLabel('To').fill('2026-10-01T23:59');
  await expect(page.getByText('ADM-OLD')).toBeVisible();
  await expect(page.getByText('ADM-NEW')).toHaveCount(0);
  await page.getByRole('tab', { name: 'All time' }).click();
  await expect(page.getByText('ADM-NEW')).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Settings', exact: true }).click();
  const stockToggle = page.getByRole('button', { name: 'Cashiers can see stock quantities' });
  await expect(stockToggle).toHaveAttribute('aria-pressed', 'false');
  await stockToggle.click();
  await page.getByRole('button', { name: 'Save all settings' }).click();
  await expect(page.getByText('Settings saved!')).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Switch user', exact: true }).click();
  await page.getByLabel('Store PIN').fill('5678');
  await expect(page.getByRole('button', { name: /Test Rice/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('10 available')).toBeVisible();
});

test('cashier stock quantities stay hidden until the owner allows them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '5678');
  await expect(page.getByRole('button', { name: /Test Rice/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('10 available')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Test Rice to cart for GH₵ 5.00 per unit' })).toBeVisible();
});
