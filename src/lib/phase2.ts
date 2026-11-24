import {
  db,
  generateId,
  type LocalGiftCard,
  type LocalRentalAgreement,
  type LocalRentalItem,
} from '@/lib/dexie';
import { setProductStockLevel } from '@/lib/warehouse';
import { roundMoney } from '@/lib/money';
import { roundStockQtyAllowZero } from '@/lib/measure';

export function normalizeGiftCardCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

export function giftCardIsUsable(card: LocalGiftCard, now = new Date()): boolean {
  return card.status === 'active' && card.balance > 0 && (!card.expires_at || new Date(card.expires_at) > now);
}

function secureCode(): string {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return `ADI${Array.from(bytes, (byte) => (byte % 36).toString(36)).join('').toUpperCase()}`;
}

export async function issueGiftCard(input: {
  storeId: string;
  value: number;
  customerId?: string | null;
  customerName?: string;
  expiresAt?: string | null;
  createdBy: string;
}): Promise<LocalGiftCard> {
  const value = roundMoney(Number(input.value));
  if (!Number.isFinite(value) || value <= 0) throw new Error('Gift card value must be greater than zero.');
  const now = new Date().toISOString();
  let code = secureCode();
  while (await db.gift_cards.where('code').equals(code).first()) code = secureCode();
  const card: LocalGiftCard = {
    id: generateId(), store_id: input.storeId, code, initial_value: value, balance: value,
    status: 'active', customer_id: input.customerId || null, customer_name: input.customerName?.trim() || '',
    expires_at: input.expiresAt || null, created_by: input.createdBy, created_at: now, updated_at: now, synced: 0,
  };
  await db.transaction('rw', db.gift_cards, db.gift_card_transactions, async () => {
    await db.gift_cards.add(card);
    await db.gift_card_transactions.add({
      id: generateId(), store_id: input.storeId, gift_card_id: card.id, type: 'issue',
      amount: value, balance_after: value, note: 'Gift card issued', created_by: input.createdBy,
      created_at: now, synced: 0,
    });
  });
  return card;
}

export async function findGiftCard(storeId: string, code: string): Promise<LocalGiftCard | null> {
  const normalized = normalizeGiftCardCode(code);
  if (!normalized) return null;
  const card = await db.gift_cards.where('code').equals(normalized).first();
  return card?.store_id === storeId ? card : null;
}

export async function changeGiftCardBalance(input: {
  storeId: string;
  code: string;
  amount: number;
  type: 'reload' | 'redeem';
  createdBy: string;
  note?: string;
  transactionId?: string | null;
}): Promise<LocalGiftCard> {
  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  const code = normalizeGiftCardCode(input.code);
  return db.transaction('rw', db.gift_cards, db.gift_card_transactions, async () => {
    const card = await db.gift_cards.where('code').equals(code).first();
    if (!card || card.store_id !== input.storeId) throw new Error('Gift card not found for this store.');
    const active = giftCardIsUsable(card);
    if (input.type === 'redeem' && !active) throw new Error(card.expires_at && new Date(card.expires_at) <= new Date() ? 'This gift card has expired.' : 'This gift card is not active.');
    if (input.type === 'redeem' && amount > card.balance) throw new Error('Gift card balance is too low.');
    if (input.type === 'reload' && card.status !== 'active') throw new Error('Only active gift cards can be reloaded.');
    const balance = roundMoney(card.balance + (input.type === 'reload' ? amount : -amount));
    const now = new Date().toISOString();
    const updated: LocalGiftCard = { ...card, balance, status: balance <= 0 ? 'depleted' : 'active', updated_at: now, synced: 0 };
    await db.gift_cards.put(updated);
    await db.gift_card_transactions.add({
      id: generateId(), store_id: card.store_id, gift_card_id: card.id,
      transaction_id: input.transactionId || null, type: input.type, amount, balance_after: balance,
      note: input.note?.trim() || (input.type === 'reload' ? 'Gift card reloaded' : 'Gift card redeemed'),
      created_by: input.createdBy, created_at: now, synced: 0,
    });
    return updated;
  });
}

export async function setGiftCardDisabled(storeId: string, cardId: string, disabled: boolean): Promise<void> {
  const card = await db.gift_cards.get(cardId);
  if (!card || card.store_id !== storeId) throw new Error('Gift card not found.');
  await db.gift_cards.update(cardId, { status: disabled ? 'disabled' : card.balance > 0 ? 'active' : 'depleted', updated_at: new Date().toISOString(), synced: 0 });
}

function rentalAgreementNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 90000 + 10000);
  return `RN-${day}-${random}`;
}

export async function createRentalAgreement(input: {
  storeId: string;
  productId: string;
  quantity: number;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string;
  startsAt: string;
  dueAt: string;
  ratePeriod: LocalRentalItem['rate_period'];
  createdBy: string;
  createdByName: string;
  notes?: string;
}): Promise<LocalRentalAgreement> {
  const product = await db.products.get(input.productId);
  const qty = roundStockQtyAllowZero(input.quantity);
  if (!product || product.store_id !== input.storeId || product.is_rentable !== 1) throw new Error('Choose a rentable product from this store.');
  if (qty <= 0 || qty > Number(product.stock_level)) throw new Error('Rental quantity must be within available stock.');
  if (!input.customerName.trim()) throw new Error('Customer name is required.');
  const startsAt = new Date(input.startsAt);
  const dueAt = new Date(input.dueAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(dueAt.getTime()) || dueAt <= startsAt) throw new Error('The due date must be after the rental start.');
  const rates = { daily: Number(product.rental_rate_daily) || 0, weekly: Number(product.rental_rate_weekly) || 0, monthly: Number(product.rental_rate_monthly) || 0 };
  const rate = roundMoney(rates[input.ratePeriod]);
  if (rate <= 0) throw new Error(`Set a ${input.ratePeriod} rental rate on this product first.`);
  const now = new Date().toISOString();
  const agreement: LocalRentalAgreement = {
    id: generateId(), store_id: input.storeId, agreement_number: rentalAgreementNumber(),
    customer_id: input.customerId || null, customer_name: input.customerName.trim(), customer_phone: input.customerPhone?.trim() || '',
    status: dueAt.getTime() < Date.now() ? 'overdue' : 'active', starts_at: startsAt.toISOString(), due_at: dueAt.toISOString(),
    returned_at: null, deposit_amount: roundMoney((Number(product.deposit_amount) || 0) * qty), deposit_returned: 0,
    late_fee: 0, damage_fee: 0, notes: input.notes?.trim() || '', created_by: input.createdBy,
    created_by_name: input.createdByName, created_at: now, updated_at: now, synced: 0,
  };
  const item: LocalRentalItem = {
    id: generateId(), store_id: input.storeId, agreement_id: agreement.id, product_id: product.id,
    product_name: product.name, quantity: qty, rate_amount: rate, rate_period: input.ratePeriod,
    deposit_amount: agreement.deposit_amount, condition_at_return: '', created_at: now, updated_at: now, synced: 0,
  };
  await setProductStockLevel({ storeId: input.storeId, productId: product.id, targetQty: Number(product.stock_level) - qty, note: `Rental out ${agreement.agreement_number}`, userId: input.createdBy });
  try {
    await db.transaction('rw', db.rental_agreements, db.rental_items, async () => {
      await db.rental_agreements.add(agreement);
      await db.rental_items.add(item);
    });
  } catch (error) {
    await setProductStockLevel({ storeId: input.storeId, productId: product.id, targetQty: Number(product.stock_level), note: `Rollback rental ${agreement.agreement_number}`, userId: input.createdBy });
    throw error;
  }
  return agreement;
}

export async function returnRentalAgreement(input: {
  storeId: string;
  agreementId: string;
  createdBy: string;
  lateFee?: number;
  damageFee?: number;
  condition?: string;
}): Promise<{ agreement: LocalRentalAgreement; depositRefund: number }> {
  const agreement = await db.rental_agreements.get(input.agreementId);
  if (!agreement || agreement.store_id !== input.storeId) throw new Error('Rental agreement not found.');
  if (agreement.status === 'returned' || agreement.status === 'cancelled') throw new Error('This rental is already closed.');
  const items = await db.rental_items.where('agreement_id').equals(agreement.id).toArray();
  const now = new Date();
  const due = new Date(agreement.due_at);
  const daysLate = Math.max(0, Math.ceil((now.getTime() - due.getTime()) / 86_400_000));
  const automaticLateFee = items.reduce((sum, item) => {
    const factor = item.rate_period === 'weekly' ? 7 : item.rate_period === 'monthly' ? 30 : 1;
    return sum + (item.rate_amount / factor) * item.quantity * daysLate;
  }, 0);
  const lateFee = roundMoney(input.lateFee == null ? automaticLateFee : Math.max(0, Number(input.lateFee) || 0));
  const damageFee = roundMoney(Math.max(0, Number(input.damageFee) || 0));
  let depositRefund = Math.max(0, roundMoney(agreement.deposit_amount - lateFee - damageFee));
  const updated: LocalRentalAgreement = {
    ...agreement, status: 'returned', returned_at: now.toISOString(), late_fee: lateFee, damage_fee: damageFee,
    deposit_returned: depositRefund, updated_at: now.toISOString(), synced: 0,
  };
  const productStockBefore: Array<{ productId: string; before: number; after: number }> = [];
  try {
    for (const item of items) {
      const product = await db.products.get(item.product_id);
      if (!product || product.store_id !== input.storeId) throw new Error(`Could not return ${item.product_name}: product is missing.`);
      productStockBefore.push({ productId: product.id, before: Number(product.stock_level) || 0, after: (Number(product.stock_level) || 0) + item.quantity });
      await setProductStockLevel({ storeId: input.storeId, productId: product.id, targetQty: (Number(product.stock_level) || 0) + item.quantity, note: `Rental return ${agreement.agreement_number}`, userId: input.createdBy });
    }
    await db.transaction('rw', db.rental_agreements, db.rental_items, async () => {
      await db.rental_agreements.put(updated);
      for (const item of items) await db.rental_items.update(item.id, { condition_at_return: input.condition?.trim().slice(0, 200) || '', updated_at: now.toISOString(), synced: 0 });
    });
  } catch (error) {
    for (const stock of productStockBefore.reverse()) {
      await setProductStockLevel({ storeId: input.storeId, productId: stock.productId, targetQty: stock.before, note: `Rollback rental return ${agreement.agreement_number}`, userId: input.createdBy }).catch(() => undefined);
    }
    throw error;
  }
  return { agreement: updated, depositRefund };
}
