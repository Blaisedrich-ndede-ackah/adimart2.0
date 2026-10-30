import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const CASHIER_ID = '66666666-6666-4666-8666-666666666666';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const BATCH_ID = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_ID = '77777777-7777-4777-8777-777777777777';
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

async function seedShop(page: Page): Promise<void> {
  const now = new Date().toISOString();
  await page.evaluate(async ({ now, ownerHash, cashierHash, ids }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('AdimatPOS');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(
          ['stores', 'users', 'app_config', 'products', 'locations', 'stock_batches', 'customers'],
          'readwrite'
        );
        tx.objectStore('stores').put({
          id: ids.store,
          name: 'Care Test Shop',
          address: 'Accra',
          support_number: '0240000000',
          discount_cap_percentage: 10,
          pin_on_discount_enabled: 0,
          discount_allow_percentage: 1,
          discount_allow_fixed: 1,
          cashier_can_discount: 1,
          cashier_can_see_stock: 0,
          cashiers_can_view_stock: 0,
          momo_account_name: '',
          momo_number: '',
          momo_network: '',
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
          can_view_stock: 1,
          can_wholesale: 1,
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
          can_wholesale: 1,
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
          wholesale_mode: 'unit_discount',
          wholesale_unit_price: 3.5,
          stock_level: 10,
          reorder_level: 2,
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
        tx.objectStore('customers').put({
          id: ids.customer,
          store_id: ids.store,
          name: 'Akosua Mensah',
          phone: '0241112222',
          address: '12 Ring Road\nAccra\nGreater Accra',
          location_id: null,
          opening_balance: 0,
          opening_balance_remaining: 0,
          wallet_balance: 0,
          is_active: 1,
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
    ownerHash: legacyPin('1234'),
    cashierHash: legacyPin('5678'),
    ids: {
      store: STORE_ID,
      owner: OWNER_ID,
      cashier: CASHIER_ID,
      product: PRODUCT_ID,
      location: LOCATION_ID,
      batch: BATCH_ID,
      customer: CUSTOMER_ID,
    },
  });
}

async function openApp(page: Page): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.waitForTimeout(400);
  await seedShop(page);
  await page.reload();
}

async function signIn(page: Page, pin: string): Promise<void> {
  await page.getByLabel('Store PIN').fill(pin);
  await expect(page.getByRole('button', { name: 'POS', exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

async function sidebar(page: Page) {
  return page.locator('aside');
}

test('search finds a product and a customer address', async ({ page }) => {
  await openApp(page);
  await signIn(page, '1234');
  const nav = await sidebar(page);
  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Search products, customers, and records').fill('Ring Road');
  await expect(page.getByText('Akosua Mensah')).toBeVisible();
  await expect(page.getByText(/12 Ring Road, Accra, Greater Accra/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/restored-search-address.png`, fullPage: true });

  await nav.getByRole('button', { name: 'Customers', exact: true }).click();
  await page.getByLabel('Search customers by name, phone, address, or preferred location').fill('Ring Road');
  await expect(page.getByText(/12 Ring Road, Accra, Greater Accra/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/restored-customer-address.png`, fullPage: true });
});

test('checkout receipt shows the customer address', async ({ page }) => {
  await openApp(page);
  await signIn(page, '1234');
  await page.getByRole('button', { name: 'POS', exact: true }).first().click();
  await page.getByRole('button', { name: /Test Rice/ }).click();
  await page.getByRole('button', { name: /Checkout/ }).first().click();
  await page.getByRole('button', { name: 'Credit Sale' }).click();
  await page.getByPlaceholder('Search customers by name, phone, or address…').fill('Ring Road');
  const customerSelect = page.getByLabel('Registered customer *');
  await expect(customerSelect.locator('option', { hasText: 'Ring Road' })).toHaveCount(1);
  await customerSelect.selectOption({ index: 1 });
  await expect(page.getByLabel('Registered customer *')).toContainText('12 Ring Road');
  await page.getByRole('button', { name: 'Record Credit Sale' }).click();
  await expect(page.getByText(/12 Ring Road, Accra, Greater Accra/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/restored-receipt-address.png`, fullPage: true });
});

test('one sale can mix wholesale and retail lines', async ({ page }) => {
  await openApp(page);
  await signIn(page, '1234');
  await page.getByRole('button', { name: 'POS', exact: true }).first().click();
  await page.locator('.pos-product-card', { hasText: 'Test Rice' }).click();
  await page.getByRole('button', { name: 'Use wholesale pricing for newly added items' }).click();
  await page.locator('.pos-product-card', { hasText: 'Test Rice' }).click();
  await expect(page.getByText(/Mixed sale · 1 retail · 1 wholesale/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/restored-mixed-sale.png`, fullPage: true });
});

test('stock changes wait for cashier approval', async ({ page }) => {
  await openApp(page);
  await signIn(page, '1234');
  const nav = await sidebar(page);
  await nav.getByRole('button', { name: 'Stock approvals', exact: true }).click();
  await page.getByLabel('Product').selectOption({ label: 'Test Rice' });
  await page.getByLabel('Quantity').fill('4');
  await page.getByRole('button', { name: 'Queue for cashier approval' }).click();
  await expect(page.getByText('Waiting for approval (1)')).toBeVisible();
  await expect(page.getByText(/cashier must sign in/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/restored-stock-approval-owner.png`, fullPage: true });

  await nav.getByRole('button', { name: 'Switch user' }).click();
  await signIn(page, '5678');
  await (await sidebar(page)).getByRole('button', { name: 'Stock approvals', exact: true }).click();
  await page.getByRole('checkbox', { name: /physically present/ }).check();
  await page.getByRole('button', { name: 'Approve and add stock' }).click();
  await expect(page.getByText(/is now in stock/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/restored-stock-approval-cashier.png`, fullPage: true });
});

test('cashiers do not see ADIMAT AI and stock quantities stay hidden until the owner allows them', async ({ page }) => {
  await openApp(page);
  await signIn(page, '5678');
  const cashierNav = await sidebar(page);
  await expect(cashierNav.getByRole('button', { name: 'ADIMAT AI', exact: true })).toHaveCount(0);
  await expect(cashierNav.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
  await cashierNav.getByRole('button', { name: 'POS', exact: true }).click();
  const hidden = page.getByRole('button', { name: /Test Rice/ });
  await expect(hidden).toBeVisible();
  await expect(hidden).not.toContainText('available');
  await page.screenshot({ path: `${SHOTS}/restored-cashier-no-ai-no-qty.png`, fullPage: true });

  await cashierNav.getByRole('button', { name: 'Switch user' }).click();
  await signIn(page, '1234');
  const ownerNav = await sidebar(page);
  await expect(ownerNav.getByRole('button', { name: 'ADIMAT AI', exact: true })).toBeVisible();
  await ownerNav.getByRole('button', { name: 'Settings', exact: true }).click();
  const stockToggle = page.getByRole('button', { name: 'Cashiers can see stock quantities' });
  await stockToggle.scrollIntoViewIfNeeded();
  await expect(stockToggle).toHaveAttribute('aria-pressed', 'false');
  await stockToggle.click();
  await expect(stockToggle).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${SHOTS}/restored-stock-visibility-toggle.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save all settings' }).click();
  await expect(page.getByText('Settings saved!')).toBeVisible();

  await ownerNav.getByRole('button', { name: 'Switch user' }).click();
  await signIn(page, '5678');
  await (await sidebar(page)).getByRole('button', { name: 'POS', exact: true }).click();
  await expect(page.getByRole('button', { name: /Test Rice/ })).toContainText('available');
  await page.screenshot({ path: `${SHOTS}/restored-cashier-qty-visible.png`, fullPage: true });
});
