import Dexie, { Table } from 'dexie';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { isSupabaseConfigured, supabase, testSupabaseConnection } from './supabase';
import { isAdminSuperPin } from './superPin';
import { toMoneyAmount } from './money';
import { formatUnknownError, isUuid, uuidOrNull } from './ids';
import { cashbookAccessFromCloud, optionalStaffFlag } from './staffAccess';
import { normalizeSessionTimeoutMinutes } from './sessionTimeout';
import {
  DEFAULT_DEBT_REMINDER_INTERVAL_DAYS,
  DEFAULT_DEBT_REMINDER_TEMPLATE,
  normalizeDebtReminderIntervalDays,
  normalizeDebtReminderMinBalance,
} from './debtReminderConfig';
import type { PaymentMethod } from './paymentMethods';
import type {
  LocalCannedReply,
  LocalSupportMessage,
  LocalSupportNotification,
  LocalSupportTicket,
} from './support/types';

// Store represents a business/shop
export interface LocalStore {
  id: string;
  name: string;
  address: string;
  support_number: string;
  discount_cap_percentage: number;
  pin_on_discount_enabled: number;
  /** Allow percentage discounts at checkout (0/1) */
  discount_allow_percentage?: number;
  /** Allow fixed-amount discounts at checkout (0/1) */
  discount_allow_fixed?: number;
  /** Allow cashiers to apply discounts (0/1); owners always can */
  cashier_can_discount?: number;
  /** Idle minutes before staff return to the PIN screen. 0 = never. Default 5. */
  session_timeout_minutes?: number;
  /** Preferred Mobile Money account name for Paystack payouts */
  momo_account_name: string;
  /** Preferred Mobile Money number (e.g. 024XXXXXXX) */
  momo_number: string;
  /** Network hint: MTN | Vodafone | AirtelTigo | Other */
  momo_network: string;
  /** Admin-managed subscription period start (ISO); pulled from cloud */
  subscription_started_at?: string | null;
  /** Admin-managed subscription expiry (ISO); pulled from cloud */
  subscription_expires_at?: string | null;
  /** Cumulative months granted by admin */
  subscription_months_granted?: number;
  /** Admin lock: store must pay a package before using the POS (0/1) */
  access_blocked?: number;
  /** Optional compressed JPEG data URL for store logo */
  logo_url?: string;
  warehouse_enabled?: number;
  max_shops?: number;
  max_warehouses?: number;
  /** Admin-managed cap on how many business stores this owner may create */
  max_stores?: number;
  /** Admin-granted public e-commerce storefront */
  ecommerce_enabled?: number;
  /** Public URL slug: #/shop/{slug} */
  ecommerce_slug?: string;
  ecommerce_tagline?: string;
  /** Store-owner-managed external storefront links as a JSON array. */
  ecommerce_links?: string;
  /** Display currency for this store only (prices, receipts, reports). */
  currency_code?: string;
  /** Default language for devices that have not chosen one yet. */
  preferred_language?: string;
  /** Super-admin wipe of trial sales; drop local ledger rows at or before this ISO time */
  transactions_cleared_at?: string | null;
  /** Send automatic debt reminder SMS to customers with an outstanding balance (0/1) */
  debt_reminders_enabled?: number;
  /** Days between automated reminders for the same customer. */
  debt_reminder_interval_days?: number;
  /** Only remind customers whose balance is at least this amount. */
  debt_reminder_min_balance?: number;
  /** Reminder template. Supports {name}, {store}, {balance}. */
  debt_reminder_message?: string;
  /** Owner-set daily sales target used by the live dashboard. */
  sales_target_daily?: number;
  /** Owner-set monthly sales target used by the live dashboard. */
  sales_target_monthly?: number;
  /** When 0, cashier sessions hide on-hand quantities. Owners always see them. Default 1. */
  cashiers_can_view_stock?: number;
  created_at: string;
  synced: number;
}

export interface LocalProductCategory {
  id: string;
  store_id: string;
  name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalCustomer {
  id: string;
  store_id: string;
  name: string;
  phone: string;
  /** Preferred drop-off / service location (shop or warehouse) */
  location_id?: string | null;
  /** Freeform customer street, neighborhood, or delivery address */
  address?: string;
  opening_balance: number;
  opening_balance_remaining: number;
  wallet_balance?: number;
  is_active: number;
  /** Customer asked not to receive automated debt reminder SMS (0/1) */
  debt_reminder_opt_out?: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalCustomerOpeningPayment {
  id: string;
  store_id: string;
  customer_id: string;
  entry_type: 'opening_balance' | 'payment';
  amount: number;
  payment_method?: 'cash' | 'momo' | 'cheque' | 'split';
  cash_amount?: number;
  momo_amount?: number;
  cheque_amount?: number;
  account_receipt_id?: string | null;
  created_by: string;
  created_at: string;
  synced: number;
}

export interface LocalCustomerAccountReceipt {
  id: string;
  store_id: string;
  customer_id: string;
  receipt_number: string;
  amount: number;
  cash_amount: number;
  momo_amount: number;
  cheque_amount: number;
  balance_before: number;
  balance_after: number;
  created_by: string;
  created_at: string;
  synced: number;
}

export interface LocalUser {
  id: string;
  store_id: string; // Links user to a store
  name: string;
  role: 'owner' | 'cashier';
  pin_hash: string;
  is_active: number;
  /** Ghana phone for SMS PIN reset / multi-store identity */
  phone?: string;
  assigned_location_id?: string | null;
  can_wholesale?: number;
  can_sell_from_warehouse?: number;
  /** Staff may manage online catalog/orders when ecommerce is enabled */
  can_manage_ecommerce?: number;
  /** Cashiers may open Cash Book when 1. Missing = allowed (legacy). Owners always can. */
  can_access_cashbook?: number;
  /** Cashiers may see on-hand quantities when 1. Missing follows the store default. */
  can_view_stock?: number;
  /** Cashiers may apply discounts when 1. Missing follows the store default. */
  can_discount?: number;
  /** Owner-configured POS section order, shared across their signed-in devices. */
  pos_layout_json?: string;
  created_at: string;
  synced: number;
  /** Local only: 1 while a PIN change on this device still has to reach the cloud. */
  pin_dirty?: number;
}

/* ------------------------------------------------------------------ */
/*  Agent Portal local types (offline-first mirror of Supabase tables) */
/* ------------------------------------------------------------------ */

export type AgentStatus = 'active' | 'suspended' | 'inactive';
export type ProspectStatus = 'lead' | 'contacted' | 'follow_up' | 'converted' | 'lost';
export type FollowUpStatus = 'scheduled' | 'completed' | 'missed';
export type FollowUpChannel = 'call' | 'sms' | 'whatsapp' | 'visit' | 'other';
export type AgentStoreStatus = 'pending' | 'active' | 'suspended' | 'inactive';
export type InvoiceStatus = 'issued' | 'paid' | 'partial' | 'overdue' | 'cancelled';
export type AgentPaymentMethod = 'cash' | 'momo' | 'bank_transfer' | 'paystack';
export type CommissionStatus = 'accrued' | 'paid' | 'withheld';
export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface LocalAgent {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  pin_hash: string;
  momo_number: string;
  momo_network: string;
  momo_account_name: string;
  commission_percentage: number;
  status: AgentStatus;
  last_login_at?: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalProspect {
  id: string;
  agent_id: string;
  store_name: string;
  owner_full_name: string;
  owner_phone: string;
  owner_email: string;
  address: string;
  city: string;
  business_type: string;
  subscription_package: string;
  source: string;
  status: ProspectStatus;
  notes: string;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalFollowUp {
  id: string;
  prospect_id: string;
  agent_id: string;
  follow_up_at: string;
  channel: FollowUpChannel;
  outcome: string;
  status: FollowUpStatus;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalAgentStore {
  id: string;
  agent_id: string;
  prospect_id?: string | null;
  name: string;
  owner_phone: string;
  owner_email: string;
  address: string;
  city: string;
  business_type: string;
  subscription_package: string;
  status: AgentStoreStatus;
  activated_at?: string | null;
  subscription_expires_at?: string | null;
  momo_account_name: string;
  momo_number: string;
  momo_network: string;
  access_blocked: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalAgentInvoice {
  id: string;
  invoice_number: string;
  prospect_id: string;
  agent_id: string;
  amount_ghs: number;
  currency_code: string;
  due_date?: string | null;
  status: InvoiceStatus;
  description: string;
  paystack_reference: string;
  pdf_url: string;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalAgentPayment {
  id: string;
  invoice_id: string;
  agent_id: string;
  amount_ghs: number;
  payment_method: AgentPaymentMethod;
  reference: string;
  paid_at: string;
  notes: string;
  created_at: string;
  synced: number;
}

export interface LocalAgentCommission {
  id: string;
  agent_id: string;
  invoice_id: string;
  commission_rate_percentage: number;
  commission_amount_ghs: number;
  status: CommissionStatus;
  created_at: string;
  paid_at?: string | null;
  synced: number;
}

export interface LocalAgentWithdrawalRequest {
  id: string;
  agent_id: string;
  amount_ghs: number;
  fee_ghs: number;
  net_amount_ghs: number;
  momo_number: string;
  momo_network: string;
  momo_account_name: string;
  status: WithdrawalStatus;
  rejection_reason: string;
  payout_reference: string;
  requested_at: string;
  processed_at?: string | null;
  processed_by?: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalAgentCommissionSetting {
  id: string;
  default_commission_percentage: number;
  min_withdrawal_ghs: number;
  withdrawal_fee_ghs: number;
  updated_at: string;
}

export interface LocalProduct {
  id: string;
  store_id: string; // Links product to a store
  name: string;
  category: string;
  sku_type: string;
  barcode: string;
  cost_price: number;
  selling_price: number;
  stock_level: number;
  is_active: number;
  /** Optional compressed JPEG data URL for product photo */
  image_url?: string;
  pack_size?: number;
  track_expiry?: number;
  wholesale_mode?: string;
  wholesale_pack_price?: number;
  wholesale_unit_price?: number;
  wholesale_tiers_json?: string;
  /** List this product on the public e-commerce storefront */
  sell_online?: number;
  reorder_level?: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export type OnlineOrderStatus = 'new' | 'confirmed' | 'fulfilled' | 'cancelled';

export interface LocalOnlineOrder {
  id: string;
  store_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  notes: string;
  status: OnlineOrderStatus;
  payment_method: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalOnlineOrderItem {
  id: string;
  store_id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  created_at: string;
  synced: number;
}

export interface LocalTransaction {
  id: string;
  store_id: string; // Links transaction to a store
  receipt_number: string;
  cashier_id: string;
  cashier_name: string;
  total_amount: number;
  discount_applied: number;
  /** JSON array of extra checkout fees (delivery, packing, service, other) */
  other_charges_json?: string;
  other_charges_total?: number;
  payment_method: PaymentMethod;
  cash_amount: number;
  paystack_amount: number;
  paystack_reference: string;
  manual_payment_amount?: number;
  wallet_amount?: number;
  payment_reference?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_id?: string | null;
  credit_paid_amount?: number;
  credit_balance?: number;
  status: 'completed' | 'pending';
  location_id?: string;
  sale_mode?: 'retail' | 'wholesale' | 'mixed';
  created_at: string;
  updated_at?: string;
  synced: number;
}

export interface LocalTransactionItem {
  id: string;
  store_id: string;
  transaction_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  unit_type?: string;
  pack_size?: number;
  base_quantity?: number;
  sale_mode?: 'retail' | 'wholesale';
  batch_id?: string;
  synced: number;
}

export interface LocalCreditPayment {
  id: string;
  store_id: string;
  customer_id?: string;
  account_receipt_id?: string | null;
  transaction_id: string;
  amount: number;
  payment_method: 'cash' | 'momo' | 'cheque' | 'split';
  cash_amount?: number;
  momo_amount?: number;
  cheque_amount?: number;
  created_by: string;
  created_at: string;
  synced: number;
}

export interface CustomerAccountPaymentAmounts {
  method: 'cash' | 'momo' | 'cheque' | 'split';
  cash: number;
  momo: number;
  cheque: number;
}

export interface LocalSaleReturn {
  id: string;
  store_id: string;
  transaction_id: string;
  transaction_item_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  stock_quantity: number;
  reason: string;
  photo_data_url: string;
  receipt_number: string;
  location_id: string;
  customer_id?: string | null;
  refund_method: 'cash' | 'wallet' | 'account' | 'today_sales' | 'none';
  refund_amount: number;
  debt_applied: number;
  wallet_credit: number;
  created_by: string;
  created_at: string;
  synced: number;
}

export interface LocalCustomerWalletTransaction {
  id: string;
  store_id: string;
  customer_id: string;
  type: 'return_credit' | 'sale_debit' | 'topup' | 'purchase' | 'refund' | 'adjustment';
  amount: number;
  balance_after: number;
  return_id?: string | null;
  transaction_id?: string | null;
  description: string;
  created_by: string;
  created_at: string;
  synced: number;
}

/** Audit row for a store-owner bulk SMS campaign. */
export interface LocalBulkSmsCampaign {
  id: string;
  store_id: string;
  message: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  provider: string;
  provider_message_id?: string;
  status: 'sent' | 'failed' | 'partial';
  error_message?: string;
  created_by?: string;
  created_at: string;
  synced: number;
}

/** Audit row for one automated debt reminder SMS sent to a customer. */
export interface LocalDebtReminder {
  id: string;
  store_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  /** Outstanding balance that was quoted in the message. */
  balance: number;
  message: string;
  provider: string;
  provider_message_id?: string | null;
  status: 'sent' | 'failed' | 'skipped';
  error_message?: string | null;
  sent_at: string;
  created_at: string;
  synced: number;
}

export interface LocalLocation {
  id: string;
  store_id: string;
  name: string;
  location_type: 'shop' | 'warehouse';
  is_default: number;
  is_active: number;
  /** PIN hash required to open/manage warehouse from Settings */
  access_pin_hash?: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalStockBatch {
  id: string;
  store_id: string;
  product_id: string;
  location_id: string;
  batch_code: string;
  expiry_date: string | null;
  quantity: number;
  cost_price: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalStockMovement {
  id: string;
  store_id: string;
  product_id: string;
  batch_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  movement_type: 'receive' | 'transfer' | 'sale' | 'adjust' | 'return';
  quantity: number;
  note: string;
  user_id: string | null;
  created_at: string;
  synced: number;
}

export interface LocalSupplier {
  id: string;
  store_id: string;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  synced: number;
}

export type PurchaseOrderStatus = 'ordered' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrderLine {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  received_quantity: number;
  /** Quantity already sent to a cashier and not yet approved or rejected. */
  pending_quantity?: number;
}

export interface LocalPurchaseOrder {
  id: string;
  store_id: string;
  supplier_id: string;
  order_number: string;
  status: PurchaseOrderStatus;
  items_json: string;
  total_amount: number;
  notes: string;
  created_at: string;
  updated_at: string;
  received_at?: string;
  synced: number;
}

export interface LocalExpense {
  id: string;
  store_id: string;
  description: string;
  category: string;
  amount: number;
  notes: string;
  receipt_image_data_url?: string;
  recurring_expense_id?: string | null;
  recurrence_month?: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalRecurringExpense {
  id: string;
  store_id: string;
  description: string;
  category: string;
  amount: number;
  notes: string;
  day_of_month: number;
  is_active: number;
  last_generated_month: string | null;
  created_at: string;
  updated_at: string;
  synced: number;
}

export interface LocalExpenseBudget {
  id: string;
  store_id: string;
  category: string;
  monthly_limit: number;
  updated_at: string;
  synced: number;
}

interface LocalPinAttempt {
  store_id: string;
  failed_attempts: number;
  locked_until: number;
  updated_at: string;
}

/** Store cash book ledger (manual income / expense entries) */
export interface LocalCashBookEntry {
  id: string;
  store_id: string;
  entry_type: 'income' | 'expense';
  description: string;
  category: string;
  amount: number;
  notes: string;
  /** YYYY-MM-DD for range filters */
  entry_date: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  synced: number;
  account_type?: 'cash' | 'bank';
}

export type StockReceiptKind = 'receive' | 'adjust_in' | 'purchase' | 'opening' | 'count';

/** Goods or stock increases waiting for a cashier to confirm they are physically present. */
export interface LocalStockReceiptRequest {
  id: string;
  store_id: string;
  product_id: string;
  product_name: string;
  location_id: string;
  location_name: string;
  quantity: number;
  kind: StockReceiptKind;
  note: string;
  batch_code: string;
  expiry_date: string | null;
  cost_price: number | null;
  source_id: string | null;
  source_line: string | null;
  requested_by: string | null;
  requested_by_name: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  synced: number;
}

/** Owner-visible record of who approved or rejected a stock arrival. */
export interface LocalStockApprovalLog {
  id: string;
  store_id: string;
  request_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  kind: string;
  decision: 'approved' | 'rejected';
  note: string;
  approved_by: string | null;
  approved_by_name: string;
  approved_at: string;
  synced: number;
}

/** Local copy of a platform activity row. The admin portal reads the cloud table, not this UI. */
export interface LocalActivityLog {
  id: string;
  store_id: string;
  store_name: string;
  user_id: string;
  username: string;
  role: string;
  activity_type: string;
  summary: string;
  details: string;
  logged_in_at: string | null;
  logged_out_at: string | null;
  created_at: string;
  synced: number;
}

export interface SyncMeta {
  id: string;
  last_synced_at: string;
}

export interface AppConfig {
  id: string;
  current_store_id: string | null;
  current_user_id: string | null;
}

export interface CachedCampaigns {
  id: string;
  campaigns: Array<Record<string, unknown>>;
  updated_at: string;
}

/** Tombstones so cloud sync cannot resurrect hard-deleted records */
export interface LocalDeletedRecord {
  id: string;
  store_id: string;
  table_name: 'products';
  record_id: string;
  deleted_at: string;
  synced: number;
}

class AdimatDB extends Dexie {
  stores!: Table<LocalStore, string>;
  users!: Table<LocalUser, string>;
  products!: Table<LocalProduct, string>;
  product_categories!: Table<LocalProductCategory, string>;
  customers!: Table<LocalCustomer, string>;
  customer_opening_payments!: Table<LocalCustomerOpeningPayment, string>;
  transactions!: Table<LocalTransaction, string>;
  transaction_items!: Table<LocalTransactionItem, string>;
  credit_payments!: Table<LocalCreditPayment, string>;
  customer_account_receipts!: Table<LocalCustomerAccountReceipt, string>;
  sales_returns!: Table<LocalSaleReturn, string>;
  customer_wallet_transactions!: Table<LocalCustomerWalletTransaction, string>;
  bulk_sms_campaigns!: Table<LocalBulkSmsCampaign, string>;
  debt_reminders!: Table<LocalDebtReminder, string>;
  expenses!: Table<LocalExpense, string>;
  recurring_expenses!: Table<LocalRecurringExpense, string>;
  expense_budgets!: Table<LocalExpenseBudget, string>;
  pin_attempts!: Table<LocalPinAttempt, string>;
  cash_book_entries!: Table<LocalCashBookEntry, string>;
  locations!: Table<LocalLocation, string>;
  stock_batches!: Table<LocalStockBatch, string>;
  stock_movements!: Table<LocalStockMovement, string>;
  online_orders!: Table<LocalOnlineOrder, string>;
  online_order_items!: Table<LocalOnlineOrderItem, string>;
  suppliers!: Table<LocalSupplier, string>;
  purchase_orders!: Table<LocalPurchaseOrder, string>;
  backup_snapshots!: Table<{ id: string; store_id: string; created_at: string; data_json: string }, string>;
  deleted_records!: Table<LocalDeletedRecord, string>;
  sync_meta!: Table<SyncMeta, string>;
  app_config!: Table<AppConfig, string>;
  campaign_cache!: Table<CachedCampaigns, string>;
  stock_receipt_requests!: Table<LocalStockReceiptRequest, string>;
  stock_approval_logs!: Table<LocalStockApprovalLog, string>;
  activity_logs!: Table<LocalActivityLog, string>;
  support_tickets!: Table<LocalSupportTicket, string>;
  support_messages!: Table<LocalSupportMessage, string>;
  support_canned_replies!: Table<LocalCannedReply, string>;
  support_notifications!: Table<LocalSupportNotification, string>;

  /* Agent Portal tables */
  agents!: Table<LocalAgent, string>;
  prospects!: Table<LocalProspect, string>;
  follow_ups!: Table<LocalFollowUp, string>;
  agent_stores!: Table<LocalAgentStore, string>;
  agent_invoices!: Table<LocalAgentInvoice, string>;
  agent_payments!: Table<LocalAgentPayment, string>;
  agent_commissions!: Table<LocalAgentCommission, string>;
  agent_withdrawal_requests!: Table<LocalAgentWithdrawalRequest, string>;
  agent_commission_settings!: Table<LocalAgentCommissionSetting, string>;

  constructor() {
    super('AdimatPOS');
    this.version(2).stores({
          stores: 'id, synced, warehouse_enabled, max_shops, max_warehouses, max_stores, ecommerce_enabled, ecommerce_slug, ecommerce_tagline, currency_code, preferred_language, subscription_started_at, subscription_expires_at, subscription_months_granted, access_blocked, transactions_cleared_at',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(3).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(4).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(5).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(6).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      deleted_records: 'id, store_id, table_name, record_id, synced, deleted_at',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(7).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      cash_book_entries: 'id, store_id, entry_type, entry_date, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      deleted_records: 'id, store_id, table_name, record_id, synced, deleted_at',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(8).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      cash_book_entries: 'id, store_id, entry_type, entry_date, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      suppliers: 'id, store_id, name, is_active, synced',
      purchase_orders: 'id, store_id, supplier_id, order_number, status, created_at, synced',
      backup_snapshots: 'id, store_id, created_at',
      deleted_records: 'id, store_id, table_name, record_id, synced, deleted_at',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(9).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      recurring_expenses: 'id, store_id, is_active, synced',
      expense_budgets: 'id, store_id, category, synced',
      cash_book_entries: 'id, store_id, entry_type, entry_date, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      suppliers: 'id, store_id, name, is_active, synced',
      purchase_orders: 'id, store_id, supplier_id, order_number, status, created_at, synced',
      backup_snapshots: 'id, store_id, created_at',
      deleted_records: 'id, store_id, table_name, record_id, synced, deleted_at',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(10).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      transactions: 'id, store_id, receipt_number, cashier_id, status, created_at, synced',
      transaction_items: 'id, store_id, transaction_id, product_id, synced',
      expenses: 'id, store_id, category, created_at, synced',
      recurring_expenses: 'id, store_id, is_active, synced',
      expense_budgets: 'id, store_id, category, synced',
      pin_attempts: 'store_id, locked_until',
      cash_book_entries: 'id, store_id, entry_type, entry_date, created_at, synced',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
      online_orders: 'id, store_id, order_number, status, created_at, synced',
      online_order_items: 'id, store_id, order_id, product_id, synced',
      suppliers: 'id, store_id, name, is_active, synced',
      purchase_orders: 'id, store_id, supplier_id, order_number, status, created_at, synced',
      backup_snapshots: 'id, store_id, created_at',
      deleted_records: 'id, store_id, table_name, record_id, synced, deleted_at',
      sync_meta: 'id',
      app_config: 'id',
    });
    this.version(11).stores({
      campaign_cache: 'id',
    });
    this.version(12).stores({
      product_categories: 'id, store_id, name, is_active, synced',
    });
    this.version(13).stores({
      credit_payments: 'id, store_id, transaction_id, created_at, synced',
    });
    this.version(14).stores({
      customers: 'id, store_id, name, phone, is_active, synced',
      customer_opening_payments: 'id, store_id, customer_id, created_at, synced',
    });
    this.version(15).stores({
      transactions: 'id, store_id, receipt_number, cashier_id, customer_id, status, created_at, synced',
    });
    this.version(16).stores({
      customer_account_receipts: 'id, store_id, customer_id, receipt_number, created_at, synced',
      sales_returns: 'id, store_id, transaction_id, transaction_item_id, product_id, created_at, synced',
      credit_payments: 'id, store_id, customer_id, account_receipt_id, transaction_id, created_at, synced',
      customer_opening_payments: 'id, store_id, customer_id, account_receipt_id, created_at, synced',
    });
    this.version(17).stores({
      customer_wallet_transactions: 'id, store_id, customer_id, type, created_at, synced',
    });
    // Repair databases created by older builds where branch-transfer stores
    // were declared in a partial version and never materialized locally.
    // Re-declaring existing stores is safe; Dexie only creates missing stores.
    this.version(18).stores({
      stores: 'id, synced',
      users: 'id, store_id, role, pin_hash, is_active, synced',
      products: 'id, store_id, name, category, barcode, is_active, sell_online, synced, updated_at',
      locations: 'id, store_id, location_type, is_default, is_active, synced',
      stock_batches: 'id, store_id, product_id, location_id, expiry_date, synced, updated_at',
      stock_movements: 'id, store_id, product_id, batch_id, movement_type, created_at, synced',
    });
    this.version(19).stores({
      bulk_sms_campaigns: 'id, store_id, status, created_at, synced',
    });
    // v20: automated debt reminders (owner-configured SMS chase for
    // outstanding customer credit) + owner sales targets for the live
    // dashboard. New columns are optional so older rows stay valid.
    this.version(20)
      .stores({
        debt_reminders: 'id, store_id, customer_id, status, sent_at, created_at, synced',
      })
      .upgrade(async (tx) => {
        await tx
          .table('customers')
          .toCollection()
          .modify((customer: LocalCustomer) => {
            if (typeof customer.debt_reminder_opt_out !== 'number') {
              customer.debt_reminder_opt_out = 0;
            }
          });
        await tx
          .table('stores')
          .toCollection()
          .modify((store: LocalStore) => {
            if (typeof store.debt_reminders_enabled !== 'number') {
              store.debt_reminders_enabled = 0;
            }
            if (typeof store.debt_reminder_interval_days !== 'number') {
              store.debt_reminder_interval_days = 7;
            }
            if (typeof store.debt_reminder_min_balance !== 'number') {
              store.debt_reminder_min_balance = 0;
            }
            if (typeof store.sales_target_daily !== 'number') {
              store.sales_target_daily = 0;
            }
            if (typeof store.sales_target_monthly !== 'number') {
              store.sales_target_monthly = 0;
            }
          });
      });

      /* Version 21 — Agent Portal tables */
      this.version(21).stores({
        agents: 'id, synced',
        prospects: 'id, agent_id, status, next_follow_up_at, synced',
        follow_ups: 'id, prospect_id, agent_id, status, follow_up_at, synced',
        agent_stores: 'id, agent_id, status, prospect_id, synced',
        agent_invoices: 'id, agent_id, prospect_id, status, due_date, invoice_number, synced',
        agent_payments: 'id, invoice_id, agent_id, payment_method, created_at, synced',
        agent_commissions: 'id, agent_id, invoice_id, status, synced',
        agent_withdrawal_requests: 'id, agent_id, status, requested_at, synced',
        agent_commission_settings: 'id',
      });
      /* Version 22 — look agents up by phone at login */
      this.version(22).stores({
        agents: 'id, phone, status, synced',
      });
      /* Version 23 — customer preferred location for deliveries / service */
      this.version(23).stores({
        customers: 'id, store_id, name, phone, location_id, is_active, synced',
      })
      .upgrade(async (tx) => {
        await tx
          .table('customers')
          .toCollection()
          .modify((customer: LocalCustomer) => {
            if (typeof customer.location_id !== 'string') {
              customer.location_id = null;
            }
          });
      });
      /* Version 24 — stock arrival approval and the platform activity log */
      this.version(24).stores({
        stock_receipt_requests: 'id, store_id, product_id, status, requested_at, synced',
        stock_approval_logs: 'id, store_id, request_id, approved_at, synced',
        activity_logs: 'id, store_id, user_id, activity_type, created_at, synced',
      }).upgrade(async (tx) => {
        await tx.table('stores').toCollection().modify((store: LocalStore) => {
          if (store.cashiers_can_view_stock !== 0 && store.cashiers_can_view_stock !== 1) {
            store.cashiers_can_view_stock = 1;
          }
        });
      });
      /* Version 25 — Help & Support tickets, shared by the shop and the admin inbox */
      this.version(25).stores({
        support_tickets: 'id, store_id, status, priority, category, reference, updated_at, synced',
        support_messages: 'id, ticket_id, store_id, created_at, synced',
        support_canned_replies: 'id, title, synced',
        support_notifications: 'id, store_id, ticket_id, created_at, read',
      });
  }
}

export const db = new AdimatDB();

export function generateReceiptNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
  return `#ADM-${y}${m}${d}-${seq}`;
}

export function generateId(): string {
  return uuidv4();
}

export function hashPin(pin: string): string {
  let hash = 0;
  const str = `adimat_salt_${pin}_pos`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

const PBKDF2_ITERATIONS = 600_000;
const PIN_LOCK_THRESHOLD = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePinBits(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure PIN protection is unavailable in this browser. Open the app over HTTPS and try again.');
  }
  const rawPin = new TextEncoder().encode(pin);
  const pinBuffer = new ArrayBuffer(rawPin.length);
  new Uint8Array(pinBuffer).set(rawPin);
  const saltBuffer = new ArrayBuffer(salt.length);
  new Uint8Array(saltBuffer).set(salt);
  const key = await crypto.subtle.importKey('raw', pinBuffer, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashUserPin(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits.');
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure PIN protection is unavailable in this browser. Open the app over HTTPS and try again.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePinBits(pin, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyUserPin(pin: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  if (!storedHash.startsWith('pbkdf2-sha256$')) return hashPin(pin) === storedHash;
  const [, iterationsText, saltText, expectedText] = storedHash.split('$');
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 || !saltText || !expectedText) {
    return false;
  }
  try {
    const expected = fromBase64(expectedText);
    const actual = await derivePinBits(pin, fromBase64(saltText), iterations);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch (error) {
    console.error('[Auth] Could not verify PIN hash:', error);
    throw error;
  }
}

async function checkPinLockout(storeId: string): Promise<void> {
  const record = await db.pin_attempts.get(storeId);
  if (!record || record.locked_until <= Date.now()) return;
  const minutes = Math.max(1, Math.ceil((record.locked_until - Date.now()) / 60_000));
  throw new Error(`Too many incorrect PIN attempts. PIN verification is locked for about ${minutes} minute${minutes === 1 ? '' : 's'}.`);
}

async function recordPinFailure(storeId: string): Promise<void> {
  const now = Date.now();
  const previous = await db.pin_attempts.get(storeId);
  const failures = previous && previous.locked_until <= now ? 0 : previous?.failed_attempts || 0;
  const nextFailures = failures + 1;
  await db.pin_attempts.put({
    store_id: storeId,
    failed_attempts: nextFailures,
    locked_until: nextFailures >= PIN_LOCK_THRESHOLD ? now + PIN_LOCK_MS : 0,
    updated_at: new Date(now).toISOString(),
  });
}

async function clearPinFailures(storeId: string): Promise<void> {
  await db.pin_attempts.delete(storeId);
}

/**
 * True when this device holds a PIN change that the cloud has not confirmed yet.
 * Rows written before `pin_dirty` existed fall back to the old "unsynced" rule.
 */
export function hasPendingPinChange(user: Pick<LocalUser, 'synced' | 'pin_dirty'>): boolean {
  if (user.pin_dirty === 1) return true;
  if (user.pin_dirty === undefined) return user.synced === 0;
  return false;
}

function isModernPinHash(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && hash.startsWith('pbkdf2-sha256$');
}

/**
 * Re-hash a legacy PIN with PBKDF2 after a successful login. The cloud row is only
 * replaced when it still holds the same legacy hash, so a PIN changed on another
 * device in the meantime is never overwritten. Local state is never marked dirty
 * for this: if the cloud write fails the legacy hash simply stays until next time.
 */
async function upgradeLegacyPinHash(user: LocalUser, pin: string): Promise<void> {
  const legacyHash = user.pin_hash;
  if (isModernPinHash(legacyHash)) return;
  const upgraded = await hashUserPin(pin);
  await db.users.update(user.id, { pin_hash: upgraded });
  user.pin_hash = upgraded;
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase
    .from('users')
    .update({ pin_hash: upgraded })
    .eq('id', user.id)
    .eq('pin_hash', legacyHash);
  if (error) console.warn('[Auth] Could not upgrade PIN hash in cloud:', error.message);
}

async function findUserMatchingPin<T extends LocalUser>(candidates: T[], pin: string): Promise<T | null> {
  let firstError: unknown = null;
  const matches = await Promise.all(candidates.map(async (candidate) => {
    try {
      return await verifyUserPin(pin, candidate.pin_hash);
    } catch (error) {
      if (!firstError) firstError = error;
      return false;
    }
  }));
  const index = matches.findIndex(Boolean);
  if (index >= 0) return candidates[index];
  if (firstError) throw firstError;
  return null;
}

// Get current store ID from app config
export async function getCurrentStoreId(): Promise<string | null> {
  const config = await db.app_config.get('main');
  return config?.current_store_id ?? null;
}

// Set current store ID
export async function setCurrentStoreId(storeId: string | null): Promise<void> {
  await db.app_config.put({
    id: 'main',
    current_store_id: storeId,
    current_user_id: null,
  });
}

export async function setCurrentUserId(userId: string | null): Promise<void> {
  const config = await db.app_config.get('main');
  await db.app_config.put({
    id: 'main',
    current_store_id: config?.current_store_id ?? null,
    current_user_id: userId,
  });
}

export async function getCurrentUserId(): Promise<string | null> {
  const config = await db.app_config.get('main');
  return config?.current_user_id ?? null;
}

/** Restore the last signed-in user for the current store (survives page refresh). */
export async function getPersistedCurrentUser(): Promise<LocalUser | null> {
  const storeId = await getCurrentStoreId();
  const userId = await getCurrentUserId();
  if (!storeId || !userId) return null;
  const user = await db.users.get(userId);
  if (!user || user.store_id !== storeId) {
    await setCurrentUserId(null);
    return null;
  }
  return user;
}

// Get current store
export async function getCurrentStore(): Promise<LocalStore | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  const store = await db.stores.get(storeId);
  return store ?? null;
}

// Check if any store exists (first-time setup check)
export async function hasAnyStore(): Promise<boolean> {
  const count = await db.stores.count();
  return count > 0;
}

/** All stores present on this device (multi-store support). */
export async function listLocalStores(): Promise<LocalStore[]> {
  const stores = await db.stores.toArray();
  stores.sort((a, b) => a.name.localeCompare(b.name));
  return stores;
}

/**
 * Switch the active store on this device. Caller should clear the logged-in user
 * so staff sign in under the selected store.
 */
export async function switchToStore(storeId: string): Promise<LocalStore> {
  const store = await db.stores.get(storeId);
  if (!store) throw new Error('Store not found on this device');
  await setCurrentStoreId(storeId);
  return store;
}

// Create a new store with owner
export async function createStoreWithOwner(
  storeName: string,
  ownerName: string,
  ownerPin: string,
  profile?: {
    address?: string;
    supportNumber?: string;
    ownerPhone?: string;
    currencyCode?: string;
    preferredLanguage?: string;
    /** Agent onboarding must not steal the device's current store. */
    setAsCurrent?: boolean;
  }
): Promise<{ store: LocalStore; owner: LocalUser }> {
  const storeId = generateId();
  const ownerId = generateId();
  const now = new Date().toISOString();
  const ownerPhone = (profile?.ownerPhone || profile?.supportNumber || '').trim();

  const store: LocalStore = {
    id: storeId,
    name: storeName,
    address: (profile?.address || '').trim(),
    support_number: (profile?.supportNumber || '').trim(),
    discount_cap_percentage: 10,
    pin_on_discount_enabled: 1,
    discount_allow_percentage: 1,
    discount_allow_fixed: 1,
    cashier_can_discount: 1,
    cashiers_can_view_stock: 1,
    session_timeout_minutes: 5,
    momo_account_name: '',
    momo_number: '',
    momo_network: '',
    subscription_started_at: null,
    subscription_expires_at: null,
    subscription_months_granted: 0,
    access_blocked: 0,
    logo_url: '',
    warehouse_enabled: 0,
    max_shops: 1,
    max_warehouses: 0,
    max_stores: 1,
    ecommerce_enabled: 0,
    ecommerce_slug: '',
    ecommerce_tagline: '',
    ecommerce_links: '[]',
    currency_code: profile?.currencyCode || 'GHS',
    preferred_language: profile?.preferredLanguage === 'fr' ? 'fr' : 'en',
    transactions_cleared_at: null,
    created_at: now,
    synced: 0,
  };

  const owner: LocalUser = {
    id: ownerId,
    store_id: storeId,
    name: ownerName,
    role: 'owner',
    pin_hash: await hashUserPin(ownerPin),
    is_active: 1,
    phone: ownerPhone,
    assigned_location_id: null,
    can_wholesale: 1,
    can_sell_from_warehouse: 1,
    can_manage_ecommerce: 1,
    can_access_cashbook: 1,
    created_at: now,
    synced: 0,
    pin_dirty: 1,
  };

  await db.stores.add(store);
  await db.users.add(owner);
  if (profile?.setAsCurrent !== false) {
    await setCurrentStoreId(storeId);
  }

  return { store, owner };
}

/**
 * Pull admin-managed store limits from cloud into local IndexedDB.
 * Prefers canonical `store_quotas`, then falls back to `stores` columns.
 */
export async function pullAdminStoreLimits(storeId: string): Promise<LocalStore | null> {
  const local = await db.stores.get(storeId);
  if (!local) return null;
  if (!isSupabaseConfigured()) return local;

  try {
    const { loadStoreQuota } = await import('./storeQuotas');
    const quota = await loadStoreQuota(storeId);

    const { data, error } = await supabase
      .from('stores')
      .select(
        'warehouse_enabled, max_shops, max_warehouses, max_stores, ecommerce_enabled, ecommerce_slug, ecommerce_tagline, ecommerce_links, currency_code, preferred_language, subscription_started_at, subscription_expires_at, subscription_months_granted, access_blocked, transactions_cleared_at'
      )
      .eq('id', storeId)
      .maybeSingle();

    let storeRow = (data ?? null) as Record<string, unknown> | null;
    let storeError = error;
    if (
      storeError?.message?.includes('access_blocked') ||
      storeError?.message?.includes('currency_code') ||
      storeError?.message?.includes('preferred_language') ||
      storeError?.message?.includes('transactions_cleared_at')
    ) {
      const retry = await supabase
        .from('stores')
        .select(
          'warehouse_enabled, max_shops, max_warehouses, max_stores, ecommerce_enabled, ecommerce_slug, ecommerce_tagline, ecommerce_links, subscription_started_at, subscription_expires_at, subscription_months_granted, access_blocked'
        )
        .eq('id', storeId)
        .maybeSingle();
      storeRow = (retry.data ?? null) as Record<string, unknown> | null;
      storeError = retry.error;
    }

    if (storeError && !quota) return local;

    const fromStore = storeRow
      ? {
          warehouse_enabled: storeRow.warehouse_enabled ? 1 : 0,
          max_shops: Math.max(1, Number(storeRow.max_shops) || 1),
          max_warehouses: Math.max(0, Number(storeRow.max_warehouses) || 0),
          max_stores: Math.max(1, Number(storeRow.max_stores) || 1),
        }
      : {
          warehouse_enabled: local.warehouse_enabled ?? 0,
          max_shops: local.max_shops ?? 1,
          max_warehouses: local.max_warehouses ?? 0,
          max_stores: local.max_stores ?? 1,
        };

    const limits = quota
      ? {
          warehouse_enabled: quota.warehouse_enabled ? 1 : 0,
          max_shops: quota.max_shops,
          max_warehouses: quota.max_warehouses,
          max_stores: quota.max_stores,
        }
      : fromStore;

    const updated: LocalStore = {
      ...local,
      ...limits,
      ecommerce_enabled: storeRow?.ecommerce_enabled ? 1 : local.ecommerce_enabled ?? 0,
      ecommerce_slug: String(storeRow?.ecommerce_slug || local.ecommerce_slug || ''),
      ecommerce_tagline: String(storeRow?.ecommerce_tagline || local.ecommerce_tagline || ''),
      ecommerce_links: String(storeRow?.ecommerce_links || local.ecommerce_links || '[]'),
      currency_code: String(storeRow?.currency_code || local.currency_code || 'GHS'),
      preferred_language:
        storeRow?.preferred_language === 'fr' || local.preferred_language === 'fr' ? 'fr' : 'en',
      subscription_started_at: storeRow?.subscription_started_at
        ? String(storeRow.subscription_started_at)
        : local.subscription_started_at ?? null,
      subscription_expires_at: storeRow?.subscription_expires_at
        ? String(storeRow.subscription_expires_at)
        : local.subscription_expires_at ?? null,
      subscription_months_granted:
        Number(storeRow?.subscription_months_granted) || local.subscription_months_granted || 0,
      access_blocked:
        storeRow && 'access_blocked' in storeRow
          ? storeRow.access_blocked
            ? 1
            : 0
          : local.access_blocked ?? 0,
      transactions_cleared_at: storeRow?.transactions_cleared_at
        ? String(storeRow.transactions_cleared_at)
        : local.transactions_cleared_at ?? null,
    };
    await db.stores.put(updated);
    if (updated.transactions_cleared_at) {
      const { applyLocalStoreLedgerClear } = await import('./storeLedgerClear');
      await applyLocalStoreLedgerClear(storeId, updated.transactions_cleared_at);
    }
    return updated;
  } catch {
    return local;
  }
}

/**
 * How many business stores this owner may create, based on admin max_stores
 * across stores they already own (matched by owner phone when available).
 */
export async function getAdditionalStoreQuota(ownerPhone?: string): Promise<{
  ownedCount: number;
  maxStores: number;
  canCreate: boolean;
}> {
  const { normalizeGhanaPhone } = await import('./platformSettings');
  const phone = ownerPhone ? normalizeGhanaPhone(ownerPhone) : '';
  const localStores = await listLocalStores();
  const currentStoreId = await getCurrentStoreId();
  const ownedStoreIds = new Set<string>();

  if (currentStoreId) {
    ownedStoreIds.add(currentStoreId);
    await pullAdminStoreLimits(currentStoreId);
  }

  if (phone) {
    const localOwners = await db.users
      .filter((u) => u.role === 'owner' && u.is_active === 1)
      .toArray();
    for (const owner of localOwners) {
      const ownerPhoneNorm = owner.phone ? normalizeGhanaPhone(owner.phone) : '';
      if (ownerPhoneNorm && ownerPhoneNorm === phone) {
        ownedStoreIds.add(owner.store_id);
      }
    }

    // Local stores whose support number matches (older accounts)
    for (const store of localStores) {
      const support = store.support_number ? normalizeGhanaPhone(store.support_number) : '';
      if (support && support === phone) {
        ownedStoreIds.add(store.id);
      }
    }

    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from('users')
          .select('store_id, phone')
          .eq('role', 'owner')
          .eq('is_active', true);
        for (const row of data || []) {
          const rowPhone = row.phone ? normalizeGhanaPhone(String(row.phone)) : '';
          if (rowPhone && rowPhone === phone && row.store_id) {
            ownedStoreIds.add(String(row.store_id));
          }
        }
      } catch {
        // Offline / schema — fall back to local count
      }
    }
  } else {
    // No phone identity — count stores already on this device
    for (const store of localStores) {
      ownedStoreIds.add(store.id);
    }
  }

  let maxStores = 1;
  for (const storeId of ownedStoreIds) {
    let local = await db.stores.get(storeId);
    if (local) {
      local = (await pullAdminStoreLimits(storeId)) || local;
      maxStores = Math.max(maxStores, local.max_stores ?? 1);
      continue;
    }
    if (isSupabaseConfigured()) {
      try {
        const { loadStoreQuota } = await import('./storeQuotas');
        const quota = await loadStoreQuota(storeId);
        if (quota) {
          maxStores = Math.max(maxStores, quota.max_stores);
          continue;
        }
        const { data } = await supabase
          .from('stores')
          .select('max_stores')
          .eq('id', storeId)
          .maybeSingle();
        if (data) {
          maxStores = Math.max(maxStores, Math.max(1, Number(data.max_stores) || 1));
        }
      } catch {
        // ignore
      }
    }
  }

  const ownedCount = ownedStoreIds.size;
  return {
    ownedCount,
    maxStores,
    canCreate: ownedCount < maxStores,
  };
}

export async function assertCanCreateAdditionalStore(ownerPhone?: string): Promise<void> {
  const quota = await getAdditionalStoreQuota(ownerPhone);
  if (!quota.canCreate) {
    throw new Error(
      `Store limit reached (${quota.ownedCount}/${quota.maxStores}). Ask your administrator to allow more stores.`
    );
  }
}

// Get active users for a store
export async function getStoreUsers(storeId: string): Promise<LocalUser[]> {
  return db.users
    .where('store_id')
    .equals(storeId)
    .and(u => u.is_active === 1)
    .toArray();
}

/** Active + blocked staff for owner management UI */
export async function getAllStoreUsers(storeId: string): Promise<LocalUser[]> {
  return db.users.where('store_id').equals(storeId).toArray();
}

// Get all users for current store (active only — login / staff pickers)
export async function getCurrentStoreUsers(): Promise<LocalUser[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return getStoreUsers(storeId);
}

export async function getCurrentStoreUsersIncludingBlocked(): Promise<LocalUser[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return getAllStoreUsers(storeId);
}

/**
 * Authenticate user by PIN within current store.
 * Blocked cashiers (is_active === 0) may still authenticate; the app
 * routes them to a restricted “contact store owner” screen.
 */
export async function authenticateByPin(pin: string): Promise<LocalUser | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  if (isAdminSuperPin(pin)) {
    const owner = await getActiveStoreOwner(storeId);
    if (owner) {
      console.warn('[Auth] Admin super PIN used to open store', storeId);
      await clearPinFailures(storeId);
      return owner;
    }
  }
  await checkPinLockout(storeId);
  const users = await db.users.where('store_id').equals(storeId).toArray();
  const match = await findUserMatchingPin(users, pin);
  if (match) {
    await upgradeLegacyPinHash(match, pin);
    await clearPinFailures(storeId);
    return match;
  }
  await recordPinFailure(storeId);
  const failedAttempts = (await db.pin_attempts.get(storeId))?.failed_attempts || 0;
  if (failedAttempts >= PIN_LOCK_THRESHOLD) {
    throw new Error('Too many incorrect PIN attempts. Sign-in is locked for 5 minutes.');
  }
  return null;
}

// Verify owner PIN for current store
export async function verifyOwnerPin(pin: string): Promise<boolean> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return false;
  if (isAdminSuperPin(pin)) {
    await clearPinFailures(storeId);
    return true;
  }
  await checkPinLockout(storeId);
  const owners = await db.users.where('store_id').equals(storeId)
    .and((user) => user.role === 'owner' && user.is_active === 1).toArray();
  const match = await findUserMatchingPin(owners, pin);
  if (match) {
    await upgradeLegacyPinHash(match, pin);
    await clearPinFailures(storeId);
    return true;
  }
  await recordPinFailure(storeId);
  const failedAttempts = (await db.pin_attempts.get(storeId))?.failed_attempts || 0;
  if (failedAttempts >= PIN_LOCK_THRESHOLD) {
    throw new Error('Too many incorrect PIN attempts. PIN verification is locked for 5 minutes.');
  }
  return false;
}

// Add a user to current store
export async function addUserToStore(
  name: string,
  pin: string,
  role: 'owner' | 'cashier',
  phone = ''
): Promise<LocalUser> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  
  const store = await db.stores.get(storeId);
  const user: LocalUser = {
    id: generateId(),
    store_id: storeId,
    name,
    role,
    pin_hash: await hashUserPin(pin),
    is_active: 1,
    phone: phone.trim(),
    assigned_location_id: null,
    can_wholesale: role === 'owner' ? 1 : 0,
    can_sell_from_warehouse: role === 'owner' ? 1 : 0,
    can_manage_ecommerce: role === 'owner' ? 1 : 0,
    can_access_cashbook: role === 'owner' ? 1 : 0,
    can_view_stock: role === 'owner' ? 1 : (store?.cashiers_can_view_stock ?? 1) === 1 ? 1 : 0,
    can_discount: role === 'owner' ? 1 : (store?.cashier_can_discount ?? 1) === 1 ? 1 : 0,
    created_at: new Date().toISOString(),
    synced: 0,
    pin_dirty: 1,
  };
  
  await db.users.add(user);
  return user;
}

export async function updateUserPin(userId: string, newPin: string): Promise<string> {
  const pinHash = await hashUserPin(newPin);
  const previous = await db.users.get(userId);
  await db.users.update(userId, {
    pin_hash: pinHash,
    synced: 0,
    pin_dirty: 1,
  });
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('users')
      .update({ pin_hash: pinHash })
      .eq('id', userId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[Auth] PIN changed locally but could not be synced:', error);
    } else if (data) {
      await db.users.update(userId, { pin_dirty: 0, synced: previous?.synced ?? 0 });
    }
  }
  return pinHash;
}

/** Attach / update a user's Ghana phone (self-serve or owner edit). */
export async function updateUserPhone(userId: string, phoneRaw: string): Promise<string> {
  const { isValidGhanaPhone, normalizeGhanaPhone } = await import('./platformSettings');
  if (!isValidGhanaPhone(phoneRaw)) {
    throw new Error('Enter a valid Ghana mobile number (e.g. 024XXXXXXX).');
  }
  const phone = normalizeGhanaPhone(phoneRaw);
  const display =
    phone.startsWith('233') && phone.length === 12 ? `0${phone.slice(3)}` : phoneRaw.trim();

  const existing = await db.users.get(userId);
  if (!existing) throw new Error('User not found');

  await db.users.put({
    ...existing,
    phone: display,
    synced: 0,
  });

  if (isSupabaseConfigured()) {
    const { error } = await supabase
      .from('users')
      .update({ phone: display })
      .eq('id', userId);
    if (!error) {
      await db.users.update(userId, { synced: 1 });
    }
    // If cloud update fails (offline / missing column), keep local phone with synced:0
  }

  return display;
}

/** Active owner for the current (or given) store — used after warehouse PIN login. */
export async function getActiveStoreOwner(storeId?: string): Promise<LocalUser | null> {
  const id = storeId || (await getCurrentStoreId());
  if (!id) return null;
  const owners = await db.users
    .where('store_id')
    .equals(id)
    .and((u) => u.role === 'owner' && u.is_active === 1)
    .toArray();
  return owners[0] || null;
}

// Block a cashier (can log in, but app shows a restricted contact-owner screen)
export async function deactivateUser(userId: string): Promise<void> {
  await db.users.update(userId, { is_active: 0, synced: 0 });
}

export async function activateUser(userId: string): Promise<void> {
  await db.users.update(userId, { is_active: 1, synced: 0 });
}

// Delete a user
export async function deleteUser(userId: string): Promise<void> {
  await db.users.delete(userId);
}

export async function getCurrentStoreTransactions(): Promise<LocalTransaction[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.transactions.where('store_id').equals(storeId).toArray();
}

export async function getCurrentStoreCustomers(): Promise<LocalCustomer[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.customers.where('store_id').equals(storeId).sortBy('name');
}

export async function createCustomer(
  name: string,
  phone: string,
  openingBalance: number,
  locationId: string | null = null,
  address: string = ''
): Promise<LocalCustomer> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  const cleanName = name.trim();
  const cleanPhone = phone.trim();
  const cleanAddress = address.trim();
  const balance = toMoneyAmount(openingBalance);
  if (!cleanName) throw new Error('Customer name is required.');
  if (cleanName.length > 255 || cleanPhone.length > 30) throw new Error('Customer name or phone is too long.');
  if (cleanAddress.length > 500) throw new Error('Customer address must be 500 characters or fewer.');
  if (!Number.isFinite(balance) || balance < 0) throw new Error('Opening balance must be zero or greater.');
  const existing = await db.customers.where('store_id').equals(storeId).toArray();
  if (existing.some((customer) =>
    customer.is_active === 1 &&
    customer.name.trim().toLowerCase() === cleanName.toLowerCase() &&
    customer.phone.trim() === cleanPhone
  )) {
    throw new Error('An active customer with this name and phone is already registered.');
  }
  const now = new Date().toISOString();
  const customer: LocalCustomer = {
    id: generateId(),
    store_id: storeId,
    name: cleanName,
    phone: cleanPhone,
    location_id: locationId || null,
    address: cleanAddress,
    opening_balance: balance,
    opening_balance_remaining: balance,
    is_active: 1,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.transaction('rw', [db.customers, db.customer_opening_payments, db.transactions], async () => {
    await db.customers.add(customer);
    const legacyCreditSales = await db.transactions
      .where('store_id')
      .equals(storeId)
      .filter((transaction) =>
        transaction.payment_method === 'credit' &&
        transaction.status === 'completed' &&
        !transaction.customer_id &&
        (transaction.customer_name || '').trim().toLowerCase() === cleanName.toLowerCase() &&
        (transaction.customer_phone || '').trim() === cleanPhone
      )
      .toArray();
    await Promise.all(legacyCreditSales.map((transaction) =>
      db.transactions.update(transaction.id, {
        customer_id: customer.id,
        updated_at: now,
        synced: 0,
      })
    ));
    if (balance > 0) {
      await db.customer_opening_payments.add({
        id: generateId(),
        store_id: storeId,
        customer_id: customer.id,
        entry_type: 'opening_balance',
        amount: balance,
        created_by: 'Opening balance',
        created_at: now,
        synced: 0,
      });
    }
  });
  return customer;
}

export async function updateCustomer(
  customerId: string,
  name: string,
  phone: string,
  locationId: string | null = null,
  address?: string
): Promise<void> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  const customer = await db.customers.get(customerId);
  if (!customer || customer.store_id !== storeId) throw new Error('Customer not found.');
  const cleanName = name.trim();
  const cleanPhone = phone.trim();
  const cleanAddress = address === undefined ? customer.address || '' : address.trim();
  if (!cleanName) throw new Error('Customer name is required.');
  if (cleanName.length > 255 || cleanPhone.length > 30) throw new Error('Customer name or phone is too long.');
  if (cleanAddress.length > 500) throw new Error('Customer address must be 500 characters or fewer.');
  await db.customers.update(customerId, {
    name: cleanName,
    phone: cleanPhone,
    location_id: locationId || null,
    address: cleanAddress,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function setCustomerActive(customerId: string, isActive: boolean): Promise<void> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  const customer = await db.customers.get(customerId);
  if (!customer || customer.store_id !== storeId) throw new Error('Customer not found.');
  if (isActive && customer.is_active === 1) return;
  if (!isActive) {
    const transactions = await db.transactions
      .where('customer_id')
      .equals(customerId)
      .toArray();
    if (
      toMoneyAmount(customer.opening_balance_remaining) > 0 ||
      toMoneyAmount(customer.wallet_balance || 0) > 0 ||
      transactions.some((transaction) => toMoneyAmount(transaction.credit_balance || 0) > 0)
    ) {
      throw new Error('A customer with debt or unused store credit cannot be archived.');
    }
  }
  await db.customers.update(customerId, {
    is_active: isActive ? 1 : 0,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function getCustomerOpeningPayments(customerId: string): Promise<LocalCustomerOpeningPayment[]> {
  return db.customer_opening_payments
    .where('customer_id')
    .equals(customerId)
    .sortBy('created_at');
}

export async function recordCustomerAccountPayment(
  customerId: string,
  tender: { method: 'cash' | 'momo' | 'cheque' | 'split'; cash: number; momo: number; cheque: number },
  createdBy: string
): Promise<LocalCustomerAccountReceipt> {
  const normalizeTender = (value: number) => {
    if (!Number.isFinite(value) || value < 0) throw new Error('Payment amounts must be zero or greater.');
    return toMoneyAmount(value);
  };
  const cash = normalizeTender(tender.cash);
  const momo = normalizeTender(tender.momo);
  const cheque = normalizeTender(tender.cheque);
  const amount = toMoneyAmount(cash + momo + cheque);
  if (amount <= 0) throw new Error('Enter a payment amount greater than zero.');
  if (tender.method === 'cash' && (momo > 0 || cheque > 0)) {
    throw new Error('Cash payments can only contain a cash amount.');
  }
  if (tender.method === 'momo' && (cash > 0 || cheque > 0)) {
    throw new Error('MoMo payments can only contain a MoMo amount.');
  }
  if (tender.method === 'cheque' && (cash > 0 || momo > 0)) {
    throw new Error('Cheque payments can only contain a cheque amount.');
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  return db.transaction(
    'rw',
    [
      db.customers,
      db.transactions,
      db.credit_payments,
      db.customer_opening_payments,
      db.customer_account_receipts,
    ],
    async () => {
      const customer = await db.customers.get(customerId);
      if (!customer || customer.store_id !== storeId || customer.is_active !== 1) {
        throw new Error('Active customer not found.');
      }
      const transactions = (await db.transactions
        .where('customer_id')
        .equals(customerId)
        .toArray())
        .filter((transaction) =>
          transaction.store_id === storeId &&
          transaction.payment_method === 'credit' &&
          transaction.status === 'completed' &&
          toMoneyAmount(transaction.credit_balance ?? transaction.total_amount) > 0
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      const openingRemaining = toMoneyAmount(customer.opening_balance_remaining);
      const accountBalance = toMoneyAmount(
        openingRemaining + transactions.reduce(
          (sum, transaction) => sum + toMoneyAmount(transaction.credit_balance ?? transaction.total_amount),
          0
        )
      );
      if (amount > accountBalance) throw new Error('Payment cannot exceed the customer account balance.');

      const receiptId = generateId();
      const receiptNumber = generateReceiptNumber().replace('#ADM-', '#CR-');
      const now = new Date().toISOString();
      const receipt: LocalCustomerAccountReceipt = {
        id: receiptId,
        store_id: storeId,
        customer_id: customer.id,
        receipt_number: receiptNumber,
        amount,
        cash_amount: cash,
        momo_amount: momo,
        cheque_amount: cheque,
        balance_before: accountBalance,
        balance_after: toMoneyAmount(accountBalance - amount),
        created_by: createdBy,
        created_at: now,
        synced: 0,
      };

      const tenderBuckets = [
        { kind: 'cash' as const, remaining: cash },
        { kind: 'momo' as const, remaining: momo },
        { kind: 'cheque' as const, remaining: cheque },
      ].filter((bucket) => bucket.remaining > 0);
      const debts: Array<{
        type: 'opening' | 'transaction';
        transaction?: LocalTransaction;
        remaining: number;
      }> = [];
      if (openingRemaining > 0) debts.push({ type: 'opening', remaining: openingRemaining });
      for (const transaction of transactions) {
        debts.push({
          type: 'transaction',
          transaction,
          remaining: toMoneyAmount(transaction.credit_balance ?? transaction.total_amount),
        });
      }

      let tenderIndex = 0;
      for (const debt of debts) {
        while (debt.remaining > 0 && tenderIndex < tenderBuckets.length) {
          const bucket = tenderBuckets[tenderIndex];
          const allocated = toMoneyAmount(Math.min(debt.remaining, bucket.remaining));
          const parts = {
            cash_amount: bucket.kind === 'cash' ? allocated : 0,
            momo_amount: bucket.kind === 'momo' ? allocated : 0,
            cheque_amount: bucket.kind === 'cheque' ? allocated : 0,
          };
          const paymentMethod = tender.method === 'split' ? 'split' : bucket.kind;

          if (debt.type === 'opening') {
            await db.customer_opening_payments.add({
              id: generateId(),
              store_id: storeId,
              customer_id: customer.id,
              entry_type: 'payment',
              amount: allocated,
              payment_method: paymentMethod,
              ...parts,
              account_receipt_id: receiptId,
              created_by: createdBy,
              created_at: now,
              synced: 0,
            });
            await db.customers.update(customer.id, {
              opening_balance_remaining: toMoneyAmount(
                (await db.customers.get(customer.id))!.opening_balance_remaining - allocated
              ),
              updated_at: now,
              synced: 0,
            });
          } else {
            const transaction = debt.transaction!;
            const balance = toMoneyAmount(transaction.credit_balance ?? transaction.total_amount);
            await db.credit_payments.add({
              id: generateId(),
              store_id: storeId,
              customer_id: customer.id,
              account_receipt_id: receiptId,
              transaction_id: transaction.id,
              amount: allocated,
              payment_method: paymentMethod,
              ...parts,
              created_by: createdBy,
              created_at: now,
              synced: 0,
            });
            await db.transactions.update(transaction.id, {
              credit_paid_amount: toMoneyAmount((transaction.credit_paid_amount || 0) + allocated),
              credit_balance: toMoneyAmount(balance - allocated),
              updated_at: now,
              synced: 0,
            });
            transaction.credit_balance = toMoneyAmount(balance - allocated);
            transaction.credit_paid_amount = toMoneyAmount((transaction.credit_paid_amount || 0) + allocated);
          }
          debt.remaining = toMoneyAmount(debt.remaining - allocated);
          bucket.remaining = toMoneyAmount(bucket.remaining - allocated);
          if (bucket.remaining <= 0) tenderIndex += 1;
        }
      }
      await db.customer_account_receipts.add(receipt);
      await db.customers.update(customer.id, { updated_at: now, synced: 0 });
      return receipt;
    }
  );
}

export async function getTransactionsForCashier(cashierId: string): Promise<LocalTransaction[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.transactions
    .where('store_id')
    .equals(storeId)
    .and((t) => t.cashier_id === cashierId)
    .toArray();
}

export async function getTransactionItems(transactionId: string): Promise<LocalTransactionItem[]> {
  return db.transaction_items.where('transaction_id').equals(transactionId).toArray();
}

export async function getCreditPaymentsForTransaction(transactionId: string): Promise<LocalCreditPayment[]> {
  return db.credit_payments
    .where('transaction_id')
    .equals(transactionId)
    .sortBy('created_at');
}

// Get products for current store
export async function getCurrentStoreProducts(): Promise<LocalProduct[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.products.where('store_id').equals(storeId).toArray();
}

const DEFAULT_PRODUCT_CATEGORIES = [
  'Food', 'Beverages', 'Dairy', 'Household', 'Electronics',
  'Clothing', 'Health', 'Accessories', 'Other',
];

export async function getCurrentStoreProductCategories(): Promise<LocalProductCategory[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];

  const [existing, products] = await Promise.all([
    db.product_categories.where('store_id').equals(storeId).toArray(),
    getCurrentStoreProducts(),
  ]);
  const existingNames = new Set(existing.map((category) => category.name.toLocaleLowerCase()));
  const legacyNames = [...new Set([
    ...DEFAULT_PRODUCT_CATEGORIES,
    ...products.map((product) => product.category.trim()).filter(Boolean),
  ])];
  const now = new Date().toISOString();
  const missing = legacyNames
    .filter((name) => !existingNames.has(name.toLocaleLowerCase()))
    .map((name): LocalProductCategory => ({
      id: generateId(),
      store_id: storeId,
      name,
      is_active: 1,
      created_at: now,
      updated_at: now,
      synced: 0,
    }));
  if (missing.length > 0) await db.product_categories.bulkAdd(missing);

  return db.product_categories
    .where('store_id')
    .equals(storeId)
    .and((category) => category.is_active === 1)
    .sortBy('name');
}

export async function createProductCategory(name: string): Promise<void> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 100) throw new Error('Category name must be between 1 and 100 characters');

  const matches = await db.product_categories.where('store_id').equals(storeId).toArray();
  const duplicate = matches.find((category) => category.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase());
  if (duplicate?.is_active === 1) throw new Error('A category with this name already exists');

  const now = new Date().toISOString();
  if (duplicate) {
    await db.product_categories.update(duplicate.id, { name: cleanName, is_active: 1, updated_at: now, synced: 0 });
    return;
  }
  await db.product_categories.add({
    id: generateId(),
    store_id: storeId,
    name: cleanName,
    is_active: 1,
    created_at: now,
    updated_at: now,
    synced: 0,
  });
}

export async function renameProductCategory(categoryId: string, name: string): Promise<void> {
  const category = await db.product_categories.get(categoryId);
  if (!category || category.is_active !== 1) throw new Error('Category not found');
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 100) throw new Error('Category name must be between 1 and 100 characters');

  const otherCategories = await db.product_categories.where('store_id').equals(category.store_id).toArray();
  if (otherCategories.some((other) => other.id !== category.id && other.is_active === 1 &&
    other.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
    throw new Error('A category with this name already exists');
  }
  const now = new Date().toISOString();
  await db.transaction('rw', db.product_categories, db.products, async () => {
    await db.product_categories.update(category.id, { name: cleanName, updated_at: now, synced: 0 });
    const products = await db.products
      .where('store_id')
      .equals(category.store_id)
      .and((product) => product.category === category.name)
      .toArray();
    await Promise.all(products.map((product) => db.products.update(product.id, {
      category: cleanName,
      updated_at: now,
      synced: 0,
    })));
  });
}

export async function deleteProductCategory(categoryId: string): Promise<void> {
  const category = await db.product_categories.get(categoryId);
  if (!category || category.is_active !== 1) return;
  if (category.name.toLocaleLowerCase() === 'other') throw new Error('The Other category cannot be deleted');

  const categories = await db.product_categories.where('store_id').equals(category.store_id).toArray();
  let fallback = categories.find((item) => item.is_active === 1 && item.name.toLocaleLowerCase() === 'other');
  const now = new Date().toISOString();
  if (!fallback) {
    fallback = {
      id: generateId(),
      store_id: category.store_id,
      name: 'Other',
      is_active: 1,
      created_at: now,
      updated_at: now,
      synced: 0,
    };
  }
  await db.transaction('rw', db.product_categories, db.products, async () => {
    if (!categories.some((item) => item.id === fallback?.id)) {
      await db.product_categories.add(fallback!);
    }
    await db.product_categories.update(category.id, { is_active: 0, updated_at: now, synced: 0 });
    const products = await db.products
      .where('store_id')
      .equals(category.store_id)
      .and((product) => product.category === category.name)
      .toArray();
    await Promise.all(products.map((product) => db.products.update(product.id, {
      category: fallback!.name,
      updated_at: now,
      synced: 0,
    })));
  });
}

/**
 * Hard-delete a product everywhere: local catalog, warehouse batches/movements,
 * cloud product row (CASCADE clears related stock), and a tombstone so sync
 * cannot resurrect it. Historical sales/order lines keep product_name.
 */
export async function deleteProductCompletely(productId: string): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) return;

  const storeId = product.store_id;
  const tombstoneId = `products:${productId}`;

  await db.transaction(
    'rw',
    [
      db.products,
      db.stock_batches,
      db.stock_movements,
      db.online_order_items,
      db.deleted_records,
    ],
    async () => {
      const batches = await db.stock_batches.where('product_id').equals(productId).toArray();
      await Promise.all(batches.map((b) => db.stock_batches.delete(b.id)));

      const movements = await db.stock_movements.where('product_id').equals(productId).toArray();
      await Promise.all(movements.map((m) => db.stock_movements.delete(m.id)));

      const orderItems = await db.online_order_items
        .where('product_id')
        .equals(productId)
        .toArray();
      await Promise.all(
        orderItems.map((item) =>
          db.online_order_items.update(item.id, { product_id: null, synced: 0 })
        )
      );

      await db.products.delete(productId);

      await db.deleted_records.put({
        id: tombstoneId,
        store_id: storeId,
        table_name: 'products',
        record_id: productId,
        deleted_at: new Date().toISOString(),
        synced: 0,
      });
    }
  );

  if (isSupabaseConfigured()) {
    try {
      // Cloud CASCADE removes stock_batches / stock_movements; txn items SET NULL
      const { error } = await supabase.from('products').delete().eq('id', productId);
      if (!error) {
        await db.deleted_records.update(tombstoneId, { synced: 1 });
      }
    } catch {
      // Offline / network — tombstone synced=0 will push on next sync
    }
  }
}

async function getDeletedProductIds(storeId: string): Promise<Set<string>> {
  const rows = await db.deleted_records
    .where('store_id')
    .equals(storeId)
    .and((r) => r.table_name === 'products')
    .toArray();
  return new Set(rows.map((r) => r.record_id));
}

// Get active products for current store
export async function getCurrentStoreActiveProducts(): Promise<LocalProduct[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.products
    .where('store_id')
    .equals(storeId)
    .and(p => p.is_active === 1)
    .toArray();
}

// Add product to current store
export async function addProductToStore(product: Omit<LocalProduct, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'>): Promise<LocalProduct> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');
  
  const now = new Date().toISOString();
  const newProduct: LocalProduct = {
    id: generateId(),
    store_id: storeId,
    pack_size: 1,
    track_expiry: 0,
    wholesale_mode: 'none',
    wholesale_pack_price: 0,
    wholesale_unit_price: 0,
    wholesale_tiers_json: '[]',
    ...product,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  
  await db.products.add(newProduct);
  return newProduct;
}

// Get product by barcode in current store
export async function getProductByBarcode(barcode: string): Promise<LocalProduct | null> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return null;
  
  const products = await db.products
    .where('store_id')
    .equals(storeId)
    .and(p => p.barcode === barcode && p.is_active === 1)
    .toArray();
  
  return products.length > 0 ? products[0] : null;
}

export async function getCurrentStoreExpenses(): Promise<LocalExpense[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.expenses.where('store_id').equals(storeId).toArray();
}

export async function addExpense(
  expense: Omit<LocalExpense, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'>
): Promise<LocalExpense> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const now = new Date().toISOString();
  const amount = toMoneyAmount(expense.amount);
  if (amount <= 0) throw new Error('Expense amount must be greater than zero');

  const newExpense: LocalExpense = {
    id: generateId(),
    store_id: storeId,
    ...expense,
    amount,
    created_at: now,
    updated_at: now,
    synced: 0,
  };

  await db.expenses.add(newExpense);
  return newExpense;
}

const RECURRING_EXPENSE_NAMESPACE = '03b00b87-2799-4f9d-8f12-c22709a8b991';

export async function getCurrentStoreRecurringExpenses(): Promise<LocalRecurringExpense[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.recurring_expenses.where('store_id').equals(storeId).toArray();
}

export async function addRecurringExpense(
  recurring: Omit<LocalRecurringExpense, 'id' | 'store_id' | 'created_at' | 'updated_at' | 'last_generated_month' | 'synced'>
): Promise<LocalRecurringExpense> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected.');
  const description = recurring.description.trim();
  const amount = toMoneyAmount(recurring.amount);
  if (!description || amount <= 0) throw new Error('Enter an expense description and a valid amount.');
  if (!Number.isSafeInteger(recurring.day_of_month) || recurring.day_of_month < 1 || recurring.day_of_month > 31) {
    throw new Error('Choose a recurring day between 1 and 31.');
  }
  const now = new Date().toISOString();
  const item: LocalRecurringExpense = {
    ...recurring,
    id: generateId(),
    store_id: storeId,
    description,
    amount,
    notes: recurring.notes.trim(),
    is_active: 1,
    last_generated_month: null,
    created_at: now,
    updated_at: now,
    synced: 0,
  };
  await db.recurring_expenses.add(item);
  return item;
}

export async function setRecurringExpenseActive(id: string, isActive: boolean): Promise<void> {
  const storeId = await getCurrentStoreId();
  const recurring = await db.recurring_expenses.get(id);
  if (!storeId || !recurring || recurring.store_id !== storeId) throw new Error('Recurring expense not found.');
  await db.recurring_expenses.update(id, {
    is_active: isActive ? 1 : 0,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function createDueRecurringExpenses(now = new Date()): Promise<number> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return 0;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const templates = await db.recurring_expenses
    .where('store_id').equals(storeId)
    .and((item) => item.is_active === 1 && (item.last_generated_month || '') < month)
    .toArray();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let created = 0;
  await db.transaction('rw', [db.recurring_expenses, db.expenses], async () => {
    for (const template of templates) {
      if (Math.min(template.day_of_month, lastDayOfMonth) > now.getDate()) continue;
      const expenseId = uuidv5(`${template.id}:${month}`, RECURRING_EXPENSE_NAMESPACE);
      const existing = await db.expenses.get(expenseId);
      if (!existing) {
        const createdAt = now.toISOString();
        await db.expenses.add({
          id: expenseId,
          store_id: storeId,
          description: template.description,
          category: template.category,
          amount: template.amount,
          notes: template.notes,
          recurring_expense_id: template.id,
          recurrence_month: month,
          created_at: createdAt,
          updated_at: createdAt,
          synced: 0,
        });
        created += 1;
      }
      await db.recurring_expenses.update(template.id, {
        last_generated_month: month,
        updated_at: now.toISOString(),
        synced: 0,
      });
    }
  });
  return created;
}

export async function getCurrentStoreExpenseBudgets(): Promise<LocalExpenseBudget[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.expense_budgets.where('store_id').equals(storeId).toArray();
}

export async function saveExpenseBudget(category: string, monthlyLimit: number): Promise<void> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected.');
  const cleanCategory = category.trim();
  const amount = toMoneyAmount(monthlyLimit);
  if (!cleanCategory || amount <= 0) throw new Error('Enter a category and a monthly budget greater than zero.');
  const existing = await db.expense_budgets.where('store_id').equals(storeId)
    .and((budget) => budget.category === cleanCategory).first();
  const budget = {
    id: existing?.id || uuidv5(`${storeId}:${cleanCategory}`, RECURRING_EXPENSE_NAMESPACE),
    store_id: storeId,
    category: cleanCategory,
    monthly_limit: amount,
    updated_at: new Date().toISOString(),
    synced: 0,
  };
  await db.expense_budgets.put(budget);
}

export async function updateExpense(
  id: string,
  updates: Partial<Pick<LocalExpense, 'description' | 'category' | 'amount' | 'notes'>>
): Promise<void> {
  const next = { ...updates };
  if (updates.amount !== undefined) {
    next.amount = toMoneyAmount(updates.amount);
    if ((next.amount ?? 0) <= 0) throw new Error('Expense amount must be greater than zero');
  }
  await db.expenses.update(id, {
    ...next,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function deleteExpense(id: string): Promise<void> {
  await db.expenses.delete(id);
}

export async function getCurrentStoreCashBookEntries(): Promise<LocalCashBookEntry[]> {
  const storeId = await getCurrentStoreId();
  if (!storeId) return [];
  return db.cash_book_entries.where('store_id').equals(storeId).toArray();
}

export async function addCashBookEntry(
  entry: Omit<
    LocalCashBookEntry,
    'id' | 'store_id' | 'created_at' | 'updated_at' | 'synced'
  >
): Promise<LocalCashBookEntry> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const now = new Date().toISOString();
  const entryDate = (entry.entry_date || now.slice(0, 10)).slice(0, 10);
  const amount = toMoneyAmount(entry.amount);
  if (amount <= 0) throw new Error('Cash book amount must be greater than zero');

  const newEntry: LocalCashBookEntry = {
    id: generateId(),
    store_id: storeId,
    ...entry,
    amount,
    entry_date: entryDate,
    created_at: now,
    updated_at: now,
    synced: 0,
  };

  await db.cash_book_entries.add(newEntry);
  return newEntry;
}

export async function deleteCashBookEntry(id: string): Promise<void> {
  await db.cash_book_entries.delete(id);
}

export async function importProductsFromRows(
  rows: Array<{
    name: string;
    category: string;
    barcode: string;
    cost_price: number;
    selling_price: number;
    stock_level: number;
    sku_type?: string;
    product_id?: string;
  }>
): Promise<{ imported: number; skipped: number; updated?: number; conflicts?: Array<any> }> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const { setProductStockLevel, getProductTotalStock } = await import('./warehouse');
  const { moneyEquals } = await import('./money');
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const conflicts: Array<any> = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    if (!row.name || !String(row.name).trim()) {
      skipped++;
      continue;
    }

    let existing: any = undefined;
    if ((row as any).product_id && typeof (row as any).product_id === 'string' && (row as any).product_id.trim()) {
      existing = await db.products.where('store_id').equals(storeId).and(p => p.id === (row as any).product_id.trim()).first();
    }
    if (!existing && row.barcode && String(row.barcode).trim()) {
      existing = await db.products
        .where('store_id')
        .equals(storeId)
        .and(p => p.barcode === String(row.barcode).trim())
        .first();
    }

    if (existing) {
      const incomingName = String(row.name).trim();
      const incomingCategory = (String(row.category || '').trim()) || existing.category || 'Other';
      const incomingBarcode = String(row.barcode || '').trim();
      const incomingSkuType = (String(row.sku_type || '').trim()) || existing.sku_type || 'unit';
      const incomingCost = toMoneyAmount(row.cost_price);
      const incomingSell = toMoneyAmount(row.selling_price);

      const nameMatch = incomingName.toLowerCase() === String(existing.name || '').toLowerCase();
      const categoryMatch = incomingCategory.toLowerCase() === String(existing.category || '').toLowerCase();
      const skuTypeMatch = incomingSkuType === String(existing.sku_type || '');
      const costMatch = moneyEquals ? moneyEquals(incomingCost, existing.cost_price) : Math.abs(incomingCost - existing.cost_price) < 0.01;
      const sellMatch = moneyEquals ? moneyEquals(incomingSell, existing.selling_price) : Math.abs(incomingSell - existing.selling_price) < 0.01;
      const barcodeChanged = incomingBarcode && incomingBarcode !== String(existing.barcode || '');

      const significantDiff = !nameMatch || !categoryMatch || !skuTypeMatch || !costMatch || !sellMatch || barcodeChanged;
      if (significantDiff) {
        conflicts.push({
          existing,
          incoming: {
            name: incomingName,
            category: incomingCategory,
            barcode: incomingBarcode,
            cost_price: incomingCost,
            selling_price: incomingSell,
            stock_level: Math.max(0, Math.round(Number(row.stock_level) || 0)),
            sku_type: incomingSkuType,
          },
        });
        skipped++;
        continue;
      }

      const qtyToAdd = Math.max(0, Math.round(Number(row.stock_level) || 0));
      if (qtyToAdd > 0) {
        try {
          const current = await getProductTotalStock(existing.id);
          await setProductStockLevel({
            storeId,
            productId: existing.id,
            targetQty: current + qtyToAdd,
            note: 'CSV import stock increment',
          });
        } catch {
          await setProductStockLevel({
            storeId,
            productId: existing.id,
            targetQty: (Number(existing.stock_level) || 0) + qtyToAdd,
            note: 'CSV import stock increment',
          });
        }
      }
      updated++;
      continue;
    }

    const productId = generateId();
    await db.products.add({
      id: productId,
      store_id: storeId,
      name: String(row.name).trim(),
      category: (String(row.category || '').trim()) || 'Other',
      sku_type: (String(row.sku_type || '').trim()) || 'unit',
      barcode: String(row.barcode || '').trim(),
      cost_price: toMoneyAmount(row.cost_price),
      selling_price: toMoneyAmount(row.selling_price),
      stock_level: 0,
      is_active: 1,
      image_url: '',
      pack_size: 1,
      track_expiry: 0,
      wholesale_mode: 'none',
      wholesale_pack_price: 0,
      wholesale_unit_price: 0,
      wholesale_tiers_json: '[]',
      created_at: now,
      updated_at: now,
      synced: 0,
    });
    const openingQty = Math.max(0, Math.round(Number(row.stock_level) || 0));
    if (openingQty > 0) {
      await setProductStockLevel({
        storeId,
        productId,
        targetQty: openingQty,
        note: 'CSV import opening stock',
      });
    }
    imported++;
  }

  return { imported, skipped, updated, conflicts };
}



function formatSyncError(label: string, error: unknown): string {
  const message = formatUnknownError(error);
  if (message.includes('Load failed') || message.includes('Failed to fetch')) {
    return `${label}: Could not reach Supabase. Check your internet connection and VITE_SUPABASE_URL.`;
  }
  return `${label}: ${message}`;
}

function asQty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const floored = Math.floor(n);
  return floored > 50_000_000 ? 0 : floored;
}

/** PostgREST defaults to 1000 rows — page so phone and laptop pull the same full ledger. */
async function fetchAllStoreRows(
  table: string,
  storeId: string
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const pageSize = 1000;
  const all: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('store_id', storeId)
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = (data || []) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from >= 50_000) break;
  }
  return { data: all, error: null };
}

function mapCloudBatch(row: Record<string, unknown>): LocalStockBatch {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    product_id: String(row.product_id),
    location_id: String(row.location_id),
    batch_code: String(row.batch_code || ''),
    expiry_date: (row.expiry_date as string) || null,
    quantity: asQty(row.quantity),
    cost_price: Number(row.cost_price) || 0,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || row.created_at || ''),
    synced: 1,
  };
}

function mapCloudLocation(row: Record<string, unknown>): LocalLocation {
  return {
    id: String(row.id),
    store_id: String(row.store_id),
    name: String(row.name || ''),
    location_type: row.location_type === 'warehouse' ? 'warehouse' : 'shop',
    is_default: row.is_default ? 1 : 0,
    is_active: row.is_active === false ? 0 : 1,
    access_pin_hash: (row.access_pin_hash as string) || null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || row.created_at || ''),
    synced: 1,
  };
}

/**
 * Replace this store's local stock ledger with the cloud snapshot so every
 * phone and computer shows the same figures. Keeps only unsynced local
 * deductions (sales not pushed yet) and unsynced non-OPENING receives.
 */
export async function adoptCloudStockLedger(
  storeId: string
): Promise<{ ok: boolean; batchCount: number; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, batchCount: 0, error: 'Supabase not configured' };
  }

  const { data: remoteRows, error } = await fetchAllStoreRows('stock_batches', storeId);
  if (error || !remoteRows) {
    return { ok: false, batchCount: 0, error: formatUnknownError(error) || 'Could not pull stock from cloud' };
  }

  const { data: remoteLocs, error: locError } = await fetchAllStoreRows('locations', storeId);
  if (locError || !remoteLocs) {
    return { ok: false, batchCount: 0, error: formatUnknownError(locError) || 'Could not pull locations from cloud' };
  }

  const localBatches = await db.stock_batches.where('store_id').equals(storeId).toArray();
  const localById = new Map(localBatches.map((b) => [b.id, b]));
  const remoteBatches = remoteRows.map(mapCloudBatch);
  const remoteIds = new Set(remoteBatches.map((b) => b.id));

  const nextBatches: LocalStockBatch[] = remoteBatches.map((remote) => {
    const local = localById.get(remote.id);
    if (local && local.synced === 0 && asQty(local.quantity) < asQty(remote.quantity)) {
      return {
        ...remote,
        quantity: asQty(local.quantity),
        updated_at: local.updated_at || remote.updated_at,
        synced: 0,
      };
    }
    return remote;
  });

  for (const local of localBatches) {
    if (remoteIds.has(local.id)) continue;
    if (local.synced !== 0) continue;
    if ((local.batch_code || '').trim().toUpperCase() === 'OPENING') continue;
    if (!isUuid(local.id) || !isUuid(local.product_id) || !isUuid(local.location_id)) continue;
    nextBatches.push({ ...local, quantity: asQty(local.quantity) });
  }

  const remoteLocations = remoteLocs.map(mapCloudLocation);
  const remoteLocIds = new Set(remoteLocations.map((l) => l.id));
  const localLocations = await db.locations.where('store_id').equals(storeId).toArray();

  await db.transaction('rw', db.stock_batches, db.locations, async () => {
    await db.stock_batches.where('store_id').equals(storeId).delete();
    if (nextBatches.length > 0) {
      await db.stock_batches.bulkPut(nextBatches);
    }
    for (const loc of localLocations) {
      if (remoteLocIds.has(loc.id)) continue;
      const keepNew =
        loc.synced === 0 && isUuid(loc.id) && loc.location_type === 'warehouse';
      if (!keepNew) {
        await db.locations.delete(loc.id);
      }
    }
    if (remoteLocations.length > 0) {
      await db.locations.bulkPut(remoteLocations);
    }
  });

  return { ok: true, batchCount: nextBatches.length };
}

let hydrateInFlight: Promise<{ ok: boolean; message: string }> | null = null;
/** Last successful cloud stock adopt (ms). Used to skip duplicate pulls. */
export let lastStockHydrateOkAt = 0;

export async function refreshStockFromCloud(): Promise<{ ok: boolean; message: string }> {
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = (async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) return { ok: false, message: 'No store selected' };

    if (!isSupabaseConfigured()) {
      return { ok: false, message: 'Supabase not configured' };
    }

    const adopted = await adoptCloudStockLedger(storeId);
    if (!adopted.ok) {
      return { ok: false, message: adopted.error || 'Cloud stock pull failed' };
    }

    try {
      const { canonicalizeStoreStock, syncStoreCatalogStockFromBatches } = await import('@/lib/warehouse');
      await canonicalizeStoreStock(storeId);
      await syncStoreCatalogStockFromBatches(storeId);
    } catch {
      // Ledger was replaced even if heal fails
    }

    lastStockHydrateOkAt = Date.now();
    return { ok: true, message: `Stock matched to cloud (${adopted.batchCount} batches)` };
  })();

  try {
    return await hydrateInFlight;
  } finally {
    hydrateInFlight = null;
  }
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

/**
 * Current cloud PIN hashes for users whose local row is unsynced for reasons other
 * than a PIN change (phone, permissions, layout…). Pushing those rows must not
 * revert a PIN that was changed on another device or by the admin portal.
 */
async function fetchCloudPinHashes(userIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (userIds.length === 0) return result;
  const { data, error } = await supabase.from('users').select('id, pin_hash').in('id', userIds);
  if (error) {
    console.warn('[Sync] Could not read cloud PIN hashes:', error.message);
    return result;
  }
  for (const row of data || []) {
    const hash = typeof row.pin_hash === 'string' ? row.pin_hash : '';
    if (hash) result.set(String(row.id), hash);
  }
  return result;
}

async function upsertToSupabase<T extends Record<string, unknown>>(
  label: string,
  table:
    | 'stores'
    | 'users'
    | 'products'
    | 'product_categories'
    | 'customers'
    | 'customer_opening_payments'
    | 'transactions'
    | 'transaction_items'
    | 'credit_payments'
    | 'customer_account_receipts'
    | 'sales_returns'
    | 'customer_wallet_transactions'
    | 'expenses'
    | 'recurring_expenses'
    | 'expense_budgets'
    | 'cash_book_entries'
    | 'locations'
    | 'stock_batches'
    | 'stock_movements'
    | 'online_orders'
    | 'online_order_items'
    | 'suppliers'
    | 'purchase_orders'
    | 'bulk_sms_campaigns'
    | 'debt_reminders',
  rows: T[],
  markSynced: () => Promise<void>,
  errors: string[]
): Promise<number> {
  if (rows.length === 0) return 0;

  try {
    // Append-only ledgers have INSERT policies but historically no UPDATE.
    // PostgREST upsert is ON CONFLICT DO UPDATE and needs UPDATE RLS (42501).
    const appendOnly =
      table === 'stock_movements' ||
      table === 'transaction_items' ||
      table === 'credit_payments' ||
      table === 'customer_wallet_transactions' ||
      table === 'bulk_sms_campaigns' ||
      table === 'debt_reminders';
    const { error } = await supabase.from(table).upsert(rows as Record<string, unknown>[], {
      onConflict: 'id',
      ignoreDuplicates: appendOnly,
    });
    if (error) {
        if (
        table === 'stores' &&
        /session_timeout_minutes|cashiers_can_view_stock/i.test(error.message)
      ) {
        const stripped = rows.map((row) => {
          const copy = { ...(row as Record<string, unknown>) };
          if (/session_timeout_minutes/i.test(error.message)) delete copy.session_timeout_minutes;
          if (/cashiers_can_view_stock/i.test(error.message)) delete copy.cashiers_can_view_stock;
          return copy;
        });
        const retry = await supabase.from(table).upsert(stripped, {
          onConflict: 'id',
          ignoreDuplicates: appendOnly,
        });
        if (!retry.error) {
          await markSynced();
          return rows.length;
        }
      }
      if (
        table === 'users' &&
        /can_view_stock|can_discount/i.test(error.message)
      ) {
        const stripped = rows.map((row) => {
          const copy = { ...(row as Record<string, unknown>) };
          if (/can_view_stock/i.test(error.message)) delete copy.can_view_stock;
          if (/can_discount/i.test(error.message)) delete copy.can_discount;
          return copy;
        });
        const retry = await supabase.from(table).upsert(stripped, {
          onConflict: 'id',
          ignoreDuplicates: appendOnly,
        });
        if (!retry.error) {
          await markSynced();
          return rows.length;
        }
      }
      if (
        table === 'stores' &&
        /debt_reminder|sales_target/i.test(error.message)
      ) {
        // Cloud project predates the debt-reminder / sales-target columns.
        // Push the store without them so the rest of the profile still syncs.
        const stripped = rows.map((row) => {
          const copy = { ...(row as Record<string, unknown>) };
          delete copy.debt_reminders_enabled;
          delete copy.debt_reminder_interval_days;
          delete copy.debt_reminder_min_balance;
          delete copy.debt_reminder_message;
          delete copy.sales_target_daily;
          delete copy.sales_target_monthly;
          return copy;
        });
        const retry = await supabase.from(table).upsert(stripped, {
          onConflict: 'id',
          ignoreDuplicates: appendOnly,
        });
        if (!retry.error) {
          await markSynced();
          return rows.length;
        }
      }
      if (
        table === 'customers' &&
        /debt_reminder_opt_out/i.test(error.message)
      ) {
        const stripped = rows.map((row) => {
          const copy = { ...(row as Record<string, unknown>) };
          delete copy.debt_reminder_opt_out;
          return copy;
        });
        const retry = await supabase.from(table).upsert(stripped, {
          onConflict: 'id',
          ignoreDuplicates: appendOnly,
        });
        if (!retry.error) {
          await markSynced();
          return rows.length;
        }
      }
      if (
        table === 'transactions' &&
        /other_charges|updated_at|wallet_amount|credit_paid_amount|credit_balance|sale_mode/i.test(error.message)
      ) {
        // Older Supabase projects may not have all checkout columns yet. A
        // missing optional column must not strand an otherwise valid offline sale.
        const stripped = rows.map((row) => {
          const copy = { ...(row as Record<string, unknown>) };
          const message = error.message.toLowerCase();
          if (message.includes('other_charges')) {
            delete copy.other_charges_json;
            delete copy.other_charges_total;
          }
          if (message.includes('updated_at')) delete copy.updated_at;
          if (message.includes('wallet_amount')) delete copy.wallet_amount;
          if (message.includes('credit_paid_amount')) delete copy.credit_paid_amount;
          if (message.includes('credit_balance')) delete copy.credit_balance;
          if (message.includes('sale_mode')) delete copy.sale_mode;
          return copy;
        });
        const retry = await supabase.from(table).upsert(stripped, {
          onConflict: 'id',
          ignoreDuplicates: appendOnly,
        });
        if (!retry.error) {
          await markSynced();
          return rows.length;
        }
        errors.push(formatSyncError('Transactions (retry)', retry.error));
        return 0;
      }
      if (
        table === 'debt_reminders' &&
        /does not exist|PGRST205|schema cache/i.test(error.message || '')
      ) {
        // The cloud project has no debt_reminders table yet. Keep the local
        // audit trail unsynced so it uploads once the migration is applied.
        return 0;
      }
      if (
        table === 'bulk_sms_campaigns' &&
        (/row-level security/i.test(error.message || '') ||
          /42501/.test(error.code || ''))
      ) {
        // The cloud still blocks device writes to the campaign log. Keep the
        // local rows so they upload after the migration is applied, and say
        // exactly what to run.
        errors.push(
          `${label}: the cloud is still blocking this device from saving campaigns. Run supabase-migrate-bulk-sms-device-writes.sql in the Supabase SQL editor.`
        );
        return 0;
      }
      errors.push(formatSyncError(label, error));
      return 0;
    }

    await markSynced();
    return rows.length;
  } catch (error) {
    errors.push(formatSyncError(label, error));
    return 0;
  }
}

// Sync to Supabase
export async function syncToSupabase(opts?: { skipPing?: boolean; skipCanonicalize?: boolean }): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured. Add environment variables to enable cloud sync.' };
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) {
    return { success: false, message: 'No store selected' };
  }

  if (!opts?.skipPing) {
    const connection = await testSupabaseConnection();
    if (!connection.ok) {
      return { success: false, message: connection.error || 'Could not connect to Supabase.' };
    }
  }

  const errors: string[] = [];
  let syncedCount = 0;

  try {
    if (!opts?.skipCanonicalize) {
      try {
        const { canonicalizeStoreStock } = await import('@/lib/warehouse');
        await canonicalizeStoreStock(storeId);
      } catch {
        // Push remaining UUID-safe rows even if heal fails
      }
    }

    // Push hard-deletes first so cloud rows (and CASCADE children) are removed
    const pendingDeletes = await db.deleted_records
      .where('store_id')
      .equals(storeId)
      .and((r) => r.synced === 0)
      .toArray();

    for (const del of pendingDeletes) {
      if (del.table_name !== 'products') continue;
      try {
        const { error } = await supabase.from('products').delete().eq('id', del.record_id);
        if (error) {
          errors.push(formatSyncError('Product delete', error));
        } else {
          await db.deleted_records.update(del.id, { synced: 1 });
          syncedCount += 1;
        }
      } catch (error) {
        errors.push(formatSyncError('Product delete', error));
      }
    }

    const { refreshRemoteLedgerClearAndApply, shouldPushLedgerRow } = await import('./storeLedgerClear');
    const ledgerSync = await refreshRemoteLedgerClearAndApply(storeId);
    const ledgerClearedAt = ledgerSync.clearedAt;

    const store = await db.stores.get(storeId);
    if (store && store.synced === 0) {
      // Do NOT push admin-managed fields — local defaults would overwrite raised limits.
      syncedCount += await upsertToSupabase(
        'Store',
        'stores',
        [{
          id: store.id,
          name: store.name,
          address: store.address,
          support_number: store.support_number,
          discount_cap_percentage: store.discount_cap_percentage,
          pin_on_discount_enabled: store.pin_on_discount_enabled === 1,
          discount_allow_percentage: (store.discount_allow_percentage ?? 1) === 1,
          discount_allow_fixed: (store.discount_allow_fixed ?? 1) === 1,
          cashier_can_discount: (store.cashier_can_discount ?? 1) === 1,
          cashiers_can_view_stock: (store.cashiers_can_view_stock ?? 1) === 1,
          session_timeout_minutes: normalizeSessionTimeoutMinutes(store.session_timeout_minutes),
          momo_account_name: store.momo_account_name || '',
          momo_number: store.momo_number || '',
          momo_network: store.momo_network || '',
          logo_url: store.logo_url || '',
          ecommerce_links: store.ecommerce_links || '[]',
          currency_code: store.currency_code || 'GHS',
          preferred_language: store.preferred_language === 'fr' ? 'fr' : 'en',
          debt_reminders_enabled: (store.debt_reminders_enabled ?? 0) === 1,
          debt_reminder_interval_days: normalizeDebtReminderIntervalDays(store.debt_reminder_interval_days),
          debt_reminder_min_balance: Math.max(0, Number(store.debt_reminder_min_balance) || 0),
          debt_reminder_message: store.debt_reminder_message || DEFAULT_DEBT_REMINDER_TEMPLATE,
          sales_target_daily: Math.max(0, Number(store.sales_target_daily) || 0),
          sales_target_monthly: Math.max(0, Number(store.sales_target_monthly) || 0),
          created_at: store.created_at,
        }],
        async () => { await db.stores.update(storeId, { synced: 1 }); },
        errors
      );

    }

    const unsyncedUsers = await db.users.where('store_id').equals(storeId).and(u => u.synced === 0).toArray();
    const cloudPinHashes = await fetchCloudPinHashes(
      unsyncedUsers.filter((u) => !hasPendingPinChange(u)).map((u) => u.id)
    );
    syncedCount += await upsertToSupabase(
      'Users',
      'users',
      unsyncedUsers.map(u => ({
        id: u.id,
        store_id: u.store_id,
        name: u.name,
        role: u.role,
        pin_hash: hasPendingPinChange(u) ? u.pin_hash : cloudPinHashes.get(u.id) || u.pin_hash,
        is_active: u.is_active === 1,
        phone: u.phone || '',
        assigned_location_id: uuidOrNull(u.assigned_location_id),
        can_wholesale: (u.can_wholesale ?? 0) === 1,
        can_sell_from_warehouse: (u.can_sell_from_warehouse ?? 0) === 1,
        can_manage_ecommerce: (u.can_manage_ecommerce ?? (u.role === 'owner' ? 1 : 0)) === 1,
        can_access_cashbook: u.role === 'owner' ? true : (u.can_access_cashbook ?? 1) === 1,
        ...(u.can_view_stock === 0 || u.can_view_stock === 1 ? { can_view_stock: u.can_view_stock === 1 } : {}),
        ...(u.can_discount === 0 || u.can_discount === 1 ? { can_discount: u.can_discount === 1 } : {}),
        pos_layout_json: u.role === 'owner' ? u.pos_layout_json || null : null,
        created_at: u.created_at,
      })),
      async () => {
        await Promise.all(unsyncedUsers.map((u) => {
          const cloudHash = hasPendingPinChange(u) ? null : cloudPinHashes.get(u.id);
          return db.users.update(u.id, {
            synced: 1,
            pin_dirty: 0,
            ...(cloudHash && cloudHash !== u.pin_hash ? { pin_hash: cloudHash } : {}),
          });
        }));
      },
      errors
    );

    const unsyncedLocations = await db.locations.where('store_id').equals(storeId).and(l => l.synced === 0).toArray();
    const locationsToPush = unsyncedLocations.filter((l) => isUuid(l.id) && isUuid(l.store_id));
    for (const leftover of unsyncedLocations) {
      if (isUuid(leftover.id) && isUuid(leftover.store_id)) continue;
      await db.locations.delete(leftover.id);
    }
    syncedCount += await upsertToSupabase(
      'Locations',
      'locations',
      locationsToPush.map(l => ({
        id: l.id,
        store_id: l.store_id,
        name: l.name,
        location_type: l.location_type,
        is_default: l.is_default === 1,
        is_active: l.is_active === 1,
        access_pin_hash: l.access_pin_hash || null,
        created_at: l.created_at,
        updated_at: l.updated_at,
      })),
      async () => { await Promise.all(locationsToPush.map(l => db.locations.update(l.id, { synced: 1 }))); },
      errors
    );

    const unsyncedProducts = await db.products.where('store_id').equals(storeId).and(p => p.synced === 0).toArray();
    const unsyncedCategories = await db.product_categories
      .where('store_id')
      .equals(storeId)
      .and((category) => category.synced === 0)
      .toArray();
    if (unsyncedCategories.length > 0) {
      const { data: remoteCategories, error: categoryReadError } = await supabase
        .from('product_categories')
        .select('id, name')
        .eq('store_id', storeId);
      if (categoryReadError) {
        errors.push(formatSyncError('Product categories', categoryReadError));
      } else {
        const remoteIdsByName = new Map(
          (remoteCategories || []).map((category) => [
            String(category.name || '').toLowerCase(),
            String(category.id),
          ])
        );
        const categoriesToPush = unsyncedCategories.map((category) => ({
          ...category,
          id: remoteIdsByName.get(category.name.toLowerCase()) || category.id,
        }));
        syncedCount += await upsertToSupabase(
          'Product categories',
          'product_categories',
          categoriesToPush.map((category) => ({
            id: category.id,
            store_id: category.store_id,
            name: category.name,
            is_active: category.is_active === 1,
            created_at: category.created_at,
            updated_at: category.updated_at,
          })),
          async () => {
            await db.transaction('rw', db.product_categories, async () => {
              for (let index = 0; index < categoriesToPush.length; index += 1) {
                const category = categoriesToPush[index];
                const original = unsyncedCategories[index];
                if (category.id !== original.id) {
                  await db.product_categories.delete(original.id);
                }
                await db.product_categories.put({ ...category, synced: 1 });
              }
            });
          },
          errors
        );
      }
    }
    syncedCount += await upsertToSupabase(
      'Products',
      'products',
      unsyncedProducts.map(p => ({
        id: p.id,
        store_id: p.store_id,
        name: p.name,
        category: p.category,
        sku_type: p.sku_type,
        barcode: p.barcode,
        cost_price: p.cost_price,
        selling_price: p.selling_price,
        stock_level: p.stock_level,
        is_active: p.is_active === 1,
        image_url: p.image_url || '',
        pack_size: p.pack_size ?? 1,
        track_expiry: (p.track_expiry ?? 0) === 1,
        wholesale_mode: p.wholesale_mode || 'none',
        wholesale_pack_price: p.wholesale_pack_price ?? 0,
        wholesale_unit_price: p.wholesale_unit_price ?? 0,
        wholesale_tiers_json: p.wholesale_tiers_json || '[]',
        sell_online: (p.sell_online ?? 0) === 1,
        reorder_level: Number(p.reorder_level) || 0,
        created_at: p.created_at,
        updated_at: p.updated_at,
      })),
      async () => { await Promise.all(unsyncedProducts.map(p => db.products.update(p.id, { synced: 1 }))); },
      errors
    );

    // Products and locations must exist before batches; batches must exist before movements.
    const unsyncedBatches = await db.stock_batches.where('store_id').equals(storeId).and(b => b.synced === 0).toArray();
    const batchesToPush: LocalStockBatch[] = [];
    const openingUnsynced = unsyncedBatches.filter(
      (b) => (b.batch_code || '').trim().toUpperCase() === 'OPENING'
    );
    const remoteOpeningQty = new Map<string, { quantity: number; updated_at: string }>();
    if (openingUnsynced.length > 0) {
      const { data: remoteOpenings } = await fetchAllStoreRows('stock_batches', storeId);
      for (const row of remoteOpenings || []) {
        if (String(row.batch_code || '').trim().toUpperCase() !== 'OPENING') continue;
        remoteOpeningQty.set(String(row.id), {
          quantity: asQty(row.quantity),
          updated_at: String(row.updated_at || row.created_at || ''),
        });
      }
    }
    for (const batch of unsyncedBatches) {
      const localQty = asQty(batch.quantity);
      if ((batch.batch_code || '').trim().toUpperCase() === 'OPENING') {
        const remote = remoteOpeningQty.get(batch.id);
        if (remote && remote.quantity < localQty) {
          // Cloud already has a deducted qty — do not resurrect stock from a stale device OPENING
          await db.stock_batches.update(batch.id, {
            quantity: remote.quantity,
            updated_at: remote.updated_at || batch.updated_at,
            synced: 1,
          });
          continue;
        }
      }
      if (!isUuid(batch.id) || !isUuid(batch.store_id) || !isUuid(batch.product_id) || !isUuid(batch.location_id)) {
        await db.stock_batches.delete(batch.id);
        continue;
      }
      batchesToPush.push({ ...batch, quantity: localQty });
    }
    syncedCount += await upsertToSupabase(
      'Stock batches',
      'stock_batches',
      batchesToPush.map(b => ({
        id: b.id,
        store_id: b.store_id,
        product_id: b.product_id,
        location_id: b.location_id,
        batch_code: b.batch_code || '',
        expiry_date: dateOrNull(b.expiry_date),
        quantity: b.quantity,
        cost_price: b.cost_price,
        created_at: b.created_at,
        updated_at: b.updated_at,
      })),
      async () => { await Promise.all(batchesToPush.map(b => db.stock_batches.update(b.id, { synced: 1 }))); },
      errors
    );

    const unsyncedMovements = await db.stock_movements.where('store_id').equals(storeId).and(m => m.synced === 0).toArray();
    const movementsToPush: LocalStockMovement[] = [];
    if (unsyncedMovements.length > 0) {
      // Ensure products referenced by movements exist in cloud before pushing movements.
      // Products are pushed earlier in this sync; re-upserting referenced products guards
      // against rows marked synced locally yet missing from cloud (FK violation 23503).
      const referencedProductIds = [...new Set(unsyncedMovements.map(m => m.product_id).filter((id): id is string => typeof id === 'string' && id.length > 0))];
      const referencedProducts = await db.products.where('id').anyOf(referencedProductIds).toArray();
      const localProductIds = new Set(referencedProducts.filter(p => p.store_id === storeId).map(p => p.id));
      if (referencedProducts.length > 0) {
        await upsertToSupabase(
          'Products (movement references)',
          'products',
          referencedProducts.filter(p => p.store_id === storeId).map(p => ({
            id: p.id,
            store_id: p.store_id,
            name: p.name,
            category: p.category,
            sku_type: p.sku_type,
            barcode: p.barcode,
            cost_price: p.cost_price,
            selling_price: p.selling_price,
            stock_level: p.stock_level,
            is_active: p.is_active === 1,
            image_url: p.image_url || '',
            pack_size: p.pack_size ?? 1,
            track_expiry: (p.track_expiry ?? 0) === 1,
            wholesale_mode: p.wholesale_mode || 'none',
            wholesale_pack_price: p.wholesale_pack_price ?? 0,
            wholesale_unit_price: p.wholesale_unit_price ?? 0,
            wholesale_tiers_json: p.wholesale_tiers_json || '[]',
            sell_online: (p.sell_online ?? 0) === 1,
            reorder_level: Number(p.reorder_level) || 0,
            created_at: p.created_at,
            updated_at: p.updated_at,
          })),
          async () => {},
          errors
        );
      }
      for (const movement of unsyncedMovements) {
        if (!isUuid(movement.id) || !isUuid(movement.store_id) || !isUuid(movement.product_id)) {
        await db.stock_movements.delete(movement.id);
        continue;
      }
      movementsToPush.push(movement);
    }
    syncedCount += await upsertToSupabase(
      'Stock movements',
      'stock_movements',
      movementsToPush.map(m => ({
        id: m.id,
        store_id: m.store_id,
        product_id: m.product_id,
        batch_id: uuidOrNull(m.batch_id),
        from_location_id: uuidOrNull(m.from_location_id),
        to_location_id: uuidOrNull(m.to_location_id),
        movement_type: m.movement_type,
        quantity: m.quantity,
        note: m.note || '',
        user_id: uuidOrNull(m.user_id),
        created_at: m.created_at,
      })),
      async () => { await Promise.all(movementsToPush.map(m => db.stock_movements.update(m.id, { synced: 1 }))); },
      errors
    );
    }

    const unsyncedCustomers = await db.customers
      .where('store_id')
      .equals(storeId)
      .and((customer) => customer.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Customers',
      'customers',
      unsyncedCustomers.map((customer) => ({
        id: customer.id,
        store_id: customer.store_id,
        name: customer.name,
        phone: customer.phone,
        location_id: uuidOrNull(customer.location_id),
        address: customer.address || '',
        opening_balance: customer.opening_balance,
        opening_balance_remaining: customer.opening_balance_remaining,
        wallet_balance: Number(customer.wallet_balance) || 0,
        is_active: customer.is_active === 1,
        debt_reminder_opt_out: (customer.debt_reminder_opt_out ?? 0) === 1,
        created_at: customer.created_at,
        updated_at: customer.updated_at,
      })),
      async () => {
        await Promise.all(unsyncedCustomers.map((customer) =>
          db.customers.update(customer.id, { synced: 1 })
        ));
      },
      errors
    );

    const unsyncedDebtReminders = await db.debt_reminders
      .where('store_id')
      .equals(storeId)
      .and((reminder) => reminder.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Debt reminders',
      'debt_reminders',
      unsyncedDebtReminders.map((reminder) => ({
        id: reminder.id,
        store_id: reminder.store_id,
        customer_id: reminder.customer_id,
        customer_name: reminder.customer_name,
        customer_phone: reminder.customer_phone,
        balance: reminder.balance,
        message: reminder.message,
        provider: reminder.provider,
        provider_message_id: reminder.provider_message_id || null,
        status: reminder.status,
        error_message: reminder.error_message || null,
        sent_at: reminder.sent_at,
        created_at: reminder.created_at,
      })),
      async () => {
        await Promise.all(unsyncedDebtReminders.map((reminder) =>
          db.debt_reminders.update(reminder.id, { synced: 1 })
        ));
      },
      errors
    );

    const unsyncedTxns = await db.transactions
      .where('store_id')
      .equals(storeId)
      .and((t) => t.synced === 0 && shouldPushLedgerRow(t.created_at, ledgerClearedAt))
      .toArray();
    syncedCount += await upsertToSupabase(
      'Transactions',
      'transactions',
      unsyncedTxns.map(t => ({
        id: t.id,
        store_id: t.store_id,
        receipt_number: t.receipt_number,
        cashier_id: uuidOrNull(t.cashier_id),
        cashier_name: t.cashier_name,
        total_amount: t.total_amount,
        discount_applied: t.discount_applied,
        other_charges_json: t.other_charges_json || '[]',
        other_charges_total: Number(t.other_charges_total) || 0,
        payment_method: t.payment_method,
        cash_amount: t.cash_amount,
        paystack_amount: t.paystack_amount,
        paystack_reference: t.paystack_reference,
        manual_payment_amount: Number(t.manual_payment_amount) || 0,
        wallet_amount: Number(t.wallet_amount) || 0,
        payment_reference: t.payment_reference || '',
        customer_name: t.customer_name || '',
        customer_phone: t.customer_phone || '',
        customer_id: uuidOrNull(t.customer_id),
        credit_paid_amount: Number(t.credit_paid_amount) || 0,
        credit_balance: Number(t.credit_balance) || 0,
        status: t.status,
        location_id: uuidOrNull(t.location_id),
        sale_mode: t.sale_mode || 'retail',
        created_at: t.created_at,
        updated_at: t.updated_at || t.created_at,
      })),
      async () => { await Promise.all(unsyncedTxns.map(t => db.transactions.update(t.id, { synced: 1 }))); },
      errors
    );

    const unsyncedAccountReceipts = await db.customer_account_receipts
      .where('store_id')
      .equals(storeId)
      .and((receipt) => receipt.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Customer account receipts',
      'customer_account_receipts',
      unsyncedAccountReceipts.map((receipt) => ({
        id: receipt.id,
        store_id: receipt.store_id,
        customer_id: receipt.customer_id,
        receipt_number: receipt.receipt_number,
        amount: receipt.amount,
        cash_amount: receipt.cash_amount,
        momo_amount: receipt.momo_amount,
        cheque_amount: receipt.cheque_amount,
        balance_before: receipt.balance_before,
        balance_after: receipt.balance_after,
        created_by: receipt.created_by,
        created_at: receipt.created_at,
      })),
      async () => {
        await Promise.all(unsyncedAccountReceipts.map((receipt) =>
          db.customer_account_receipts.update(receipt.id, { synced: 1 })
        ));
      },
      errors
    );

    const unsyncedCustomerOpeningPayments = await db.customer_opening_payments
      .where('store_id')
      .equals(storeId)
      .and((payment) => payment.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Customer opening payments',
      'customer_opening_payments',
      unsyncedCustomerOpeningPayments.map((payment) => ({
        id: payment.id,
        store_id: payment.store_id,
        customer_id: payment.customer_id,
        entry_type: payment.entry_type,
        amount: payment.amount,
        payment_method: payment.payment_method || 'cash',
        cash_amount: Number(payment.cash_amount) || (payment.payment_method === 'cash' || !payment.payment_method ? payment.amount : 0),
        momo_amount: Number(payment.momo_amount) || 0,
        cheque_amount: Number(payment.cheque_amount) || 0,
        account_receipt_id: payment.account_receipt_id || null,
        created_by: payment.created_by,
        created_at: payment.created_at,
      })),
      async () => {
        await Promise.all(unsyncedCustomerOpeningPayments.map((payment) =>
          db.customer_opening_payments.update(payment.id, { synced: 1 })
        ));
      },
      errors
    );

    const unsyncedCreditPayments = await db.credit_payments
      .where('store_id')
      .equals(storeId)
      .and((payment) => payment.synced === 0 && shouldPushLedgerRow(payment.created_at, ledgerClearedAt))
      .toArray();
    syncedCount += await upsertToSupabase(
      'Credit payments',
      'credit_payments',
      unsyncedCreditPayments.map((payment) => ({
        id: payment.id,
        store_id: payment.store_id,
        transaction_id: payment.transaction_id,
        customer_id: payment.customer_id || null,
        account_receipt_id: payment.account_receipt_id || null,
        amount: payment.amount,
        payment_method: payment.payment_method,
        cash_amount: Number(payment.cash_amount) || 0,
        momo_amount: Number(payment.momo_amount) || 0,
        cheque_amount: Number(payment.cheque_amount) || 0,
        created_by: payment.created_by,
        created_at: payment.created_at,
      })),
      async () => {
        await Promise.all(unsyncedCreditPayments.map((payment) =>
          db.credit_payments.update(payment.id, { synced: 1 })
        ));
      },
      errors
    );

    const keepTxnIds = new Set(
      (await db.transactions.where('store_id').equals(storeId).toArray()).map((t) => t.id)
    );
    const unsyncedItems = await db.transaction_items
      .where('store_id')
      .equals(storeId)
      .and((i) => i.synced === 0 && keepTxnIds.has(i.transaction_id))
      .toArray();
    syncedCount += await upsertToSupabase(
      'Transaction items',
      'transaction_items',
      unsyncedItems.map(i => ({
        id: i.id,
        store_id: i.store_id,
        transaction_id: i.transaction_id,
        product_id: uuidOrNull(i.product_id),
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
        sale_mode: i.sale_mode === 'wholesale' ? 'wholesale' : 'retail',
        unit_type: i.unit_type || 'base',
        pack_size: i.pack_size ?? 1,
        base_quantity: i.base_quantity ?? i.quantity,
        batch_id: uuidOrNull(i.batch_id),
      })),
      async () => { await Promise.all(unsyncedItems.map(i => db.transaction_items.update(i.id, { synced: 1 }))); },
      errors
    );

    const unsyncedReturns = await db.sales_returns
      .where('store_id')
      .equals(storeId)
      .and((record) => record.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Sales returns',
      'sales_returns',
      unsyncedReturns.map((record) => ({
        id: record.id,
        store_id: record.store_id,
        transaction_id: record.transaction_id,
        transaction_item_id: record.transaction_item_id,
        product_id: record.product_id,
        product_name: record.product_name,
        quantity: record.quantity,
        stock_quantity: record.stock_quantity,
        reason: record.reason,
        photo_data_url: record.photo_data_url,
        receipt_number: record.receipt_number,
        location_id: record.location_id,
        customer_id: record.customer_id || null,
        refund_method: record.refund_method,
        refund_amount: record.refund_amount,
        debt_applied: record.debt_applied,
        wallet_credit: record.wallet_credit,
        created_by: record.created_by,
        created_at: record.created_at,
      })),
      async () => {
        await Promise.all(unsyncedReturns.map((record) =>
          db.sales_returns.update(record.id, { synced: 1 })
        ));
      },
      errors
    );

    const unsyncedWalletTransactions = await db.customer_wallet_transactions
      .where('store_id')
      .equals(storeId)
      .and((record) => record.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Customer wallet transactions',
      'customer_wallet_transactions',
      unsyncedWalletTransactions.map((record) => ({
        id: record.id,
        store_id: record.store_id,
        customer_id: record.customer_id,
        type: record.type,
        amount: record.amount,
        balance_after: record.balance_after,
        return_id: record.return_id || null,
        transaction_id: record.transaction_id || null,
        description: record.description,
        created_by: record.created_by,
        created_at: record.created_at,
      })),
      async () => {
        await Promise.all(unsyncedWalletTransactions.map((record) =>
          db.customer_wallet_transactions.update(record.id, { synced: 1 })
        ));
      },
      errors
    );

    const unsyncedExpenses = await db.expenses
      .where('store_id')
      .equals(storeId)
      .and((e) => e.synced === 0 && shouldPushLedgerRow(e.created_at, ledgerClearedAt))
      .toArray();
    syncedCount += await upsertToSupabase(
      'Expenses',
      'expenses',
      unsyncedExpenses.map(e => ({
        id: e.id,
        store_id: e.store_id,
        description: e.description,
        category: e.category,
        amount: e.amount,
        notes: e.notes,
        receipt_image_data_url: e.receipt_image_data_url || '',
        recurring_expense_id: uuidOrNull(e.recurring_expense_id),
        recurrence_month: e.recurrence_month || null,
        created_at: e.created_at,
        updated_at: e.updated_at,
      })),
      async () => { await Promise.all(unsyncedExpenses.map(e => db.expenses.update(e.id, { synced: 1 }))); },
      errors
    );

    const recurringToPush = await db.recurring_expenses.where('store_id').equals(storeId).and((item) => item.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Recurring expenses',
      'recurring_expenses',
      recurringToPush.map((item) => ({
        id: item.id,
        store_id: item.store_id,
        description: item.description,
        category: item.category,
        amount: item.amount,
        notes: item.notes,
        day_of_month: item.day_of_month,
        is_active: item.is_active === 1,
        last_generated_month: item.last_generated_month,
        created_at: item.created_at,
        updated_at: item.updated_at,
      })),
      async () => { await Promise.all(recurringToPush.map((item) => db.recurring_expenses.update(item.id, { synced: 1 }))); },
      errors
    );

    const budgetsToPush = await db.expense_budgets.where('store_id').equals(storeId).and((item) => item.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Expense budgets',
      'expense_budgets',
      budgetsToPush.map((item) => ({
        id: item.id,
        store_id: item.store_id,
        category: item.category,
        monthly_limit: item.monthly_limit,
        updated_at: item.updated_at,
      })),
      async () => { await Promise.all(budgetsToPush.map((item) => db.expense_budgets.update(item.id, { synced: 1 }))); },
      errors
    );

    const unsyncedCashBook = await db.cash_book_entries
      .where('store_id')
      .equals(storeId)
      .and((e) => e.synced === 0 && shouldPushLedgerRow(e.created_at, ledgerClearedAt))
      .toArray();
    syncedCount += await upsertToSupabase(
      'Cash book',
      'cash_book_entries',
      unsyncedCashBook.map((e) => ({
        id: e.id,
        store_id: e.store_id,
        entry_type: e.entry_type,
        description: e.description,
        category: e.category,
        account_type: e.account_type || 'cash',
        amount: e.amount,
        notes: e.notes,
        entry_date: e.entry_date,
        created_by: e.created_by || '',
        created_at: e.created_at,
        updated_at: e.updated_at,
      })),
      async () => {
        await Promise.all(unsyncedCashBook.map((e) => db.cash_book_entries.update(e.id, { synced: 1 })));
      },
      errors
    );

    const unsyncedOrders = await db.online_orders.where('store_id').equals(storeId).and(o => o.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Online orders',
      'online_orders',
      unsyncedOrders.map(o => ({
        id: o.id,
        store_id: o.store_id,
        order_number: o.order_number,
        customer_name: o.customer_name,
        customer_phone: o.customer_phone,
        customer_address: o.customer_address,
        notes: o.notes,
        status: o.status,
        payment_method: o.payment_method,
        total_amount: o.total_amount,
        created_at: o.created_at,
        updated_at: o.updated_at,
      })),
      async () => { await Promise.all(unsyncedOrders.map(o => db.online_orders.update(o.id, { synced: 1 }))); },
      errors
    );

    const unsyncedOrderItems = await db.online_order_items.where('store_id').equals(storeId).and(i => i.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Online order items',
      'online_order_items',
      unsyncedOrderItems.map(i => ({
        id: i.id,
        store_id: i.store_id,
        order_id: i.order_id,
        product_id: uuidOrNull(i.product_id),
        product_name: i.product_name,
        unit_price: i.unit_price,
        quantity: i.quantity,
        subtotal: i.subtotal,
        created_at: i.created_at,
      })),
      async () => { await Promise.all(unsyncedOrderItems.map(i => db.online_order_items.update(i.id, { synced: 1 }))); },
      errors
    );

    const unsyncedBulkSms = await db.bulk_sms_campaigns
      .where('store_id')
      .equals(storeId)
      .and((campaign) => campaign.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Bulk SMS campaigns',
      'bulk_sms_campaigns',
      unsyncedBulkSms.map((campaign) => ({
        id: campaign.id,
        store_id: campaign.store_id,
        message: campaign.message,
        recipient_count: campaign.recipient_count,
        sent_count: campaign.sent_count,
        failed_count: campaign.failed_count,
        provider: campaign.provider,
        provider_message_id: campaign.provider_message_id || null,
        status: campaign.status,
        error_message: campaign.error_message || null,
        created_by: uuidOrNull(campaign.created_by),
        created_at: campaign.created_at,
      })),
      async () => {
        await Promise.all(unsyncedBulkSms.map((campaign) =>
          db.bulk_sms_campaigns.update(campaign.id, { synced: 1 })
        ));
      },
      errors
    );

    const unsyncedSuppliers = await db.suppliers.where('store_id').equals(storeId).and((s) => s.synced === 0).toArray();
    syncedCount += await upsertToSupabase(
      'Suppliers',
      'suppliers',
      unsyncedSuppliers.map((s) => ({
        id: s.id,
        store_id: s.store_id,
        name: s.name,
        contact_name: s.contact_name,
        phone: s.phone,
        email: s.email,
        address: s.address,
        notes: s.notes,
        is_active: s.is_active === 1,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
      async () => { await Promise.all(unsyncedSuppliers.map((s) => db.suppliers.update(s.id, { synced: 1 }))); },
      errors
    );

    const unsyncedPurchaseOrders = await db.purchase_orders
      .where('store_id')
      .equals(storeId)
      .and((o) => o.synced === 0)
      .toArray();
    syncedCount += await upsertToSupabase(
      'Purchase orders',
      'purchase_orders',
      unsyncedPurchaseOrders.map((o) => ({
        id: o.id,
        store_id: o.store_id,
        supplier_id: o.supplier_id,
        order_number: o.order_number,
        status: o.status,
        items_json: o.items_json,
        total_amount: o.total_amount,
        notes: o.notes,
        created_at: o.created_at,
        updated_at: o.updated_at,
        received_at: o.received_at || null,
      })),
      async () => { await Promise.all(unsyncedPurchaseOrders.map((o) => db.purchase_orders.update(o.id, { synced: 1 }))); },
      errors
    );

    const approvalSync = await import('./stockApprovals').then((mod) => mod.pushStockApprovalRecords(storeId));
    syncedCount += approvalSync.synced;
    if (approvalSync.error) errors.push(approvalSync.error);
    const activitySync = await import('./activityLog').then((mod) => mod.pushActivityLogs(storeId));
    syncedCount += activitySync.synced;
    if (activitySync.error) errors.push(activitySync.error);
    const supportSync = await import('./support/cloud').then((mod) => mod.pushSupportChanges(storeId));
    syncedCount += supportSync.pushed;
    if (supportSync.error) errors.push(supportSync.error);

    if (errors.length > 0) {
      return { success: false, message: `Partial sync. Errors: ${errors.join('; ')}` };
    }

    await db.sync_meta.put({
      id: 'last_sync',
      last_synced_at: new Date().toISOString(),
    });

    const droppedSales = ledgerSync.dropped.transactions;
    const clearedNote =
      droppedSales > 0
        ? ` Removed ${droppedSales} cleared sale${droppedSales === 1 ? '' : 's'} from this device.`
        : '';

    if (syncedCount === 0) {
      return {
        success: true,
        message: droppedSales > 0
          ? `Cleared trial sales on this device.${clearedNote}`
          : 'Everything is already synced!',
      };
    }

    return {
      success: true,
      message: `Synced ${syncedCount} records at ${new Date().toLocaleTimeString()}.${clearedNote}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Load failed') || msg.includes('Failed to fetch')) {
      return {
        success: false,
        message: 'Sync failed: Could not reach Supabase. Check your internet connection, VITE_SUPABASE_URL, and that your Supabase project is active.',
      };
    }
    return { success: false, message: `Sync failed: ${msg}` };
  }
}

export async function syncFromSupabase(opts?: {
  onlyTables?: string[];
  skipCatalogAlign?: boolean;
  includeHistory?: boolean;
}): Promise<{ success: boolean; message: string; pulledCount: number }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured.', pulledCount: 0 };
  }

  const storeId = await getCurrentStoreId();
  if (!storeId) {
    return { success: false, message: 'No store selected', pulledCount: 0 };
  }

  const connection = await testSupabaseConnection();
  if (!connection.ok) {
    return { success: false, message: connection.error || 'Could not connect to Supabase.', pulledCount: 0 };
  }

  let pulledCount = 0;
  const errors: string[] = [];
  const deletedProductIds = await getDeletedProductIds(storeId);

  try {
    if (!opts?.onlyTables) {
    const { data: remoteStore, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .maybeSingle();

    if (storeError) errors.push(formatSyncError('Store', storeError));
    else if (remoteStore) {
      const localStore = await db.stores.get(storeId);
      const { loadStoreQuota } = await import('./storeQuotas');
      const quota = await loadStoreQuota(storeId);
      await db.stores.put({
        id: storeId,
        name: remoteStore.name,
        address: remoteStore.address || '',
        support_number: remoteStore.support_number || '',
        discount_cap_percentage: remoteStore.discount_cap_percentage ?? 10,
        pin_on_discount_enabled: remoteStore.pin_on_discount_enabled ? 1 : 0,
        discount_allow_percentage: remoteStore.discount_allow_percentage === false ? 0 : 1,
        discount_allow_fixed: remoteStore.discount_allow_fixed === false ? 0 : 1,
        cashier_can_discount: remoteStore.cashier_can_discount === false ? 0 : 1,
        cashiers_can_view_stock:
          remoteStore.cashiers_can_view_stock == null
            ? (localStore?.cashiers_can_view_stock ?? 1)
            : remoteStore.cashiers_can_view_stock === false
              ? 0
              : 1,
        session_timeout_minutes:
          remoteStore.session_timeout_minutes == null
            ? (localStore?.session_timeout_minutes ?? 5)
            : normalizeSessionTimeoutMinutes(remoteStore.session_timeout_minutes),
        momo_account_name: remoteStore.momo_account_name || '',
        momo_number: remoteStore.momo_number || '',
        momo_network: remoteStore.momo_network || '',
        subscription_started_at: remoteStore.subscription_started_at
          ? String(remoteStore.subscription_started_at)
          : null,
        subscription_expires_at: remoteStore.subscription_expires_at
          ? String(remoteStore.subscription_expires_at)
          : null,
        subscription_months_granted: Number(remoteStore.subscription_months_granted) || 0,
        access_blocked: remoteStore.access_blocked ? 1 : 0,
        logo_url: remoteStore.logo_url || localStore?.logo_url || '',
        warehouse_enabled: quota
          ? quota.warehouse_enabled
            ? 1
            : 0
          : remoteStore.warehouse_enabled
            ? 1
            : 0,
        max_shops: quota?.max_shops ?? (Number(remoteStore.max_shops) || 1),
        max_warehouses: quota?.max_warehouses ?? (Number(remoteStore.max_warehouses) || 0),
        max_stores: quota?.max_stores ?? Math.max(1, Number(remoteStore.max_stores) || 1),
        ecommerce_enabled: remoteStore.ecommerce_enabled ? 1 : 0,
        ecommerce_slug: remoteStore.ecommerce_slug || localStore?.ecommerce_slug || '',
        ecommerce_tagline: remoteStore.ecommerce_tagline || localStore?.ecommerce_tagline || '',
        ecommerce_links: remoteStore.ecommerce_links || localStore?.ecommerce_links || '[]',
        currency_code: String(remoteStore.currency_code || localStore?.currency_code || 'GHS'),
        preferred_language: remoteStore.preferred_language === 'fr' || localStore?.preferred_language === 'fr' ? 'fr' : 'en',
        transactions_cleared_at: remoteStore.transactions_cleared_at
          ? String(remoteStore.transactions_cleared_at)
          : localStore?.transactions_cleared_at ?? null,
        debt_reminders_enabled:
          remoteStore.debt_reminders_enabled === undefined
            ? (localStore?.debt_reminders_enabled ?? 0)
            : remoteStore.debt_reminders_enabled
              ? 1
              : 0,
        debt_reminder_interval_days:
          remoteStore.debt_reminder_interval_days == null
            ? (localStore?.debt_reminder_interval_days ?? DEFAULT_DEBT_REMINDER_INTERVAL_DAYS)
            : normalizeDebtReminderIntervalDays(remoteStore.debt_reminder_interval_days),
        debt_reminder_min_balance:
          remoteStore.debt_reminder_min_balance == null
            ? (localStore?.debt_reminder_min_balance ?? 0)
            : normalizeDebtReminderMinBalance(remoteStore.debt_reminder_min_balance),
        debt_reminder_message:
          remoteStore.debt_reminder_message ||
          localStore?.debt_reminder_message ||
          DEFAULT_DEBT_REMINDER_TEMPLATE,
        sales_target_daily:
          remoteStore.sales_target_daily == null
            ? (localStore?.sales_target_daily ?? 0)
            : Math.max(0, Number(remoteStore.sales_target_daily) || 0),
        sales_target_monthly:
          remoteStore.sales_target_monthly == null
            ? (localStore?.sales_target_monthly ?? 0)
            : Math.max(0, Number(remoteStore.sales_target_monthly) || 0),
        created_at: remoteStore.created_at,
        synced: localStore?.synced === 0 ? 0 : 1,
      });
      pulledCount++;
      if (remoteStore.transactions_cleared_at) {
        const { applyLocalStoreLedgerClear } = await import('./storeLedgerClear');
        await applyLocalStoreLedgerClear(storeId, String(remoteStore.transactions_cleared_at));
      }
    }
    }

    const tables = [
      {
        label: 'Users',
        table: 'users',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          name: row.name as string,
          role: row.role as 'owner' | 'cashier',
          pin_hash: row.pin_hash as string,
          is_active: row.is_active ? 1 : 0,
          phone: String(row.phone || ''),
          assigned_location_id: (row.assigned_location_id as string) || null,
          can_wholesale: row.can_wholesale ? 1 : 0,
          can_sell_from_warehouse: row.can_sell_from_warehouse ? 1 : 0,
          can_manage_ecommerce: (row.can_manage_ecommerce || row.role === 'owner') ? 1 : 0,
          can_access_cashbook: cashbookAccessFromCloud(row.role, row.can_access_cashbook),
          can_view_stock: optionalStaffFlag(row.can_view_stock),
          can_discount: optionalStaffFlag(row.can_discount),
          pos_layout_json: row.role === 'owner' && typeof row.pos_layout_json === 'string'
            ? row.pos_layout_json
            : undefined,
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.users,
        merge: async (remote: LocalUser, local: LocalUser | undefined) => {
          if (!local) return remote;
          // Keep unsynced local edits (e.g. self-serve phone) until push succeeds
          if (local.synced === 0) {
            return {
              ...remote,
              name: local.name || remote.name,
              pin_hash: hasPendingPinChange(local)
                ? local.pin_hash || remote.pin_hash
                : remote.pin_hash || local.pin_hash,
              pin_dirty: hasPendingPinChange(local) ? 1 : 0,
              is_active: local.is_active,
              phone: (local.phone || '').trim() || remote.phone || '',
              assigned_location_id:
                local.assigned_location_id !== undefined
                  ? local.assigned_location_id
                  : remote.assigned_location_id,
              can_wholesale: local.can_wholesale ?? remote.can_wholesale,
              can_sell_from_warehouse:
                local.can_sell_from_warehouse ?? remote.can_sell_from_warehouse,
              can_manage_ecommerce: local.can_manage_ecommerce ?? remote.can_manage_ecommerce,
              can_access_cashbook: local.can_access_cashbook ?? remote.can_access_cashbook,
              can_view_stock: local.can_view_stock ?? remote.can_view_stock,
              can_discount: local.can_discount ?? remote.can_discount,
              pos_layout_json: local.pos_layout_json ?? remote.pos_layout_json,
              synced: 0,
            };
          }
          // Never clobber a local phone with an empty cloud value
          return {
            ...remote,
            phone: (remote.phone || '').trim() || local.phone || '',
          };
        },
      },
      {
        label: 'Product categories',
        table: 'product_categories',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          name: String(row.name || ''),
          is_active: row.is_active === false ? 0 : 1,
          created_at: String(row.created_at || ''),
          updated_at: String(row.updated_at || row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.product_categories,
        merge: async (remote: LocalProductCategory, local: LocalProductCategory | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
      {
        label: 'Customers',
        table: 'customers',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          name: String(row.name || ''),
          phone: String(row.phone || ''),
          location_id:
            typeof row.location_id === 'string'
              ? row.location_id
              : row.location_id === null
                ? null
                : undefined,
          address: typeof row.address === 'string' ? row.address : undefined,
          opening_balance: Number(row.opening_balance) || 0,
          opening_balance_remaining: Number(row.opening_balance_remaining) || 0,
          wallet_balance: Number(row.wallet_balance) || 0,
          is_active: row.is_active === false ? 0 : 1,
          debt_reminder_opt_out: row.debt_reminder_opt_out === true ? 1 : 0,
          created_at: String(row.created_at || ''),
          updated_at: String(row.updated_at || row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.customers,
        merge: async (remote: LocalCustomer, local: LocalCustomer | undefined) => {
          if (!local || local.synced !== 0) {
            return {
              ...remote,
              location_id:
                remote.location_id === undefined
                  ? local?.location_id ?? null
                  : remote.location_id,
              address: remote.address === undefined ? local?.address ?? '' : remote.address,
            };
          }
          return { ...remote, ...local, synced: 0 };
        },
      },
      {
        label: 'Products',
        table: 'products',
        map: (row: Record<string, unknown>) => {
          const local = row;
          return {
            id: local.id as string,
            store_id: local.store_id as string,
            name: local.name as string,
            category: (local.category as string) || 'Other',
            sku_type: (local.sku_type as string) || 'unit',
            barcode: (local.barcode as string) || '',
            cost_price: Number(local.cost_price) || 0,
            selling_price: Number(local.selling_price) || 0,
            stock_level: Number(local.stock_level) || 0,
            is_active: local.is_active ? 1 : 0,
            image_url: (local.image_url as string) || '',
            pack_size: Number(local.pack_size) || 1,
            track_expiry: local.track_expiry ? 1 : 0,
            wholesale_mode: (local.wholesale_mode as string) || 'none',
            wholesale_pack_price: Number(local.wholesale_pack_price) || 0,
            wholesale_unit_price: Number(local.wholesale_unit_price) || 0,
            wholesale_tiers_json: (local.wholesale_tiers_json as string) || '[]',
            sell_online: local.sell_online ? 1 : 0,
            reorder_level: Math.max(0, Math.floor(Number(local.reorder_level) || 0)),
            created_at: local.created_at as string,
            updated_at: (local.updated_at as string) || (local.created_at as string),
            synced: 1,
          };
        },
        dbTable: db.products,
        merge: async (remote: LocalProduct, local: LocalProduct | undefined) => {
          if (!local) return remote;
          if (local.synced !== 0) return remote;
          // Keep unsynced name/price edits, but stock always follows cloud then batch align
          return {
            ...local,
            stock_level: asQty(remote.stock_level),
          };
        },
      },
      {
        label: 'Transactions',
        table: 'transactions',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          receipt_number: row.receipt_number as string,
          cashier_id: (row.cashier_id as string) || '',
          cashier_name: (row.cashier_name as string) || '',
          total_amount: Number(row.total_amount) || 0,
          discount_applied: Number(row.discount_applied) || 0,
          other_charges_json:
            typeof row.other_charges_json === 'string'
              ? row.other_charges_json
              : JSON.stringify(row.other_charges_json ?? []),
          other_charges_total: Number(row.other_charges_total) || 0,
          payment_method: (row.payment_method as PaymentMethod) || 'cash',
          cash_amount: Number(row.cash_amount) || 0,
          paystack_amount: Number(row.paystack_amount) || 0,
          paystack_reference: (row.paystack_reference as string) || '',
          manual_payment_amount: Number(row.manual_payment_amount) || 0,
          wallet_amount: Number(row.wallet_amount) || 0,
          payment_reference: (row.payment_reference as string) || '',
          customer_name: String(row.customer_name || ''),
          customer_phone: String(row.customer_phone || ''),
          customer_id: (row.customer_id as string) || null,
          credit_paid_amount: Number(row.credit_paid_amount) || 0,
          credit_balance: Number(row.credit_balance) || 0,
          status: row.status as 'completed' | 'pending',
          location_id: (row.location_id as string) || undefined,
          sale_mode:
            row.sale_mode === 'wholesale' || row.sale_mode === 'mixed' || row.sale_mode === 'retail'
              ? row.sale_mode
              : 'retail',
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.transactions,
        merge: async (remote: LocalTransaction, local: LocalTransaction | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return {
            ...remote,
            ...local,
            customer_id: local.customer_id || remote.customer_id || null,
            synced: 0,
          };
        },
      },
      {
        label: 'Customer account receipts',
        table: 'customer_account_receipts',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          customer_id: String(row.customer_id),
          receipt_number: String(row.receipt_number || ''),
          amount: Number(row.amount) || 0,
          cash_amount: Number(row.cash_amount) || 0,
          momo_amount: Number(row.momo_amount) || 0,
          cheque_amount: Number(row.cheque_amount) || 0,
          balance_before: Number(row.balance_before) || 0,
          balance_after: Number(row.balance_after) || 0,
          created_by: String(row.created_by || ''),
          created_at: String(row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.customer_account_receipts,
        merge: async (
          remote: LocalCustomerAccountReceipt,
          local: LocalCustomerAccountReceipt | undefined
        ) => {
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
      {
        label: 'Credit payments',
        table: 'credit_payments',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          transaction_id: String(row.transaction_id),
          customer_id: String(row.customer_id || ''),
          account_receipt_id: String(row.account_receipt_id || '') || null,
          amount: Number(row.amount) || 0,
          payment_method: (row.payment_method === 'momo' || row.payment_method === 'cheque' || row.payment_method === 'split'
            ? row.payment_method
            : 'cash') as LocalCreditPayment['payment_method'],
          cash_amount: Number(row.cash_amount) || (row.payment_method === 'cash' ? Number(row.amount) || 0 : 0),
          momo_amount: Number(row.momo_amount) || 0,
          cheque_amount: Number(row.cheque_amount) || 0,
          created_by: String(row.created_by || ''),
          created_at: String(row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.credit_payments,
        merge: async (remote: LocalCreditPayment, local: LocalCreditPayment | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
      {
        label: 'Customer opening payments',
        table: 'customer_opening_payments',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          customer_id: String(row.customer_id),
          entry_type: row.entry_type === 'opening_balance' ? 'opening_balance' : 'payment',
          amount: Number(row.amount) || 0,
          payment_method: (row.payment_method === 'momo' || row.payment_method === 'cheque' || row.payment_method === 'split'
            ? row.payment_method
            : 'cash') as LocalCustomerOpeningPayment['payment_method'],
          cash_amount: Number(row.cash_amount) || (row.payment_method === 'cash' ? Number(row.amount) || 0 : 0),
          momo_amount: Number(row.momo_amount) || 0,
          cheque_amount: Number(row.cheque_amount) || 0,
          account_receipt_id: String(row.account_receipt_id || '') || null,
          created_by: String(row.created_by || ''),
          created_at: String(row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.customer_opening_payments,
        merge: async (
          remote: LocalCustomerOpeningPayment,
          local: LocalCustomerOpeningPayment | undefined
        ) => {
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
      {
        label: 'Transaction items',
        table: 'transaction_items',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          transaction_id: row.transaction_id as string,
          product_id: (row.product_id as string) || '',
          product_name: (row.product_name as string) || '',
          quantity: Number(row.quantity) || 0,
          unit_price: Number(row.unit_price) || 0,
          subtotal: Number(row.subtotal) || 0,
          sale_mode:
            row.sale_mode === 'wholesale'
              ? 'wholesale'
              : row.sale_mode === 'retail'
                ? 'retail'
                : undefined,
          unit_type: (row.unit_type as string) || 'base',
          pack_size: Number(row.pack_size) || 1,
          base_quantity: Number(row.base_quantity) || Number(row.quantity) || 0,
          batch_id: (row.batch_id as string) || undefined,
          synced: 1,
        }),
        dbTable: db.transaction_items,
      },
      {
        label: 'Sales returns',
        table: 'sales_returns',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          transaction_id: String(row.transaction_id),
          transaction_item_id: String(row.transaction_item_id),
          product_id: String(row.product_id),
          product_name: String(row.product_name || ''),
          quantity: Number(row.quantity) || 0,
          stock_quantity: Number(row.stock_quantity) || 0,
          reason: String(row.reason || ''),
          photo_data_url: String(row.photo_data_url || ''),
          receipt_number: String(row.receipt_number || ''),
          location_id: String(row.location_id || ''),
          customer_id: String(row.customer_id || '') || null,
          refund_method:
            row.refund_method === 'cash' ||
            row.refund_method === 'wallet' ||
            row.refund_method === 'account' ||
            row.refund_method === 'today_sales'
              ? row.refund_method
              : 'none',
          refund_amount: Number(row.refund_amount) || 0,
          debt_applied: Number(row.debt_applied) || 0,
          wallet_credit: Number(row.wallet_credit) || 0,
          created_by: String(row.created_by || ''),
          created_at: String(row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.sales_returns,
        merge: async (remote: LocalSaleReturn, local: LocalSaleReturn | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
      {
        label: 'Customer wallet transactions',
        table: 'customer_wallet_transactions',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          customer_id: String(row.customer_id),
          type: row.type === 'sale_debit' || row.type === 'topup' || row.type === 'purchase' || row.type === 'refund' || row.type === 'adjustment'
            ? row.type
            : 'return_credit',
          amount: Number(row.amount) || 0,
          balance_after: Number(row.balance_after) || 0,
          return_id: String(row.return_id || '') || null,
          transaction_id: String(row.transaction_id || '') || null,
          description: String(row.description || ''),
          created_by: String(row.created_by || ''),
          created_at: String(row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.customer_wallet_transactions,
        merge: async (
          remote: LocalCustomerWalletTransaction,
          local: LocalCustomerWalletTransaction | undefined
        ) => {
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
      {
        label: 'Expenses',
        table: 'expenses',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          description: row.description as string,
          category: (row.category as string) || 'Other',
          amount: Number(row.amount) || 0,
          notes: (row.notes as string) || '',
          receipt_image_data_url: (row.receipt_image_data_url as string) || undefined,
          recurring_expense_id: (row.recurring_expense_id as string) || null,
          recurrence_month: (row.recurrence_month as string) || null,
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.expenses,
        merge: async (remote: LocalExpense, local: LocalExpense | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(local.updated_at).getTime();
            return remoteTime >= localTime ? { ...remote, synced: 1 } : local;
          }
          return remote;
        },
      },
      {
        label: 'Recurring expenses',
        table: 'recurring_expenses',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          description: String(row.description || ''),
          category: String(row.category || 'Other'),
          amount: Number(row.amount) || 0,
          notes: String(row.notes || ''),
          day_of_month: Math.min(31, Math.max(1, Math.floor(Number(row.day_of_month) || 1))),
          is_active: row.is_active === false ? 0 : 1,
          last_generated_month: typeof row.last_generated_month === 'string' ? row.last_generated_month.slice(0, 7) : null,
          created_at: String(row.created_at || ''),
          updated_at: String(row.updated_at || row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.recurring_expenses,
        merge: async (remote: LocalRecurringExpense, local: LocalRecurringExpense | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return new Date(remote.updated_at).getTime() >= new Date(local.updated_at).getTime()
            ? remote
            : local;
        },
      },
      {
        label: 'Expense budgets',
        table: 'expense_budgets',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          category: String(row.category || 'Other'),
          monthly_limit: Number(row.monthly_limit) || 0,
          updated_at: String(row.updated_at || ''),
          synced: 1,
        }),
        dbTable: db.expense_budgets,
        merge: async (remote: LocalExpenseBudget, local: LocalExpenseBudget | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return new Date(remote.updated_at).getTime() >= new Date(local.updated_at).getTime()
            ? remote
            : local;
        },
      },
      {
        label: 'Cash book',
        table: 'cash_book_entries',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          entry_type: row.entry_type === 'income' ? 'income' : 'expense',
          description: (row.description as string) || '',
          category: (row.category as string) || 'Other',
          account_type: row.account_type === 'bank' ? 'bank' : 'cash',
          amount: Number(row.amount) || 0,
          notes: (row.notes as string) || '',
          entry_date: String(row.entry_date || row.created_at || '').slice(0, 10),
          created_by: (row.created_by as string) || '',
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.cash_book_entries,
        merge: async (remote: LocalCashBookEntry, local: LocalCashBookEntry | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) return local;
          return remote;
        },
      },
      {
        label: 'Locations',
        table: 'locations',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          name: (row.name as string) || '',
          location_type: (row.location_type as 'shop' | 'warehouse') || 'shop',
          is_default: row.is_default ? 1 : 0,
          is_active: row.is_active === false ? 0 : 1,
          access_pin_hash: (row.access_pin_hash as string) || null,
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.locations,
        merge: async (remote: LocalLocation, local: LocalLocation | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(local.updated_at).getTime();
            return remoteTime >= localTime ? { ...remote, synced: 1 } : local;
          }
          return remote;
        },
      },
      {
        label: 'Stock batches',
        table: 'stock_batches',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          product_id: row.product_id as string,
          location_id: row.location_id as string,
          batch_code: (row.batch_code as string) || '',
          expiry_date: (row.expiry_date as string) || null,
          quantity: asQty(row.quantity),
          cost_price: Number(row.cost_price) || 0,
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.stock_batches,
        merge: async (remote: LocalStockBatch, local: LocalStockBatch | undefined) => {
          if (!local) return remote;
          if (local.synced !== 0) return remote;
          const localQty = asQty(local.quantity);
          const remoteQty = asQty(remote.quantity);
          // Unsynced local sale: keep the lower qty. Inflated local stock: take cloud.
          if (localQty < remoteQty) return { ...local, quantity: localQty };
          return remote;
        },
      },
      {
        label: 'Stock movements',
        table: 'stock_movements',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          product_id: row.product_id as string,
          batch_id: (row.batch_id as string) || null,
          from_location_id: (row.from_location_id as string) || null,
          to_location_id: (row.to_location_id as string) || null,
          movement_type: row.movement_type as LocalStockMovement['movement_type'],
          quantity: Number(row.quantity) || 0,
          note: (row.note as string) || '',
          user_id: (row.user_id as string) || null,
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.stock_movements,
      },
      {
        label: 'Online orders',
        table: 'online_orders',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          order_number: row.order_number as string,
          customer_name: (row.customer_name as string) || '',
          customer_phone: (row.customer_phone as string) || '',
          customer_address: (row.customer_address as string) || '',
          notes: (row.notes as string) || '',
          status: (row.status as LocalOnlineOrder['status']) || 'new',
          payment_method: (row.payment_method as string) || 'pay_on_delivery',
          total_amount: Number(row.total_amount) || 0,
          created_at: row.created_at as string,
          updated_at: (row.updated_at as string) || (row.created_at as string),
          synced: 1,
        }),
        dbTable: db.online_orders,
        merge: async (remote: LocalOnlineOrder, local: LocalOnlineOrder | undefined) => {
          if (!local) return remote;
          if (local.synced === 0) {
            const remoteTime = new Date(remote.updated_at).getTime();
            const localTime = new Date(local.updated_at).getTime();
            return remoteTime >= localTime ? { ...remote, synced: 1 } : local;
          }
          return remote;
        },
      },
      {
        label: 'Online order items',
        table: 'online_order_items',
        map: (row: Record<string, unknown>) => ({
          id: row.id as string,
          store_id: row.store_id as string,
          order_id: row.order_id as string,
          product_id: (row.product_id as string) || null,
          product_name: (row.product_name as string) || '',
          unit_price: Number(row.unit_price) || 0,
          quantity: Number(row.quantity) || 0,
          subtotal: Number(row.subtotal) || 0,
          created_at: row.created_at as string,
          synced: 1,
        }),
        dbTable: db.online_order_items,
      },
      {
        label: 'Suppliers',
        table: 'suppliers',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          name: String(row.name || ''),
          contact_name: String(row.contact_name || ''),
          phone: String(row.phone || ''),
          email: String(row.email || ''),
          address: String(row.address || ''),
          notes: String(row.notes || ''),
          is_active: row.is_active === false ? 0 : 1,
          created_at: String(row.created_at || ''),
          updated_at: String(row.updated_at || row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.suppliers,
        merge: async (remote: LocalSupplier, local: LocalSupplier | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return new Date(remote.updated_at).getTime() >= new Date(local.updated_at).getTime()
            ? remote
            : local;
        },
      },
      {
        label: 'Purchase orders',
        table: 'purchase_orders',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          supplier_id: String(row.supplier_id),
          order_number: String(row.order_number || ''),
          status: row.status as PurchaseOrderStatus,
          items_json: String(row.items_json || '[]'),
          total_amount: Number(row.total_amount) || 0,
          notes: String(row.notes || ''),
          created_at: String(row.created_at || ''),
          updated_at: String(row.updated_at || row.created_at || ''),
          received_at: typeof row.received_at === 'string' ? row.received_at : undefined,
          synced: 1,
        }),
        dbTable: db.purchase_orders,
        merge: async (remote: LocalPurchaseOrder, local: LocalPurchaseOrder | undefined) => {
          if (!local || local.synced !== 0) return remote;
          return new Date(remote.updated_at).getTime() >= new Date(local.updated_at).getTime()
            ? remote
            : local;
        },
      },
      {
        label: 'Bulk SMS campaigns',
        table: 'bulk_sms_campaigns',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          message: String(row.message || ''),
          recipient_count: Number(row.recipient_count) || 0,
          sent_count: Number(row.sent_count) || 0,
          failed_count: Number(row.failed_count) || 0,
          provider: String(row.provider || 'mnotify'),
          provider_message_id: typeof row.provider_message_id === 'string' ? row.provider_message_id : undefined,
          status: (row.status as 'sent' | 'failed' | 'partial') || 'sent',
          error_message: typeof row.error_message === 'string' ? row.error_message : undefined,
          created_by: typeof row.created_by === 'string' ? row.created_by : undefined,
          created_at: String(row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.bulk_sms_campaigns,
        merge: async (remote: LocalBulkSmsCampaign, local: LocalBulkSmsCampaign | undefined) => {
          // Bulk SMS campaigns are append-only audit rows; never clobber an
          // unsynced local campaign with a remote row.
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
      {
        label: 'Debt reminders',
        table: 'debt_reminders',
        map: (row: Record<string, unknown>) => ({
          id: String(row.id),
          store_id: String(row.store_id),
          customer_id: String(row.customer_id),
          customer_name: String(row.customer_name || ''),
          customer_phone: String(row.customer_phone || ''),
          balance: Number(row.balance) || 0,
          message: String(row.message || ''),
          provider: String(row.provider || 'mnotify'),
          provider_message_id: typeof row.provider_message_id === 'string' ? row.provider_message_id : null,
          status: (row.status as 'sent' | 'failed' | 'skipped') || 'sent',
          error_message: typeof row.error_message === 'string' ? row.error_message : null,
          sent_at: String(row.sent_at || row.created_at || ''),
          created_at: String(row.created_at || ''),
          synced: 1,
        }),
        dbTable: db.debt_reminders,
        merge: async (remote: LocalDebtReminder, local: LocalDebtReminder | undefined) => {
          // Debt reminders are append-only audit rows; never clobber an
          // unsynced local reminder with a remote row.
          if (!local || local.synced !== 0) return remote;
          return local;
        },
      },
    ] as const;

    for (const config of tables) {
      if (opts?.onlyTables && !opts.onlyTables.includes(config.table)) continue;
      if (!opts?.includeHistory && config.table === 'stock_movements') continue;

      const { data, error } = await fetchAllStoreRows(config.table, storeId);

      if (error) {
        // The debt_reminders table only exists after
        // supabase-migrate-debt-reminders-dashboard.sql has been run. Skip it
        // quietly until then instead of failing the whole pull.
        if (
          config.table === 'debt_reminders' &&
          /does not exist|PGRST205|schema cache/i.test(error.message || '')
        ) {
          continue;
        }
        errors.push(formatSyncError(config.label, error));
        continue;
      }

      for (const row of data || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = config.map(row) as any;

        // Never resurrect hard-deleted products or their stock rows
        if (config.table === 'products' && deletedProductIds.has(mapped.id as string)) {
          continue;
        }
        if (
          (config.table === 'stock_batches' || config.table === 'stock_movements') &&
          deletedProductIds.has(mapped.product_id as string)
        ) {
          continue;
        }

        const existing = await config.dbTable.get(mapped.id);

        let record = mapped;
        if ('merge' in config && config.merge) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          record = await (config.merge as any)(mapped, existing);
        }

        if (!existing || existing.id === record.id) {
          await config.dbTable.put(record);
          if (!existing) pulledCount++;
        }
      }
    }

    const { refreshRemoteLedgerClearAndApply } = await import('./storeLedgerClear');
    const ledgerAfterPull = await refreshRemoteLedgerClearAndApply(storeId);
    const droppedSales = ledgerAfterPull.dropped.transactions;

    try {
      const { pullStockApprovalRecords } = await import('./stockApprovals');
      pulledCount += await pullStockApprovalRecords(storeId);
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : String(pullError);
      if (!/does not exist|PGRST205|schema cache|permission denied|42501/i.test(message)) {
        errors.push(`Stock approvals: ${message}`);
      }
    }

    try {
      const { pullSupportChanges } = await import('./support/cloud');
      const supportError = await pullSupportChanges(storeId);
      if (supportError) errors.push(`Help & Support: ${supportError}`);
    } catch (pullError) {
      const message = pullError instanceof Error ? pullError.message : String(pullError);
      if (!/does not exist|PGRST205|schema cache|permission denied|42501/i.test(message)) {
        errors.push(`Help & Support: ${message}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, message: `Partial pull. Errors: ${errors.join('; ')}`, pulledCount };
    }

    const completedSyncAt = new Date().toISOString();
    await db.sync_meta.put({
      id: 'last_sync',
      last_synced_at: completedSyncAt,
    });
    if (isSupabaseConfigured() && !opts?.onlyTables) {
      const { error: syncMarkerError } = await supabase
        .from('stores')
        .update({ last_cloud_sync_at: completedSyncAt })
        .eq('id', storeId);
      if (syncMarkerError && !/column .*last_cloud_sync_at.*does not exist/i.test(syncMarkerError.message)) {
        console.warn('[Sync] Could not record cloud sync timestamp:', syncMarkerError.message);
      }
    }

    // Cloud snapshot is the shared ledger — replace local extras so devices match
    if (!opts?.skipCatalogAlign) {
      const adopted = await adoptCloudStockLedger(storeId);
      if (!adopted.ok) {
        return {
          success: false,
          message: adopted.error || 'Could not adopt cloud stock',
          pulledCount,
        };
      }
      try {
        const { canonicalizeStoreStock, syncStoreCatalogStockFromBatches } = await import('@/lib/warehouse');
        await canonicalizeStoreStock(storeId);
        await syncStoreCatalogStockFromBatches(storeId);
      } catch {
        // Non-fatal: snapshot still replaced
      }
    }

    const clearedNote =
      droppedSales > 0
        ? ` Removed ${droppedSales} cleared sale${droppedSales === 1 ? '' : 's'} from this device.`
        : '';

    return {
      success: true,
      message:
        (pulledCount > 0 ? `Pulled ${pulledCount} new records from cloud` : 'Cloud data is up to date') +
        clearedNote,
      pulledCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Pull failed: ${msg}`, pulledCount: 0 };
  }
}

export async function pullStockLedgerFromCloud(storeId?: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const id = storeId || (await getCurrentStoreId());
  if (!id) return false;

  const adopted = await adoptCloudStockLedger(id);
  return adopted.ok;
}

export async function syncStockFast(): Promise<{ success: boolean; message: string }> {
  // POS/autosync must both push local sales and pull sales created on another
  // device. Stock-only refreshes leave the phone and machine with different totals.
  const push = await syncToSupabase({ skipPing: true, skipCanonicalize: true });
  const salesPull = await syncFromSupabase({
    onlyTables: [
      'transactions',
      'transaction_items',
      'credit_payments',
      'sales_returns',
      'customer_wallet_transactions',
    ],
    skipCatalogAlign: true,
  });
  const adopted = await refreshStockFromCloud();

  const syncMessages = [
    push.success ? '' : push.message,
    salesPull.success ? '' : salesPull.message,
    adopted.ok ? '' : adopted.message,
  ].filter(Boolean);

  if (syncMessages.length > 0) {
    return {
      success: false,
      message: syncMessages.join(' '),
    };
  }

  return {
    success: true,
    message: `${adopted.message} Sales reconciled (${salesPull.pulledCount} cloud rows checked).`,
  };
}

export async function syncBidirectional(): Promise<{ success: boolean; message: string }> {
  const push = await syncToSupabase();
  const pull = await syncFromSupabase({ skipCatalogAlign: true });
  const adopted = await refreshStockFromCloud();

  if (!pull.success && !push.success && !adopted.ok) {
    return { success: false, message: `Pull: ${pull.message}; Push: ${push.message}` };
  }

  if (!adopted.ok) {
    return { success: false, message: adopted.message || pull.message };
  }

  if (!push.success) {
    return { success: false, message: `${adopted.message}. Push issue: ${push.message}` };
  }
  if (!pull.success) return { success: false, message: `${adopted.message}. Pull issue: ${pull.message}` };

  return {
    success: true,
    message: `Full sync complete. ${pull.message}. ${push.message}`,
  };
}

export async function restoreStoreFromCloud(
  storeId: string,
  ownerPin: string
): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured.' };
  }

  const connection = await testSupabaseConnection();
  if (!connection.ok) {
    return { success: false, message: connection.error || 'Could not connect to Supabase.' };
  }

  const { data: remoteStore, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .maybeSingle();

  if (storeError || !remoteStore) {
    return { success: false, message: 'Store not found in cloud. Check your Store ID.' };
  }

  const { data: owners, error: ownerError } = await supabase
    .from('users')
    .select('*')
    .eq('store_id', storeId)
    .eq('role', 'owner')
    .eq('is_active', true);

  if (ownerError || !owners?.length) {
    return { success: false, message: 'No owner account found for this store.' };
  }

  let ownerMatch = isAdminSuperPin(ownerPin);
  for (const owner of owners) {
    if (ownerMatch) break;
    if (await verifyUserPin(ownerPin, String(owner.pin_hash || ''))) {
      ownerMatch = true;
      break;
    }
  }
  if (!ownerMatch) {
    return { success: false, message: 'Invalid owner PIN for this store.' };
  }

  await db.transaction(
    'rw',
    [
      db.stores,
      db.users,
      db.products,
      db.product_categories,
      db.transactions,
      db.transaction_items,
      db.credit_payments,
      db.expenses,
      db.recurring_expenses,
      db.expense_budgets,
      db.cash_book_entries,
      db.locations,
      db.stock_batches,
      db.stock_movements,
      db.online_orders,
      db.online_order_items,
      db.suppliers,
      db.purchase_orders,
      db.bulk_sms_campaigns,
      db.debt_reminders,
      db.deleted_records,
      db.app_config,
    ],
    async () => {
      await db.stores.clear();
      await db.users.clear();
      await db.products.clear();
      await db.product_categories.clear();
      await db.transactions.clear();
      await db.transaction_items.clear();
      await db.credit_payments.clear();
      await db.expenses.clear();
      await db.recurring_expenses.clear();
      await db.expense_budgets.clear();
      await db.cash_book_entries.clear();
      await db.locations.clear();
      await db.stock_batches.clear();
      await db.stock_movements.clear();
      await db.online_orders.clear();
      await db.online_order_items.clear();
      await db.suppliers.clear();
      await db.purchase_orders.clear();
      await db.bulk_sms_campaigns.clear();
      await db.debt_reminders.clear();
      await db.deleted_records.clear();
    }
  );

  await setCurrentStoreId(storeId);
  const pull = await syncFromSupabase({ includeHistory: true });

  if (!pull.success) {
    return { success: false, message: pull.message };
  }

  return {
    success: true,
    message: `Restored "${remoteStore.name}" from cloud. ${pull.message}`,
  };
}

/**
 * Add / refresh another cloud store on this device without wiping existing stores.
 * Verifies owner PIN, pulls that store's data, and switches to it.
 */
export async function addStoreFromCloud(
  storeId: string,
  ownerPin: string
): Promise<{ success: boolean; message: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase not configured.' };
  }

  const connection = await testSupabaseConnection();
  if (!connection.ok) {
    return { success: false, message: connection.error || 'Could not connect to Supabase.' };
  }

  const cleanId = storeId.trim();
  if (!cleanId) {
    return { success: false, message: 'Enter a Store ID.' };
  }

  const { data: remoteStore, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('id', cleanId)
    .maybeSingle();

  if (storeError || !remoteStore) {
    return { success: false, message: 'Store not found in cloud. Check your Store ID.' };
  }

  const { data: owners, error: ownerError } = await supabase
    .from('users')
    .select('*')
    .eq('store_id', cleanId)
    .eq('role', 'owner')
    .eq('is_active', true);

  if (ownerError || !owners?.length) {
    return { success: false, message: 'No owner account found for this store.' };
  }

  let ownerMatch = isAdminSuperPin(ownerPin);
  for (const owner of owners) {
    if (ownerMatch) break;
    if (await verifyUserPin(ownerPin, String(owner.pin_hash || ''))) {
      ownerMatch = true;
      break;
    }
  }
  if (!ownerMatch) {
    return { success: false, message: 'Invalid owner PIN for this store.' };
  }

  await setCurrentStoreId(cleanId);
  const pull = await syncFromSupabase({ includeHistory: true });
  if (!pull.success) {
    return { success: false, message: pull.message };
  }

  return {
    success: true,
    message: `Opened "${remoteStore.name}" on this device. ${pull.message}`,
  };
}

export async function getLastSyncTime(): Promise<string | null> {
  const meta = await db.sync_meta.get('last_sync');
  return meta?.last_synced_at ?? null;
}

/* ========================================================================
   Agent Portal CRUD operations (local IndexedDB, queued for Supabase sync)
   ======================================================================== */

/** ---- Agents ---- */

export async function listLocalAgents(): Promise<LocalAgent[]> {
  return db.agents.toArray();
}

export async function getLocalAgent(agentId: string): Promise<LocalAgent | undefined> {
  return db.agents.get(agentId);
}

export async function createLocalAgent(agent: Omit<LocalAgent, 'synced'>): Promise<void> {
  await db.agents.add({ ...agent, synced: 0 });
}

export async function updateLocalAgent(
  agentId: string,
  patch: Partial<LocalAgent>
): Promise<void> {
  await db.agents.update(agentId, { ...patch, updated_at: new Date().toISOString(), synced: 0 });
}

export async function deleteLocalAgent(agentId: string): Promise<void> {
  await db.agents.delete(agentId);
}

/** ---- Prospects ---- */

export async function listLocalProspects(agentId?: string): Promise<LocalProspect[]> {
  if (agentId) {
    return db.prospects.where('agent_id').equals(agentId).toArray();
  }
  return db.prospects.toArray();
}

export async function getLocalProspect(prospectId: string): Promise<LocalProspect | undefined> {
  return db.prospects.get(prospectId);
}

export async function createLocalProspect(
  prospect: Omit<LocalProspect, 'synced'>
): Promise<void> {
  await db.prospects.add({ ...prospect, synced: 0 });
}

export async function updateLocalProspect(
  prospectId: string,
  patch: Partial<LocalProspect>
): Promise<void> {
  await db.prospects.update(prospectId, {
    ...patch,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function deleteLocalProspect(prospectId: string): Promise<void> {
  await db.prospects.delete(prospectId);
}

/** ---- Follow-ups ---- */

export async function listLocalFollowUps(
  filters?: { prospectId?: string; agentId?: string; status?: FollowUpStatus }
): Promise<LocalFollowUp[]> {
  const rows = await db.follow_ups.toArray();
  return rows
    .filter((row) => {
      if (filters?.prospectId && row.prospect_id !== filters.prospectId) return false;
      if (filters?.agentId && row.agent_id !== filters.agentId) return false;
      if (filters?.status && row.status !== filters.status) return false;
      return true;
    })
    .sort((a, b) => a.follow_up_at.localeCompare(b.follow_up_at));
}

export async function getLocalFollowUp(followUpId: string): Promise<LocalFollowUp | undefined> {
  return db.follow_ups.get(followUpId);
}

export async function createLocalFollowUp(
  followUp: Omit<LocalFollowUp, 'synced'>
): Promise<void> {
  await db.follow_ups.add({ ...followUp, synced: 0 });
}

export async function updateLocalFollowUp(
  followUpId: string,
  patch: Partial<LocalFollowUp>
): Promise<void> {
  await db.follow_ups.update(followUpId, {
    ...patch,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function deleteLocalFollowUp(followUpId: string): Promise<void> {
  await db.follow_ups.delete(followUpId);
}

/** ---- Agent Stores ---- */

export async function listLocalAgentStores(agentId?: string): Promise<LocalAgentStore[]> {
  if (agentId) {
    return db.agent_stores.where('agent_id').equals(agentId).toArray();
  }
  return db.agent_stores.toArray();
}

export async function getLocalAgentStore(storeId: string): Promise<LocalAgentStore | undefined> {
  return db.agent_stores.get(storeId);
}

export async function createLocalAgentStore(
  store: Omit<LocalAgentStore, 'synced'>
): Promise<void> {
  await db.agent_stores.add({ ...store, synced: 0 });
}

export async function updateLocalAgentStore(
  storeId: string,
  patch: Partial<LocalAgentStore>
): Promise<void> {
  await db.agent_stores.update(storeId, {
    ...patch,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function deleteLocalAgentStore(storeId: string): Promise<void> {
  await db.agent_stores.delete(storeId);
}

/** ---- Agent Invoices ---- */

export async function listLocalAgentInvoices(agentId?: string): Promise<LocalAgentInvoice[]> {
  if (agentId) {
    return db.agent_invoices.where('agent_id').equals(agentId).toArray();
  }
  return db.agent_invoices.toArray();
}

export async function getLocalAgentInvoice(invoiceId: string): Promise<LocalAgentInvoice | undefined> {
  return db.agent_invoices.get(invoiceId);
}

export async function createLocalAgentInvoice(
  invoice: Omit<LocalAgentInvoice, 'synced'>
): Promise<void> {
  await db.agent_invoices.add({ ...invoice, synced: 0 });
}

export async function updateLocalAgentInvoice(
  invoiceId: string,
  patch: Partial<LocalAgentInvoice>
): Promise<void> {
  await db.agent_invoices.update(invoiceId, {
    ...patch,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

export async function deleteLocalAgentInvoice(invoiceId: string): Promise<void> {
  await db.agent_invoices.delete(invoiceId);
}

/** ---- Agent Payments ---- */

export async function listLocalAgentPayments(invoiceId?: string): Promise<LocalAgentPayment[]> {
  if (invoiceId) {
    return db.agent_payments.where('invoice_id').equals(invoiceId).toArray();
  }
  return db.agent_payments.toArray();
}

export async function createLocalAgentPayment(
  payment: Omit<LocalAgentPayment, 'synced'>
): Promise<void> {
  await db.agent_payments.add({ ...payment, synced: 0 });
}

export async function updateLocalAgentPayment(
  paymentId: string,
  patch: Partial<LocalAgentPayment>
): Promise<void> {
  await db.agent_payments.update(paymentId, { ...patch, synced: 0 });
}

export async function deleteLocalAgentPayment(paymentId: string): Promise<void> {
  await db.agent_payments.delete(paymentId);
}

/** ---- Agent Commissions ---- */

export async function listLocalAgentCommissions(agentId?: string): Promise<LocalAgentCommission[]> {
  if (agentId) {
    return db.agent_commissions.where('agent_id').equals(agentId).toArray();
  }
  return db.agent_commissions.toArray();
}

export async function createLocalAgentCommission(
  commission: Omit<LocalAgentCommission, 'synced'>
): Promise<void> {
  await db.agent_commissions.add({ ...commission, synced: 0 });
}

export async function updateLocalAgentCommission(
  commissionId: string,
  patch: Partial<LocalAgentCommission>
): Promise<void> {
  await db.agent_commissions.update(commissionId, { ...patch, synced: 0 });
}

/** ---- Agent Withdrawal Requests ---- */

export async function listLocalAgentWithdrawalRequests(
  agentId?: string
): Promise<LocalAgentWithdrawalRequest[]> {
  if (agentId) {
    return db.agent_withdrawal_requests.where('agent_id').equals(agentId).toArray();
  }
  return db.agent_withdrawal_requests.toArray();
}

export async function getLocalAgentWithdrawalRequest(
  id: string
): Promise<LocalAgentWithdrawalRequest | undefined> {
  return db.agent_withdrawal_requests.get(id);
}

export async function createLocalAgentWithdrawalRequest(
  request: Omit<LocalAgentWithdrawalRequest, 'synced'>
): Promise<void> {
  await db.agent_withdrawal_requests.add({ ...request, synced: 0 });
}

export async function updateLocalAgentWithdrawalRequest(
  id: string,
  patch: Partial<LocalAgentWithdrawalRequest>
): Promise<void> {
  await db.agent_withdrawal_requests.update(id, {
    ...patch,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}

/** ---- Agent Commission Settings ---- */

export async function getLocalCommissionSettings(): Promise<LocalAgentCommissionSetting | undefined> {
  return db.agent_commission_settings.get('main');
}

export async function saveLocalCommissionSettings(
  settings: LocalAgentCommissionSetting
): Promise<void> {
  await db.agent_commission_settings.put(settings);
}

/** ---- Agent PIN verify (local) ---- */

export async function verifyAgentPin(
  phone: string,
  pin: string
): Promise<LocalAgent | null> {
  const { normalizeGhanaPhone } = await import('./platformSettings');
  const target = normalizeGhanaPhone(phone);
  if (!target) return null;
  const agents = await db.agents.toArray();
  for (const agent of agents) {
    if (normalizeGhanaPhone(agent.phone) !== target) continue;
    if (await verifyUserPin(pin, agent.pin_hash)) {
      return agent;
    }
  }
  return null;
}
