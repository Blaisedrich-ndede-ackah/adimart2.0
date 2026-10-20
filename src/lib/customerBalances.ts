/**
 * Shared outstanding-credit calculations.
 *
 * A customer's account balance is the unpaid opening balance plus the
 * running balance carried on every credit sale recorded against them.
 * The customer book, the live dashboard, the debt-reminder engine and the
 * multi-store consolidated view all read it from here so the numbers can
 * never drift apart.
 */

import { db } from './dexie';

export interface CustomerBalance {
  customerId: string;
  /** Unpaid part of the balance the customer started with. */
  openingBalance: number;
  /** Balance carried by credit sales that have not been settled. */
  creditSalesBalance: number;
  /** openingBalance + creditSalesBalance. */
  total: number;
}

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Outstanding balance for every customer of a store, keyed by customer id.
 * Customers without a balance are included with a zero total so callers can
 * treat the map as a complete customer list.
 */
export async function buildCustomerBalances(storeId: string): Promise<Map<string, CustomerBalance>> {
  const balances = new Map<string, CustomerBalance>();
  if (!storeId) return balances;

  const [customers, transactions] = await Promise.all([
    db.customers.where('store_id').equals(storeId).toArray(),
    db.transactions.where('store_id').equals(storeId).toArray(),
  ]);

  for (const customer of customers) {
    balances.set(customer.id, {
      customerId: customer.id,
      openingBalance: toAmount(customer.opening_balance_remaining),
      creditSalesBalance: 0,
      total: toAmount(customer.opening_balance_remaining),
    });
  }

  for (const transaction of transactions) {
    if (transaction.payment_method !== 'credit') continue;
    if (transaction.status !== 'completed') continue;
    const customerId = transaction.customer_id;
    if (!customerId) continue;
    const entry = balances.get(customerId);
    if (!entry) continue;
    // Older credit sales were saved before credit_balance existed, so fall
    // back to the sale total the same way the customer book does.
    const carried = transaction.credit_balance ?? transaction.total_amount;
    entry.creditSalesBalance += toAmount(carried);
    entry.total = entry.openingBalance + entry.creditSalesBalance;
  }

  return balances;
}

/** Total money customers owe the store right now. */
export async function getOutstandingCreditTotal(storeId: string): Promise<number> {
  const balances = await buildCustomerBalances(storeId);
  let total = 0;
  for (const balance of balances.values()) {
    total += balance.total;
  }
  return Math.round(total * 100) / 100;
}
