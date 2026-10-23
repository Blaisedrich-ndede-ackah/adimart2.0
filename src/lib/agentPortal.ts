/**
 * Agent portal domain logic: balance, invoice settlement, store activation,
 * withdrawal status, and Supabase sync. Agents authenticate with a PIN, so
 * this stays on the device and uses the same anon Supabase client as the POS.
 */

import { isSupabaseConfigured, supabase } from './supabase';
import { sendSmsViaMnotify } from './mnotify';
import { isValidGhanaPhone, normalizeGhanaPhone } from './platformSettings';
import { SUBSCRIPTION_PACKAGES } from './subscriptionPricing';
import {
  createLocalAgent,
  createLocalAgentCommission,
  createLocalAgentPayment,
  createLocalAgentStore,
  createLocalFollowUp,
  createStoreWithOwner,
  db,
  generateId,
  getLocalAgent,
  getLocalAgentInvoice,
  getLocalAgentWithdrawalRequest,
  getLocalCommissionSettings,
  getLocalProspect,
  hashUserPin,
  listLocalAgentCommissions,
  listLocalAgentInvoices,
  listLocalAgentPayments,
  listLocalAgentWithdrawalRequests,
  listLocalAgents,
  listLocalFollowUps,
  saveLocalCommissionSettings,
  updateLocalAgent,
  updateLocalAgentInvoice,
  updateLocalAgentWithdrawalRequest,
  updateLocalFollowUp,
  updateLocalProspect,
  type AgentPaymentMethod,
  type FollowUpChannel,
  type LocalAgent,
  type LocalAgentCommissionSetting,
  type LocalAgentInvoice,
  type LocalFollowUp,
  type LocalProspect,
  type WithdrawalStatus,
} from './dexie';

const AGENT_BIO_KEY = 'adimat_agent_webauthn';

const SYNC_TABLES = [
  'agents',
  'prospects',
  'follow_ups',
  'agent_stores',
  'agent_invoices',
  'agent_payments',
  'agent_commissions',
  'agent_withdrawal_requests',
] as const;

type SyncTable = (typeof SYNC_TABLES)[number];

export interface AgentBalance {
  earned: number;
  paidOut: number;
  reserved: number;
  payable: number;
  minWithdrawal: number;
  withdrawalFee: number;
}

export interface SettlementResult {
  status: 'partial' | 'paid';
  ownerPin?: string;
  storeId?: string;
  storeName?: string;
  commissionAmount?: number;
  activationError?: string;
}

export interface RegisterAgentInput {
  fullName: string;
  phone: string;
  email: string;
  pin: string;
  commissionPercentage: number;
  momoNumber: string;
  momoNetwork: string;
  momoAccountName: string;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function findSubscriptionPackage(packageId: string) {
  return SUBSCRIPTION_PACKAGES.find((item) => item.id === packageId || item.label === packageId);
}

export function packageMonths(packageId: string): number {
  return findSubscriptionPackage(packageId)?.months ?? 1;
}

export function packagePrice(packageId: string): number {
  return findSubscriptionPackage(packageId)?.baseGhs ?? 0;
}

export async function ensureCommissionSettings(): Promise<LocalAgentCommissionSetting> {
  const existing = await getLocalCommissionSettings();
  if (existing) return existing;
  const settings: LocalAgentCommissionSetting = {
    id: 'main',
    default_commission_percentage: 10,
    min_withdrawal_ghs: 0,
    withdrawal_fee_ghs: 0,
    // Older than any cloud row so a real admin save is not overwritten.
    updated_at: '1970-01-01T00:00:00.000Z',
  };
  await saveLocalCommissionSettings(settings);
  return settings;
}

export async function getAgentBalance(agentId: string): Promise<AgentBalance> {
  const [commissions, withdrawals, settings] = await Promise.all([
    listLocalAgentCommissions(agentId),
    listLocalAgentWithdrawalRequests(agentId),
    ensureCommissionSettings(),
  ]);
  const earned = roundMoney(
    commissions
      .filter((row) => row.status !== 'withheld')
      .reduce((sum, row) => sum + row.commission_amount_ghs, 0)
  );
  const reserved = roundMoney(
    withdrawals
      .filter((row) => row.status === 'pending' || row.status === 'approved' || row.status === 'paid')
      .reduce((sum, row) => sum + row.amount_ghs, 0)
  );
  const paidOut = roundMoney(
    withdrawals
      .filter((row) => row.status === 'paid')
      .reduce((sum, row) => sum + row.amount_ghs, 0)
  );
  return {
    earned,
    paidOut,
    reserved,
    payable: roundMoney(Math.max(0, earned - reserved)),
    minWithdrawal: settings.min_withdrawal_ghs,
    withdrawalFee: settings.withdrawal_fee_ghs,
  };
}

export async function refreshOverdueInvoices(agentId?: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const invoices = await listLocalAgentInvoices(agentId);
  await Promise.all(
    invoices
      .filter(
        (invoice) =>
          (invoice.status === 'issued' || invoice.status === 'partial') &&
          Boolean(invoice.due_date) &&
          String(invoice.due_date) < today
      )
      .map((invoice) => updateLocalAgentInvoice(invoice.id, { status: 'overdue' }))
  );
}

export function generateAgentInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `#INV-${y}${m}${d}-${seq}`;
}

export async function registerAgent(input: RegisterAgentInput): Promise<LocalAgent> {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error('Agent name is required.');
  if (!isValidGhanaPhone(input.phone)) throw new Error('Enter a valid Ghana phone number.');
  if (!/^\d{4}$/.test(input.pin)) throw new Error('PIN must be 4 digits.');
  const rate = Number(input.commissionPercentage);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error('Commission percentage must be between 0 and 100.');
  }
  const phoneKey = normalizeGhanaPhone(input.phone);
  const existing = await listLocalAgents();
  if (existing.some((agent) => normalizeGhanaPhone(agent.phone) === phoneKey)) {
    throw new Error('An agent with this phone number already exists.');
  }
  const now = nowIso();
  const agent: Omit<LocalAgent, 'synced'> = {
    id: generateId(),
    full_name: fullName,
    phone: input.phone.replace(/\D/g, ''),
    email: input.email.trim(),
    pin_hash: await hashUserPin(input.pin),
    momo_number: input.momoNumber.replace(/\D/g, ''),
    momo_network: input.momoNetwork.trim(),
    momo_account_name: input.momoAccountName.trim(),
    commission_percentage: rate,
    status: 'active',
    last_login_at: null,
    created_at: now,
    updated_at: now,
  };
  await createLocalAgent(agent);
  return { ...agent, synced: 0 };
}

export async function scheduleFollowUp(input: {
  prospect: LocalProspect;
  followUpAt: string;
  channel: FollowUpChannel;
  outcome?: string;
}): Promise<void> {
  if (!input.followUpAt) throw new Error('Choose a follow-up date and time.');
  const when = new Date(input.followUpAt);
  if (Number.isNaN(when.getTime())) throw new Error('Follow-up date is not valid.');
  const now = nowIso();
  const row: Omit<LocalFollowUp, 'synced'> = {
    id: generateId(),
    prospect_id: input.prospect.id,
    agent_id: input.prospect.agent_id,
    follow_up_at: when.toISOString(),
    channel: input.channel,
    outcome: input.outcome?.trim() || '',
    status: 'scheduled',
    created_at: now,
    updated_at: now,
  };
  await createLocalFollowUp(row);
  const nextStatus =
    input.prospect.status === 'lead' || input.prospect.status === 'contacted'
      ? 'follow_up'
      : input.prospect.status;
  await updateLocalProspect(input.prospect.id, {
    status: nextStatus,
    next_follow_up_at: row.follow_up_at,
  });
}

export async function completeFollowUp(
  followUp: LocalFollowUp,
  outcome: string,
  status: 'completed' | 'missed'
): Promise<void> {
  const now = nowIso();
  await updateLocalFollowUp(followUp.id, { status, outcome: outcome.trim() });
  const remaining = (await listLocalFollowUps({
    prospectId: followUp.prospect_id,
    status: 'scheduled',
  })).filter((row) => row.id !== followUp.id);
  const prospect = await getLocalProspect(followUp.prospect_id);
  const patch: Partial<LocalProspect> = {
    last_contacted_at: now,
    next_follow_up_at: remaining[0]?.follow_up_at ?? null,
  };
  if (prospect && prospect.status !== 'converted' && prospect.status !== 'lost') {
    patch.status = remaining.length > 0 ? 'follow_up' : status === 'completed' ? 'contacted' : prospect.status;
  }
  await updateLocalProspect(followUp.prospect_id, patch);
}

function addMonths(from: Date, months: number): string {
  const next = new Date(from.getTime());
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
}

function randomOwnerPin(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(1000 + (bytes[0] % 9000));
}

async function publishActivatedStore(
  storeId: string,
  ownerId: string
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const store = await db.stores.get(storeId);
  const owner = await db.users.get(ownerId);
  if (!store || !owner) return 'Store was saved on this device, but the cloud copy is missing.';

  const storePayload = {
    id: store.id,
    name: store.name,
    address: store.address,
    support_number: store.support_number,
    discount_cap_percentage: store.discount_cap_percentage,
    pin_on_discount_enabled: store.pin_on_discount_enabled === 1,
    discount_allow_percentage: (store.discount_allow_percentage ?? 1) === 1,
    discount_allow_fixed: (store.discount_allow_fixed ?? 1) === 1,
    cashier_can_discount: (store.cashier_can_discount ?? 1) === 1,
    session_timeout_minutes: store.session_timeout_minutes ?? 5,
    momo_account_name: store.momo_account_name || '',
    momo_number: store.momo_number || '',
    momo_network: store.momo_network || '',
    subscription_started_at: store.subscription_started_at,
    subscription_expires_at: store.subscription_expires_at,
    subscription_months_granted: store.subscription_months_granted ?? 0,
    access_blocked: store.access_blocked === 1,
    currency_code: store.currency_code || 'GHS',
    preferred_language: store.preferred_language === 'fr' ? 'fr' : 'en',
    created_at: store.created_at,
  };
  const storeWrite = await supabase.from('stores').upsert(storePayload, { onConflict: 'id' });
  if (storeWrite.error) return storeWrite.error.message;

  const userWrite = await supabase.from('users').upsert(
    {
      id: owner.id,
      store_id: owner.store_id,
      name: owner.name,
      role: owner.role,
      pin_hash: owner.pin_hash,
      is_active: owner.is_active === 1,
      phone: owner.phone || '',
      can_wholesale: true,
      can_sell_from_warehouse: true,
      can_manage_ecommerce: true,
      can_access_cashbook: true,
      created_at: owner.created_at,
    },
    { onConflict: 'id' }
  );
  if (userWrite.error) return userWrite.error.message;
  await db.stores.update(storeId, { synced: 1 });
  await db.users.update(ownerId, { synced: 1, pin_dirty: 0 });
  return null;
}

async function activateProspect(
  prospect: LocalProspect,
  agentId: string
): Promise<{ ownerPin: string; storeId: string; storeName: string; cloudError: string | null }> {
  const ownerPin = randomOwnerPin();
  const months = packageMonths(prospect.subscription_package);
  const started = new Date();
  const address = [prospect.address, prospect.city].filter(Boolean).join(', ');
  const { store, owner } = await createStoreWithOwner(
    prospect.store_name,
    prospect.owner_full_name,
    ownerPin,
    {
      address,
      supportNumber: prospect.owner_phone,
      ownerPhone: prospect.owner_phone,
      setAsCurrent: false,
    }
  );
  const expires = addMonths(started, months);
  await db.stores.update(store.id, {
    subscription_started_at: started.toISOString(),
    subscription_expires_at: expires,
    subscription_months_granted: months,
    synced: 0,
  });
  const now = nowIso();
  await createLocalAgentStore({
    id: store.id,
    agent_id: agentId,
    prospect_id: prospect.id,
    name: prospect.store_name,
    owner_phone: prospect.owner_phone,
    owner_email: prospect.owner_email,
    address: prospect.address,
    city: prospect.city,
    business_type: prospect.business_type,
    subscription_package: prospect.subscription_package,
    status: 'active',
    activated_at: now,
    subscription_expires_at: expires,
    momo_account_name: '',
    momo_number: '',
    momo_network: '',
    access_blocked: 0,
    created_at: now,
    updated_at: now,
  });
  await updateLocalProspect(prospect.id, {
    status: 'converted',
    last_contacted_at: now,
  });
  const cloudError = await publishActivatedStore(store.id, owner.id);
  return { ownerPin, storeId: store.id, storeName: store.name, cloudError };
}

export async function settleAgentInvoice(input: {
  invoiceId: string;
  amountGhs: number;
  method: AgentPaymentMethod;
  reference?: string;
  notes?: string;
}): Promise<SettlementResult> {
  const invoice = await getLocalAgentInvoice(input.invoiceId);
  if (!invoice) throw new Error('Invoice not found.');
  if (invoice.status === 'paid' || invoice.status === 'cancelled') {
    throw new Error('This invoice is already closed.');
  }
  const amount = roundMoney(input.amountGhs);
  if (!(amount > 0)) throw new Error('Enter a payment amount.');
  const existing = await listLocalAgentPayments(invoice.id);
  const already = roundMoney(existing.reduce((sum, row) => sum + row.amount_ghs, 0));
  const due = roundMoney(invoice.amount_ghs - already);
  if (amount > due + 0.001) {
    throw new Error(`Payment is above the ${due.toFixed(2)} GHS still due.`);
  }

  const now = nowIso();
  await createLocalAgentPayment({
    id: generateId(),
    invoice_id: invoice.id,
    agent_id: invoice.agent_id,
    amount_ghs: amount,
    payment_method: input.method,
    reference: (input.reference || '').trim(),
    paid_at: now,
    notes: input.notes?.trim() || '',
    created_at: now,
  });

  const fullyPaid = already + amount + 0.001 >= invoice.amount_ghs;
  await updateLocalAgentInvoice(invoice.id, {
    status: fullyPaid ? 'paid' : 'partial',
    paystack_reference:
      input.method === 'paystack' ? (input.reference || invoice.paystack_reference) : invoice.paystack_reference,
  });
  if (!fullyPaid) return { status: 'partial' };

  const agent = await getLocalAgent(invoice.agent_id);
  const rate = agent?.commission_percentage ?? 10;
  const commissions = await listLocalAgentCommissions(invoice.agent_id);
  let commissionAmount = 0;
  if (!commissions.some((row) => row.invoice_id === invoice.id)) {
    commissionAmount = roundMoney((invoice.amount_ghs * rate) / 100);
    await createLocalAgentCommission({
      id: generateId(),
      agent_id: invoice.agent_id,
      invoice_id: invoice.id,
      commission_rate_percentage: rate,
      commission_amount_ghs: commissionAmount,
      status: 'accrued',
      created_at: now,
      paid_at: null,
    });
  }

  const prospect = await getLocalProspect(invoice.prospect_id);
  if (!prospect || prospect.status === 'converted') {
    return { status: 'paid', commissionAmount };
  }
  try {
    const activated = await activateProspect(prospect, invoice.agent_id);
    return {
      status: 'paid',
      commissionAmount,
      ownerPin: activated.ownerPin,
      storeId: activated.storeId,
      storeName: activated.storeName,
      activationError: activated.cloudError || undefined,
    };
  } catch (error) {
    return {
      status: 'paid',
      commissionAmount,
      activationError: error instanceof Error ? error.message : 'Store activation failed.',
    };
  }
}

export async function setWithdrawalStatus(
  id: string,
  status: Exclude<WithdrawalStatus, 'pending'>,
  extra: { reason?: string; payoutReference?: string } = {}
): Promise<void> {
  const row = await getLocalAgentWithdrawalRequest(id);
  if (!row) throw new Error('Withdrawal request not found.');
  if (status === 'rejected' && !extra.reason?.trim()) {
    throw new Error('A rejection reason is required.');
  }
  if (status === 'paid' && !extra.payoutReference?.trim()) {
    throw new Error('Enter the Mobile Money payout reference.');
  }
  if (status === 'approved' && row.status !== 'pending') {
    throw new Error('Only a pending request can be approved.');
  }
  if (status === 'paid' && row.status !== 'approved' && row.status !== 'pending') {
    throw new Error('This request cannot be marked paid.');
  }
  if (status === 'rejected' && (row.status === 'paid' || row.status === 'rejected')) {
    throw new Error('This request is already closed.');
  }
  await updateLocalAgentWithdrawalRequest(id, {
    status,
    rejection_reason: status === 'rejected' ? extra.reason!.trim() : row.rejection_reason,
    payout_reference: status === 'paid' ? extra.payoutReference!.trim() : row.payout_reference,
    processed_at: nowIso(),
  });
  const agent = await getLocalAgent(row.agent_id);
  if (!agent?.phone) return;
  const label =
    status === 'approved'
      ? `approved. Net payout ${row.net_amount_ghs.toFixed(2)} GHS will be sent to ${row.momo_number}.`
      : status === 'paid'
        ? `paid to ${row.momo_number}. Reference ${extra.payoutReference?.trim()}.`
        : `rejected. ${extra.reason?.trim()}`;
  await sendSmsViaMnotify(
    agent.phone,
    `Adimat: your withdrawal of GHS ${row.amount_ghs.toFixed(2)} was ${label}`
  );
}

function cloudRow(table: SyncTable, row: Record<string, unknown>): Record<string, unknown> {
  const { synced: _synced, ...rest } = row;
  if (table === 'agent_stores') {
    return { ...rest, access_blocked: Number(row.access_blocked) === 1 };
  }
  return rest;
}

function localRow(table: SyncTable, row: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row, synced: 1 };
  if (table === 'agent_stores') {
    next.access_blocked = Boolean(row.access_blocked) ? 1 : 0;
  }
  return next;
}

function missingTable(message: string): boolean {
  return /does not exist|schema cache|PGRST205|Could not find the table/i.test(message);
}

export async function syncAgentPortal(): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: true, message: 'Saved on this device. Cloud sync is not configured.' };
  }
  try {
    let pushed = 0;
    let pulled = 0;
    for (const table of SYNC_TABLES) {
      const dirty = await db.table(table).filter((row) => row.synced === 0).toArray();
      if (dirty.length === 0) continue;
      const payload = dirty.map((row) => cloudRow(table, row as unknown as Record<string, unknown>));
      const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
      if (error) {
        if (missingTable(error.message)) {
          return {
            success: false,
            message: 'Run supabase-migrate-agent-portal.sql in the Supabase SQL editor, then sync again.',
          };
        }
        return { success: false, message: `${table}: ${error.message}` };
      }
      await Promise.all(dirty.map((row) => db.table(table).update(row.id, { synced: 1 })));
      pushed += dirty.length;
    }

    const localSettings = await getLocalCommissionSettings();
    const remoteSettings = await supabase
      .from('agent_commission_settings')
      .select('*')
      .eq('id', 'main')
      .maybeSingle();
    if (remoteSettings.error && !missingTable(remoteSettings.error.message)) {
      return { success: false, message: `commission settings: ${remoteSettings.error.message}` };
    }
    const remoteUpdated = remoteSettings.data ? String(remoteSettings.data.updated_at || '') : '';
    const localUpdated = localSettings?.updated_at || '';
    if (remoteSettings.data && (!localSettings || remoteUpdated > localUpdated)) {
      await saveLocalCommissionSettings({
        id: 'main',
        default_commission_percentage: Number(remoteSettings.data.default_commission_percentage) || 10,
        min_withdrawal_ghs: Number(remoteSettings.data.min_withdrawal_ghs) || 0,
        withdrawal_fee_ghs: Number(remoteSettings.data.withdrawal_fee_ghs) || 0,
        updated_at: remoteUpdated || nowIso(),
      });
      pulled += 1;
    } else if (localSettings && (!remoteSettings.data || localUpdated > remoteUpdated)) {
      const { error } = await supabase.from('agent_commission_settings').upsert(localSettings, { onConflict: 'id' });
      if (error && !missingTable(error.message)) {
        return { success: false, message: `commission settings: ${error.message}` };
      }
      pushed += 1;
    }

    for (const table of SYNC_TABLES) {
      const { data, error } = await supabase.from(table).select('*');
      if (error) {
        if (missingTable(error.message)) {
          return {
            success: false,
            message: 'Run supabase-migrate-agent-portal.sql in the Supabase SQL editor, then sync again.',
          };
        }
        return { success: false, message: `${table}: ${error.message}` };
      }
      for (const remote of data || []) {
        const id = String((remote as { id: string }).id);
        const current = await db.table(table).get(id);
        if (current && current.synced === 0) continue;
        await db.table(table).put(localRow(table, remote as Record<string, unknown>) as never);
        pulled += 1;
      }
    }

    return {
      success: true,
      message: pushed || pulled ? `Agent portal synced. Sent ${pushed}, received ${pulled}.` : 'Agent portal is up to date.',
    };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Agent sync failed.' };
  }
}

export async function isAgentBiometricReady(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;
  const stored = localStorage.getItem(AGENT_BIO_KEY);
  if (!stored) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerAgentBiometric(agentId: string, agentName: string): Promise<void> {
  if (!window.PublicKeyCredential) throw new Error('This device does not support biometric unlock.');
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Adimat Agent Portal', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(agentId),
        name: agentName,
        displayName: agentName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Biometric setup was cancelled.');
  const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
  localStorage.setItem(AGENT_BIO_KEY, JSON.stringify({ id: credentialId, agentId }));
}

export async function unlockAgentWithBiometric(): Promise<string> {
  const stored = localStorage.getItem(AGENT_BIO_KEY);
  if (!stored) throw new Error('Set up biometric unlock after you sign in with your PIN.');
  const parsed = JSON.parse(stored) as { id?: string; agentId?: string };
  if (!parsed.id || !parsed.agentId) throw new Error('Biometric unlock is not set up on this device.');
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const raw = Uint8Array.from(atob(parsed.id), (char) => char.charCodeAt(0));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: raw, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error('Biometric unlock was cancelled.');
  return parsed.agentId;
}

export function invoicePdfPayload(
  invoice: LocalAgentInvoice,
  agent: LocalAgent | null,
  prospect: LocalProspect | undefined
) {
  return {
    invoiceNumber: invoice.invoice_number,
    agentName: agent?.full_name || 'Agent',
    agentPhone: agent?.phone || '',
    storeName: prospect?.store_name || 'Store',
    ownerName: prospect?.owner_full_name || 'Owner',
    ownerPhone: prospect?.owner_phone || '',
    subscriptionPackage: prospect?.subscription_package || '—',
    amountGhs: invoice.amount_ghs,
    dueDate: invoice.due_date ?? null,
    description: invoice.description,
    paystackReference: invoice.paystack_reference || undefined,
    status: invoice.status,
    generatedAt: invoice.created_at,
  };
}
