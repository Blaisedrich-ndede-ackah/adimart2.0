/**
 * Admin review of Paystack payments that were collected but never applied.
 */

import { generateId } from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { applySubscriptionGrant } from '@/lib/subscriptionPayments';
import { creditStoreSms } from '@/lib/smsWallet';

export type PaystackApprovalKind = 'subscription' | 'sms' | 'shop' | 'sale';

export interface PendingPaystackPayment {
  id: string;
  kind: PaystackApprovalKind;
  storeId: string;
  storeName: string;
  reference: string;
  amountGhs: number;
  detail: string;
  createdAt: string;
  customerId?: string;
  months?: number;
}

function missingTable(message: string): boolean {
  return /does not exist|schema cache|PGRST205|permission denied|42501/i.test(message);
}

async function storeNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('stores').select('id, name');
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row) => [String(row.id), String(row.name || 'Store')]));
}

export async function loadPendingPaystackPayments(): Promise<{ rows: PendingPaystackPayment[]; notes: string[] }> {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.');
  const names = await storeNames();
  const notes: string[] = [];
  const rows: PendingPaystackPayment[] = [];

  const subscriptions = await supabase
    .from('subscription_payments')
    .select('id, store_id, package_id, months, amount_ghs, paystack_reference, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  if (subscriptions.error) {
    if (!missingTable(subscriptions.error.message)) notes.push(`Subscriptions: ${subscriptions.error.message}`);
  } else {
    for (const row of subscriptions.data || []) {
      rows.push({
        id: String(row.id),
        kind: 'subscription',
        storeId: String(row.store_id),
        storeName: names.get(String(row.store_id)) || 'Store',
        reference: String(row.paystack_reference || ''),
        amountGhs: Number(row.amount_ghs) || 0,
        detail: `${row.package_id || 'Plan'} · ${row.months || 1} month(s)`,
        createdAt: String(row.created_at || ''),
        months: Number(row.months) || 1,
      });
    }
  }

  const sms = await supabase
    .from('sms_topup_intents')
    .select('id, store_id, reference, amount_pesewas, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  if (sms.error) {
    if (!missingTable(sms.error.message)) notes.push(`SMS credit: ${sms.error.message}`);
  } else {
    for (const row of sms.data || []) {
      rows.push({
        id: String(row.id),
        kind: 'sms',
        storeId: String(row.store_id),
        storeName: names.get(String(row.store_id)) || 'Store',
        reference: String(row.reference || ''),
        amountGhs: (Number(row.amount_pesewas) || 0) / 100,
        detail: 'SMS credit top-up',
        createdAt: String(row.created_at || ''),
      });
    }
  }

  const shop = await supabase
    .from('shop_payment_intents')
    .select('id, store_id, customer_id, reference, purpose, amount_pesewas, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  if (shop.error) {
    if (!missingTable(shop.error.message)) notes.push(`Shop payments: ${shop.error.message}`);
  } else {
    for (const row of shop.data || []) {
      rows.push({
        id: String(row.id),
        kind: 'shop',
        storeId: String(row.store_id),
        storeName: names.get(String(row.store_id)) || 'Store',
        reference: String(row.reference || ''),
        amountGhs: (Number(row.amount_pesewas) || 0) / 100,
        detail: row.purpose === 'checkout' ? 'Online shop checkout' : 'Customer wallet top-up',
        createdAt: String(row.created_at || ''),
        customerId: row.customer_id ? String(row.customer_id) : undefined,
      });
    }
  }

  const sales = await supabase
    .from('transactions')
    .select('id, store_id, receipt_number, paystack_reference, paystack_amount, payment_method, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);
  if (sales.error) {
    if (!missingTable(sales.error.message)) notes.push(`Sales: ${sales.error.message}`);
  } else {
    for (const row of sales.data || []) {
      const amount = Number(row.paystack_amount) || 0;
      const method = String(row.payment_method || '');
      const reference = String(row.paystack_reference || '');
      if (amount <= 0 && method !== 'paystack' && !reference) continue;
      rows.push({
        id: String(row.id),
        kind: 'sale',
        storeId: String(row.store_id),
        storeName: names.get(String(row.store_id)) || 'Store',
        reference: reference || String(row.receipt_number || ''),
        amountGhs: amount,
        detail: `Sale ${row.receipt_number || ''} · ${method || 'paystack'}`,
        createdAt: String(row.created_at || ''),
      });
    }
  }

  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rows, notes };
}

async function approveSubscription(row: PendingPaystackPayment): Promise<string> {
  const { data: store, error } = await supabase
    .from('stores')
    .select('id, name, support_number, subscription_expires_at, subscription_started_at, subscription_months_granted')
    .eq('id', row.storeId)
    .maybeSingle();
  if (error || !store) throw new Error(error?.message || 'Store not found.');
  const months = Math.max(1, row.months || 1);
  const grant = await applySubscriptionGrant({
    storeId: row.storeId,
    storeName: String(store.name || row.storeName),
    ownerPhone: String(store.support_number || ''),
    months,
    notes: `Admin confirmed Paystack ${row.reference}`,
    currentExpiresAt: store.subscription_expires_at ? String(store.subscription_expires_at) : null,
    currentStartedAt: store.subscription_started_at ? String(store.subscription_started_at) : null,
    currentMonthsGranted: Number(store.subscription_months_granted) || 0,
  });
  if (!grant.success) throw new Error(grant.error || 'Could not activate the subscription.');
  await supabase
    .from('subscription_payments')
    .update({ status: 'success', completed_at: new Date().toISOString() })
    .eq('id', row.id);
  return `${row.storeName} subscription extended by ${months} month(s).`;
}

async function approveSms(row: PendingPaystackPayment): Promise<string> {
  const pesewas = Math.round(row.amountGhs * 100);
  await creditStoreSms(row.storeId, pesewas, row.reference);
  await supabase
    .from('sms_topup_intents')
    .update({ status: 'paid', verified_at: new Date().toISOString() })
    .eq('id', row.id);
  return `GH₵ ${row.amountGhs.toFixed(2)} SMS credit added for ${row.storeName}.`;
}

async function creditShopWallet(row: PendingPaystackPayment): Promise<void> {
  if (!row.customerId) throw new Error('This shop payment has no customer to credit.');
  const amount = Math.round(row.amountGhs * 100) / 100;
  const rpc = await supabase.rpc('post_shop_wallet_entry', {
    p_store: row.storeId,
    p_customer: row.customerId,
    p_type: 'topup',
    p_direction: 'credit',
    p_amount: amount,
    p_reference: row.reference,
    p_description: 'Admin confirmed Paystack payment',
    p_order: null,
  });
  if (!rpc.error) return;
  if (!/permission denied|42501|could not find the function|schema cache|does not exist/i.test(rpc.error.message)) {
    throw new Error(rpc.error.message);
  }
  const current = await supabase.from('customers').select('wallet_balance').eq('id', row.customerId).maybeSingle();
  if (current.error || !current.data) throw new Error(current.error?.message || 'Customer not found.');
  const next = Math.round(((Number(current.data.wallet_balance) || 0) + amount) * 100) / 100;
  const updated = await supabase.from('customers').update({ wallet_balance: next }).eq('id', row.customerId);
  if (updated.error) throw new Error(updated.error.message);
  await supabase.from('shop_wallet_entries').insert({
    id: generateId(),
    store_id: row.storeId,
    customer_id: row.customerId,
    entry_type: 'topup',
    direction: 'credit',
    amount,
    balance_after: next,
    payment_reference: row.reference,
    description: 'Admin confirmed Paystack payment',
  });
}

async function approveShop(row: PendingPaystackPayment): Promise<string> {
  await creditShopWallet(row);
  const updated = await supabase
    .from('shop_payment_intents')
    .update({ status: 'verified', verified_at: new Date().toISOString() })
    .eq('id', row.id);
  if (updated.error && !missingTable(updated.error.message)) throw new Error(updated.error.message);
  return `GH₵ ${row.amountGhs.toFixed(2)} reflected for ${row.storeName}.`;
}

async function approveSale(row: PendingPaystackPayment): Promise<string> {
  const { error } = await supabase
    .from('transactions')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  return `Sale ${row.reference} marked completed for ${row.storeName}.`;
}

export async function approvePaystackPayment(row: PendingPaystackPayment): Promise<string> {
  if (row.kind === 'subscription') return approveSubscription(row);
  if (row.kind === 'sms') return approveSms(row);
  if (row.kind === 'shop') return approveShop(row);
  return approveSale(row);
}
