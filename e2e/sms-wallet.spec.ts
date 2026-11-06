import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const CASHIER_ID = '66666666-6666-4666-8666-666666666666';
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
        const tx = database.transaction(['stores', 'users', 'app_config'], 'readwrite');
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
          sms_balance_pesewas: 0,
          receipt_sms_enabled: 0,
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
    ids: { store: STORE_ID, owner: OWNER_ID, cashier: CASHIER_ID },
  });
}

test.use({ serviceWorkers: 'block' });

test('the owner dashboard funds SMS credit and switches receipt texts', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  let receiptSms = false;
  await page.route('**/api/sms-wallet', async (route) => {
    const body = route.request().postDataJSON() as { action?: string; enabled?: boolean };
    if (body.action === 'set-receipt-sms') receiptSms = body.enabled === true;
    if (body.action === 'balance' || body.action === 'set-receipt-sms') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ balancePesewas: 0, receiptSmsEnabled: receiptSms, entries: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Paystack is not configured. Add PAYSTACK_SECRET_KEY on the server.' }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(400);
  await seedShop(page);
  await page.reload();
  await page.getByLabel('Store PIN').fill('1234');
  await expect(page.getByText('Owner dashboard')).toBeVisible({ timeout: 20_000 });

  const wallet = page.getByRole('region', { name: 'SMS wallet' });
  await expect(wallet).toBeVisible();
  await expect(wallet.getByText('0 texts left for this store')).toBeVisible();
  const receiptSwitch = wallet.getByRole('switch', { name: 'Receipt texts' });
  await expect(receiptSwitch).toHaveAttribute('aria-checked', 'false');
  await receiptSwitch.click();
  await expect(receiptSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(wallet.getByText('Receipt texts are on for saved customer numbers.')).toBeVisible();

  await wallet.getByRole('button', { name: 'Add SMS credit' }).click();
  await expect(wallet.getByRole('alert')).toContainText('Paystack is not configured');
  await expect(wallet.getByText('0 texts left for this store')).toBeVisible();
  await expect(page.getByText('Today’s sales')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/sms-wallet-card.png` });
});
