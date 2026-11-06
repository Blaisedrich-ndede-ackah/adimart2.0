import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const CASHIER_ID = '66666666-6666-4666-8666-666666666666';
const CUSTOMER_ID = '77777777-7777-4777-8777-777777777777';
const BROKEN_ID = '88888888-8888-4888-8888-888888888888';
const WALLET_ID = '99999999-9999-4999-8999-999999999999';
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
          ['stores', 'users', 'app_config', 'customers', 'customer_wallet_transactions'],
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
          cashier_can_record_payments: 0,
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
        tx.objectStore('customers').put({
          id: ids.customer,
          store_id: ids.store,
          name: 'Akosua Mensah',
          phone: '0241112222',
          address: '12 Ring Road\nAccra\nGreater Accra',
          location_id: null,
          opening_balance: 25,
          opening_balance_remaining: 25,
          wallet_balance: 0,
          is_active: 1,
          created_at: now,
          updated_at: now,
          synced: 1,
        });
        tx.objectStore('customers').put({
          id: ids.broken,
          store_id: ids.store,
          name: 'Yaw Badrow',
          phone: null,
          address: 12,
          location_id: null,
          opening_balance: 0,
          opening_balance_remaining: 0,
          wallet_balance: 0,
          is_active: 1,
          created_at: now,
          updated_at: now,
          synced: 1,
        });
        tx.objectStore('customer_wallet_transactions').put({
          id: ids.wallet,
          store_id: ids.store,
          customer_id: ids.broken,
          type: 'adjustment',
          amount: 5,
          balance_after: 5,
          description: null,
          created_by: 'Seed',
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
      customer: CUSTOMER_ID,
      broken: BROKEN_ID,
      wallet: WALLET_ID,
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

test.use({ serviceWorkers: 'block' });

test('adding a customer opens a dialog and stays on the page', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await signIn(page, '1234');
  await page.getByRole('button', { name: 'More menu' }).click();
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customer management' })).toBeVisible();

  await page.getByRole('button', { name: /Yaw Badrow/ }).click();
  await expect(page.getByText('Customer page stopped')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Customer management' })).toBeVisible();

  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  await page.getByRole('button', { name: 'Add customer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register customer' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Customer name')).toBeFocused();
  await expect(dialog).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/customer-modal-open.png` });

  await dialog.getByLabel('Customer name').fill('Efua Boateng');
  await dialog.getByLabel(/Phone/).fill('0243334444');
  await dialog.getByRole('button', { name: 'Register customer' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Customer registered.')).toBeVisible();
  await expect(page.getByText('Efua Boateng')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Customer management' })).toBeVisible();
  const scroll = await page.evaluate(() => {
    const body = document.querySelector('.page-body');
    if (!(body instanceof HTMLElement)) return { ok: false, scrollHeight: 0, clientHeight: 0, scrollTop: 0 };
    const before = body.scrollTop;
    body.scrollTop = body.scrollHeight;
    return {
      ok: body.scrollHeight > body.clientHeight + 20 && body.scrollTop > before,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      scrollTop: body.scrollTop,
    };
  });
  expect(scroll.ok, `customer list did not scroll (${scroll.scrollTop}/${scroll.scrollHeight}, view ${scroll.clientHeight})`).toBe(true);
  expect(navigations).toBe(0);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/customer-registered.png` });
});

test('owner can let a cashier record a payment and print the receipt', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openApp(page);
  await signIn(page, '5678');
  await expect(page.locator('aside').getByRole('button', { name: 'Customers', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
  await expect(page.locator('aside').getByRole('button', { name: 'POS', exact: true })).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Switch user', exact: true }).click();
  await signIn(page, '1234');
  await page.locator('aside').getByRole('button', { name: 'Settings', exact: true }).click();
  const paymentSwitch = page.getByRole('button', { name: 'Cashiers can record customer payments' });
  await expect(paymentSwitch).toHaveAttribute('aria-pressed', 'false');
  await paymentSwitch.click();
  await expect(paymentSwitch).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${SHOTS}/cashier-payment-setting.png` });
  await page.getByRole('button', { name: 'Save all settings' }).click();
  await expect(page.getByText('Settings saved!')).toBeVisible();

  await page.locator('aside').getByRole('button', { name: 'Switch user', exact: true }).click();
  await signIn(page, '5678');
  await expect(page.locator('aside').getByRole('button', { name: 'POS', exact: true })).toBeVisible();
  await expect(page.locator('aside').getByRole('button', { name: 'My Sales', exact: true })).toBeVisible();
  await expect(page.locator('aside').getByRole('button', { name: 'Record payment', exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/cashier-record-payment-button.png` });
  await page.locator('.page-header').getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('heading', { name: 'Customer payments' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add customer' })).toHaveCount(0);

  await page.getByRole('button', { name: /Akosua Mensah/ }).click();
  await page.getByLabel('Amount').fill('10');
  await page.locator('.page-body').getByRole('button', { name: /Record payment · balance/ }).click();
  await expect(page.getByText(/Payment of/)).toBeVisible();
  const printButton = page.getByRole('button', { name: 'Print', exact: true });
  await expect(printButton).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/cashier-payment-receipt.png` });

  const popupPromise = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
  await printButton.click();
  const popup = await popupPromise;
  if (popup) await popup.close();
  await expect(page.getByRole('heading', { name: 'Customer payments' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
