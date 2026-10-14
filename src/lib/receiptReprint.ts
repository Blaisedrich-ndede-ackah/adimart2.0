/**
 * Rebuild ESC/POS / PDF receipt payloads from a completed local transaction.
 */

import {
  db,
  getTransactionItems,
  type LocalTransaction,
} from './dexie';
import type { ReceiptData } from './printService';
import { printReceipt } from './printService';
import { parseOtherCharges } from './otherCharges';

export async function buildReceiptDataFromTransaction(
  txn: LocalTransaction
): Promise<ReceiptData> {
  const store = await db.stores.get(txn.store_id);
  const items = await getTransactionItems(txn.id);
  const lineSubtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  const discount = txn.discount_applied || 0;
  const otherCharges = parseOtherCharges(txn.other_charges_json);

  return {
    storeName: store?.name || 'Store',
    storeAddress: store?.address || '',
    supportNumber: store?.support_number || '',
    storeLogoUrl: store?.logo_url || '',
    receiptNumber: txn.receipt_number,
    cashierName: txn.cashier_name || '',
    dateTime: new Date(txn.created_at).toLocaleString('en-GH'),
    items: items.map((i) => ({
      name: i.product_name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      subtotal: i.subtotal,
    })),
    subtotal: Math.round(lineSubtotal * 100) / 100,
    discount,
    otherCharges,
    total: txn.total_amount,
    paymentMethod: txn.payment_method,
    cashAmount: txn.cash_amount,
    paystackAmount: txn.paystack_amount,
    manualPaymentAmount: txn.manual_payment_amount,
    paymentReference: txn.payment_reference || txn.paystack_reference,
    customerName: txn.customer_name,
    outstandingBalance: txn.credit_balance,
  };
}

export async function reprintTransactionReceipt(
  txn: LocalTransaction,
  computerPrintWindow?: Window | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await buildReceiptDataFromTransaction(txn);
    return await printReceipt(data, computerPrintWindow);
  } catch (err: unknown) {
    if (computerPrintWindow && !computerPrintWindow.closed) {
      computerPrintWindow.close();
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
