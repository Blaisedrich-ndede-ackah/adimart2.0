import {
  db,
  generateId,
  type LocalStockApprovalLog,
  type LocalStockReceiptRequest,
} from '@/lib/dexie';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { recordActivity } from '@/lib/activityLog';

export type StockReceiptKind = 'receive' | 'adjust_in' | 'purchase' | 'opening' | 'count';

export interface QueueStockReceiptInput {
  storeId: string;
  productId: string;
  productName: string;
  locationId: string;
  locationName?: string;
  quantity: number;
  kind: StockReceiptKind;
  note?: string;
  batchCode?: string;
  expiryDate?: string | null;
  costPrice?: number | null;
  sourceId?: string | null;
  sourceLine?: string | null;
  requestedBy?: string | null;
  requestedByName?: string;
}

export interface PendingStockReceipt {
  pending: true;
  requestId: string;
}

export function isPendingStockReceipt(value: unknown): value is PendingStockReceipt {
  return typeof value === 'object' &&
    value !== null &&
    (value as PendingStockReceipt).pending === true &&
    typeof (value as PendingStockReceipt).requestId === 'string';
}

function requestPayload(row: LocalStockReceiptRequest): Record<string, unknown> {
  return {
    id: row.id,
    store_id: row.store_id,
    product_id: row.product_id,
    product_name: row.product_name,
    location_id: row.location_id || null,
    location_name: row.location_name || '',
    quantity: row.quantity,
    kind: row.kind,
    note: row.note || '',
    batch_code: row.batch_code || '',
    expiry_date: row.expiry_date || null,
    cost_price: row.cost_price ?? null,
    source_id: row.source_id || null,
    source_line: row.source_line || null,
    requested_by: row.requested_by || null,
    requested_by_name: row.requested_by_name || '',
    requested_at: row.requested_at,
    status: row.status,
    decided_by: row.decided_by || null,
    decided_by_name: row.decided_by_name || null,
    decided_at: row.decided_at || null,
    decision_note: row.decision_note || '',
  };
}

function logPayload(row: LocalStockApprovalLog): Record<string, unknown> {
  return {
    id: row.id,
    store_id: row.store_id,
    request_id: row.request_id,
    product_id: row.product_id || null,
    product_name: row.product_name,
    quantity: row.quantity,
    kind: row.kind,
    decision: row.decision,
    note: row.note || '',
    approved_by: row.approved_by || null,
    approved_by_name: row.approved_by_name,
    approved_at: row.approved_at,
  };
}

export async function queueStockReceipt(input: QueueStockReceiptInput): Promise<string> {
  const quantity = Math.floor(Number(input.quantity) || 0);
  if (quantity <= 0) throw new Error('Quantity must be greater than zero');
  const now = new Date().toISOString();
  const id = generateId();
  const row: LocalStockReceiptRequest = {
    id,
    store_id: input.storeId,
    product_id: input.productId,
    product_name: input.productName,
    location_id: input.locationId,
    location_name: input.locationName || '',
    quantity,
    kind: input.kind,
    note: (input.note || '').trim(),
    batch_code: (input.batchCode || '').trim(),
    expiry_date: input.expiryDate || null,
    cost_price: input.costPrice ?? null,
    source_id: input.sourceId || null,
    source_line: input.sourceLine || null,
    requested_by: input.requestedBy || null,
    requested_by_name: input.requestedByName || 'Staff',
    requested_at: now,
    status: 'pending',
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
    decision_note: '',
    synced: 0,
  };
  await db.stock_receipt_requests.add(row);
  recordActivity({
    storeId: input.storeId,
    userId: input.requestedBy || '',
    username: input.requestedByName || 'Staff',
    role: '',
    activityType: 'stock_request',
    summary: `Requested ${quantity} × ${input.productName}`,
    details: input.kind,
  });
  return id;
}

async function commitApprovedStock(request: LocalStockReceiptRequest, userId: string): Promise<void> {
  const { receiveStock, adjustLocationStock } = await import('@/lib/warehouse');
  if (request.kind === 'adjust_in' || request.kind === 'opening' || request.kind === 'count') {
    await adjustLocationStock({
      storeId: request.store_id,
      productId: request.product_id,
      locationId: request.location_id,
      delta: request.quantity,
      note: request.note || 'Approved stock update',
      userId,
      approved: true,
    });
    return;
  }
  await receiveStock({
    storeId: request.store_id,
    productId: request.product_id,
    locationId: request.location_id,
    quantity: request.quantity,
    batchCode: request.batch_code || undefined,
    expiryDate: request.expiry_date,
    costPrice: request.cost_price ?? undefined,
    userId,
    note: request.note || 'Approved goods receipt',
    approved: true,
  });
}

export async function approveStockReceipt(params: {
  requestId: string;
  storeId: string;
  userId: string;
  userName: string;
  role: string;
  confirmedPresent: boolean;
  note?: string;
}): Promise<void> {
  if (params.role !== 'cashier') {
    throw new Error('Only a cashier can approve stock, after checking that the items are physically present.');
  }
  if (!params.confirmedPresent) {
    throw new Error('Confirm that the stock is physically present before approving.');
  }
  const request = await db.stock_receipt_requests.get(params.requestId);
  if (!request || request.store_id !== params.storeId) throw new Error('Stock request not found.');
  if (request.status !== 'pending') throw new Error('This stock request was already decided.');

  const now = new Date().toISOString();
  const note = (params.note || '').trim();
  await db.transaction('rw', db.stock_receipt_requests, async () => {
    const fresh = await db.stock_receipt_requests.get(request.id);
    if (!fresh || fresh.status !== 'pending' || fresh.store_id !== params.storeId) {
      throw new Error('This stock request was already decided.');
    }
    await db.stock_receipt_requests.update(request.id, {
      status: 'approved',
      decided_by: params.userId,
      decided_by_name: params.userName,
      decided_at: now,
      decision_note: note,
      synced: 0,
    });
  });
  try {
    await commitApprovedStock(request, params.userId);
  } catch (error) {
    await db.stock_receipt_requests.update(request.id, {
      status: 'pending',
      decided_by: null,
      decided_by_name: null,
      decided_at: null,
      decision_note: '',
      synced: 0,
    });
    throw error;
  }
  if (request.kind === 'purchase') {
    const { settlePurchaseReceipt } = await import('@/lib/purchasing');
    await settlePurchaseReceipt(request, 'approved');
  }
  const log: LocalStockApprovalLog = {
    id: generateId(),
    store_id: params.storeId,
    request_id: request.id,
    product_id: request.product_id,
    product_name: request.product_name,
    quantity: request.quantity,
    kind: request.kind,
    decision: 'approved',
    note,
    approved_by: params.userId,
    approved_by_name: params.userName,
    approved_at: now,
    synced: 0,
  };
  await db.stock_approval_logs.add(log);
  recordActivity({
    storeId: params.storeId,
    userId: params.userId,
    username: params.userName,
    role: params.role,
    activityType: 'stock_approval',
    summary: `Approved ${request.quantity} × ${request.product_name}`,
    details: note || request.note,
  });
}

export async function rejectStockReceipt(params: {
  requestId: string;
  storeId: string;
  userId: string;
  userName: string;
  role: string;
  note?: string;
}): Promise<void> {
  if (params.role !== 'cashier') {
    throw new Error('Only a cashier can reject a stock arrival.');
  }
  const request = await db.stock_receipt_requests.get(params.requestId);
  if (!request || request.store_id !== params.storeId) throw new Error('Stock request not found.');
  if (request.status !== 'pending') throw new Error('This stock request was already decided.');
  const now = new Date().toISOString();
  const note = (params.note || '').trim();
  await db.transaction('rw', db.stock_receipt_requests, async () => {
    const fresh = await db.stock_receipt_requests.get(request.id);
    if (!fresh || fresh.status !== 'pending' || fresh.store_id !== params.storeId) {
      throw new Error('This stock request was already decided.');
    }
    await db.stock_receipt_requests.update(request.id, {
      status: 'rejected',
      decided_by: params.userId,
      decided_by_name: params.userName,
      decided_at: now,
      decision_note: note,
      synced: 0,
    });
  });
  if (request.kind === 'purchase') {
    const { settlePurchaseReceipt } = await import('@/lib/purchasing');
    await settlePurchaseReceipt(request, 'rejected');
  }
  await db.stock_approval_logs.add({
    id: generateId(),
    store_id: params.storeId,
    request_id: request.id,
    product_id: request.product_id,
    product_name: request.product_name,
    quantity: request.quantity,
    kind: request.kind,
    decision: 'rejected',
    note,
    approved_by: params.userId,
    approved_by_name: params.userName,
    approved_at: now,
    synced: 0,
  });
  recordActivity({
    storeId: params.storeId,
    userId: params.userId,
    username: params.userName,
    role: params.role,
    activityType: 'stock_rejection',
    summary: `Rejected ${request.quantity} × ${request.product_name}`,
    details: note || request.note,
  });
}

export async function listStockReceiptRequests(storeId: string): Promise<LocalStockReceiptRequest[]> {
  const rows = await db.stock_receipt_requests.where('store_id').equals(storeId).toArray();
  rows.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  return rows;
}

export async function listStockApprovalLogs(storeId: string): Promise<LocalStockApprovalLog[]> {
  const rows = await db.stock_approval_logs.where('store_id').equals(storeId).toArray();
  rows.sort((a, b) => b.approved_at.localeCompare(a.approved_at));
  return rows;
}

function missingTable(message: string): boolean {
  return /does not exist|PGRST205|schema cache|permission denied|42501/i.test(message);
}

export async function pushStockApprovalRecords(storeId: string): Promise<{ synced: number; error: string }> {
  if (!isSupabaseConfigured()) return { synced: 0, error: '' };
  const requests = await db.stock_receipt_requests.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
  const logs = await db.stock_approval_logs.where('store_id').equals(storeId).and((row) => row.synced === 0).toArray();
  let synced = 0;
  if (requests.length > 0) {
    const { error } = await supabase.from('stock_receipt_requests').upsert(requests.map(requestPayload), { onConflict: 'id' });
    if (error) {
      if (!missingTable(error.message || '')) return { synced, error: `Stock requests: ${error.message}` };
    } else {
      await Promise.all(requests.map((row) => db.stock_receipt_requests.update(row.id, { synced: 1 })));
      synced += requests.length;
    }
  }
  if (logs.length > 0) {
    const { error } = await supabase.from('stock_approval_logs').upsert(logs.map(logPayload), { onConflict: 'id' });
    if (error) {
      if (!missingTable(error.message || '')) return { synced, error: `Stock approval log: ${error.message}` };
    } else {
      await Promise.all(logs.map((row) => db.stock_approval_logs.update(row.id, { synced: 1 })));
      synced += logs.length;
    }
  }
  return { synced, error: '' };
}

function asKind(value: unknown): StockReceiptKind {
  if (value === 'adjust_in' || value === 'purchase' || value === 'opening' || value === 'count') return value;
  return 'receive';
}

export async function pullStockApprovalRecords(storeId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  let pulled = 0;
  const requests = await supabase.from('stock_receipt_requests').select('*').eq('store_id', storeId);
  if (requests.error) {
    if (missingTable(requests.error.message || '')) return 0;
    throw new Error(requests.error.message);
  }
  for (const row of requests.data || []) {
    const local = await db.stock_receipt_requests.get(String(row.id));
    if (local && local.synced === 0) continue;
    const mapped: LocalStockReceiptRequest = {
      id: String(row.id),
      store_id: String(row.store_id),
      product_id: String(row.product_id),
      product_name: String(row.product_name || ''),
      location_id: String(row.location_id || ''),
      location_name: String(row.location_name || ''),
      quantity: Math.floor(Number(row.quantity) || 0),
      kind: asKind(row.kind),
      note: String(row.note || ''),
      batch_code: String(row.batch_code || ''),
      expiry_date: row.expiry_date ? String(row.expiry_date) : null,
      cost_price: row.cost_price == null ? null : Number(row.cost_price),
      source_id: row.source_id ? String(row.source_id) : null,
      source_line: row.source_line ? String(row.source_line) : null,
      requested_by: row.requested_by ? String(row.requested_by) : null,
      requested_by_name: String(row.requested_by_name || ''),
      requested_at: String(row.requested_at || ''),
      status: row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending',
      decided_by: row.decided_by ? String(row.decided_by) : null,
      decided_by_name: row.decided_by_name ? String(row.decided_by_name) : null,
      decided_at: row.decided_at ? String(row.decided_at) : null,
      decision_note: String(row.decision_note || ''),
      synced: 1,
    };
    await db.stock_receipt_requests.put(mapped);
    if (!local) pulled += 1;
  }
  const logs = await supabase.from('stock_approval_logs').select('*').eq('store_id', storeId);
  if (logs.error) {
    if (missingTable(logs.error.message || '')) return pulled;
    throw new Error(logs.error.message);
  }
  for (const row of logs.data || []) {
    const local = await db.stock_approval_logs.get(String(row.id));
    if (local && local.synced === 0) continue;
    await db.stock_approval_logs.put({
      id: String(row.id),
      store_id: String(row.store_id),
      request_id: String(row.request_id),
      product_id: String(row.product_id || ''),
      product_name: String(row.product_name || ''),
      quantity: Math.floor(Number(row.quantity) || 0),
      kind: String(row.kind || ''),
      decision: row.decision === 'rejected' ? 'rejected' : 'approved',
      note: String(row.note || ''),
      approved_by: row.approved_by ? String(row.approved_by) : null,
      approved_by_name: String(row.approved_by_name || ''),
      approved_at: String(row.approved_at || ''),
      synced: 1,
    });
    if (!local) pulled += 1;
  }
  return pulled;
}
