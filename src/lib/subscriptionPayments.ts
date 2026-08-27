/**
 * Self-serve subscription payment + automatic plan extension after Paystack success.
 */

import { generateId, db, type LocalStore } from './dexie';
import { isSupabaseConfigured, supabase } from './supabase';
import { addMonthsIso, getSubscriptionInfo } from './subscription';
import { notifySubscriptionActivated } from './mnotify';
import {
  getSubscriptionPackage,
  priceForPackage,
  getBillableUnits,
  type SubscriptionPackage,
} from './subscriptionPricing';

export interface SubscriptionPaymentRow {
  id: string;
  store_id: string;
  package_id: string;
  months: number;
  units: number;
  amount_ghs: number;
  paystack_reference: string;
  status: 'pending' | 'success' | 'failed';
  created_at: string;
  completed_at: string | null;
}

const MAX_GRANT_MONTHS = 48;

/**
 * Extend a store subscription by N months (shared by admin grant + self-serve Paystack).
 */
export async function applySubscriptionGrant(params: {
  storeId: string;
  storeName: string;
  ownerPhone?: string;
  months: number;
  notes?: string;
  currentExpiresAt?: string | null;
  currentStartedAt?: string | null;
  currentMonthsGranted?: number;
}): Promise<{ success: boolean; error?: string; expiresAt?: string; monthsGranted?: number }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }
  const months = Math.floor(Number(params.months));
  if (!Number.isFinite(months) || months < 1 || months > MAX_GRANT_MONTHS) {
    return { success: false, error: `Months must be between 1 and ${MAX_GRANT_MONTHS}` };
  }

  // Prefer live cloud row so concurrent grants don't clobber each other
  let expiresAt = params.currentExpiresAt ?? null;
  let startedAt = params.currentStartedAt ?? null;
  let monthsGrantedSoFar = params.currentMonthsGranted ?? 0;

  try {
    const { data } = await supabase
      .from('stores')
      .select(
        'subscription_expires_at, subscription_started_at, subscription_months_granted, name, support_number, momo_number'
      )
      .eq('id', params.storeId)
      .maybeSingle();
    if (data) {
      expiresAt = data.subscription_expires_at ? String(data.subscription_expires_at) : expiresAt;
      startedAt = data.subscription_started_at ? String(data.subscription_started_at) : startedAt;
      monthsGrantedSoFar = Number(data.subscription_months_granted) || monthsGrantedSoFar;
    }
  } catch {
    // offline / RLS — use local params
  }

  const nowIso = new Date().toISOString();
  const info = getSubscriptionInfo(expiresAt, startedAt);
  const baseIso = info.status === 'active' && expiresAt ? expiresAt : nowIso;
  const periodStart = baseIso;
  const periodEnd = addMonthsIso(baseIso, months);
  const newStartedAt = info.status === 'active' && startedAt ? startedAt : nowIso;
  const monthsGranted = monthsGrantedSoFar + months;

  const { error: updateError } = await supabase
    .from('stores')
    .update({
      subscription_started_at: newStartedAt,
      subscription_expires_at: periodEnd,
      subscription_months_granted: monthsGranted,
      access_blocked: false,
    })
    .eq('id', params.storeId);

  let grantUpdateError = updateError;
  if (grantUpdateError?.message?.includes('access_blocked')) {
    const retry = await supabase
      .from('stores')
      .update({
        subscription_started_at: newStartedAt,
        subscription_expires_at: periodEnd,
        subscription_months_granted: monthsGranted,
      })
      .eq('id', params.storeId);
    grantUpdateError = retry.error;
  }

  if (grantUpdateError) {
    return {
      success: false,
      error: grantUpdateError.message.includes('subscription_')
        ? `${grantUpdateError.message} — run supabase-migrate-subscriptions.sql in Supabase.`
        : grantUpdateError.message,
    };
  }

  // Mirror locally so UI updates immediately
  const local = await db.stores.get(params.storeId);
  if (local) {
    await db.stores.put({
      ...local,
      subscription_started_at: newStartedAt,
      subscription_expires_at: periodEnd,
      subscription_months_granted: monthsGranted,
      access_blocked: 0,
      synced: 0,
    });
  }

  const grantPayload = {
    id: generateId(),
    store_id: params.storeId,
    months,
    period_start: periodStart,
    period_end: periodEnd,
    notes: (params.notes || '').slice(0, 500),
    granted_at: nowIso,
  };

  const { error: grantError } = await supabase.from('subscription_grants').insert(grantPayload);
  if (grantError) {
    void notifySubscriptionActivated({
      storeId: params.storeId,
      storeName: params.storeName,
      ownerPhone: params.ownerPhone || '',
      months,
      expiresAt: periodEnd,
    });
    return {
      success: true,
      expiresAt: periodEnd,
      monthsGranted,
      error: `Subscription saved, but grant history failed: ${grantError.message}`,
    };
  }

  void notifySubscriptionActivated({
    storeId: params.storeId,
    storeName: params.storeName,
    ownerPhone: params.ownerPhone || '',
    months,
    expiresAt: periodEnd,
  });

  return { success: true, expiresAt: periodEnd, monthsGranted };
}

async function findPaymentByReference(
  reference: string
): Promise<SubscriptionPaymentRow | null> {
  if (!isSupabaseConfigured() || !reference) return null;
  const { data, error } = await supabase
    .from('subscription_payments')
    .select('*')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (error || !data) return null;
  return data as SubscriptionPaymentRow;
}

/**
 * After Paystack Inline reports success: record payment (idempotent) and grant months.
 */
export async function completeSubscriptionPayment(params: {
  store: LocalStore;
  packageId: string;
  paystackReference: string;
  ownerPhone?: string;
}): Promise<{ success: boolean; error?: string; expiresAt?: string; alreadyProcessed?: boolean }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  const pkg = getSubscriptionPackage(params.packageId);
  if (!pkg) {
    return { success: false, error: 'Unknown subscription package' };
  }

  const reference = params.paystackReference.trim();
  if (!reference) {
    return { success: false, error: 'Missing Paystack reference' };
  }

  const existing = await findPaymentByReference(reference);
  if (existing?.status === 'success') {
    return {
      success: true,
      alreadyProcessed: true,
      expiresAt: params.store.subscription_expires_at || undefined,
    };
  }

  const billable = getBillableUnits(params.store);
  const priced = priceForPackage(pkg, billable.units);
  const nowIso = new Date().toISOString();

  if (!existing) {
    const insertPayload = {
      id: generateId(),
      store_id: params.store.id,
      package_id: pkg.id,
      months: pkg.months,
      units: priced.units,
      amount_ghs: priced.ghs,
      paystack_reference: reference,
      status: 'pending',
      created_at: nowIso,
      completed_at: null,
    };
    const { error: insertError } = await supabase
      .from('subscription_payments')
      .insert(insertPayload);
    if (insertError) {
      // Unique race — another tab may have inserted; continue if we can load it
      const raced = await findPaymentByReference(reference);
      if (!raced) {
        return {
          success: false,
          error: insertError.message.includes('subscription_payments')
            ? `${insertError.message} — run supabase-migrate-subscription-payments.sql in Supabase.`
            : insertError.message,
        };
      }
      if (raced.status === 'success') {
        return {
          success: true,
          alreadyProcessed: true,
          expiresAt: params.store.subscription_expires_at || undefined,
        };
      }
    }
  }

  const grant = await applySubscriptionGrant({
    storeId: params.store.id,
    storeName: params.store.name,
    ownerPhone: params.ownerPhone || params.store.support_number || '',
    months: pkg.months,
    notes: `Self-serve Paystack ${pkg.id} · ref ${reference} · ${priced.units} unit(s) · GH₵${priced.ghs}`,
    currentExpiresAt: params.store.subscription_expires_at,
    currentStartedAt: params.store.subscription_started_at,
    currentMonthsGranted: params.store.subscription_months_granted,
  });

  if (!grant.success) {
    await supabase
      .from('subscription_payments')
      .update({ status: 'failed', completed_at: nowIso })
      .eq('paystack_reference', reference);
    return { success: false, error: grant.error || 'Failed to activate subscription' };
  }

  await supabase
    .from('subscription_payments')
    .update({ status: 'success', completed_at: new Date().toISOString() })
    .eq('paystack_reference', reference);

  return { success: true, expiresAt: grant.expiresAt };
}

export function buildSubscriptionPaystackMetadata(
  store: LocalStore,
  pkg: SubscriptionPackage,
  units: number
): Record<string, unknown> {
  return {
    payment_for: 'Subscription',
    store_id: store.id,
    store_name: store.name,
    package_id: pkg.id,
    months: pkg.months,
    units,
  };
}
