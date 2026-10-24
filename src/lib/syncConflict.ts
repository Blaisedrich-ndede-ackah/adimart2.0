import type { StockDelta, VersionedRecord } from './syncTypes';

/** Later updated_at wins. Equal timestamps use the higher version, then the server row. */
export function lastWriteWins<T extends VersionedRecord>(local: T, remote: T): T {
  const localTime = Date.parse(local.updated_at) || 0;
  const remoteTime = Date.parse(remote.updated_at) || 0;
  if (localTime !== remoteTime) return localTime > remoteTime ? local : remote;
  const localVersion = local.version || 0;
  const remoteVersion = remote.version || 0;
  if (localVersion !== remoteVersion) return localVersion > remoteVersion ? local : remote;
  return remote;
}

export function signedStockDelta(movement: {
  movement_type: string;
  quantity: number;
  from_location_id?: string | null;
  to_location_id?: string | null;
}): number {
  const quantity = Math.abs(Number(movement.quantity) || 0);
  switch (movement.movement_type) {
    case 'sale':
      return -quantity;
    case 'return':
    case 'receive':
      return quantity;
    case 'adjust':
      if (movement.from_location_id && !movement.to_location_id) return -quantity;
      return quantity;
    case 'transfer':
      if (movement.from_location_id) return -quantity;
      if (movement.to_location_id) return quantity;
      return 0;
    default:
      return 0;
  }
}

/** Apply each idempotency key once. Later retries of the same key do not move stock again. */
export function applyStockDeltas(
  baseQuantity: number,
  deltas: StockDelta[]
): { quantity: number; appliedKeys: string[] } {
  const seen = new Set<string>();
  let quantity = Number(baseQuantity) || 0;
  const appliedKeys: string[] = [];
  for (const entry of deltas) {
    if (!entry.key || seen.has(entry.key)) continue;
    seen.add(entry.key);
    quantity = Math.round((quantity + entry.delta) * 1000) / 1000;
    appliedKeys.push(entry.key);
  }
  return { quantity, appliedKeys };
}

/** Two offline devices: both deltas apply on top of the shared base, in either order. */
export function reconcileStock(
  baseQuantity: number,
  deviceA: StockDelta[],
  deviceB: StockDelta[]
): number {
  const forward = applyStockDeltas(baseQuantity, [...deviceA, ...deviceB]).quantity;
  const reverse = applyStockDeltas(baseQuantity, [...deviceB, ...deviceA]).quantity;
  if (forward !== reverse) {
    throw new Error('Stock reconciliation changed with device order.');
  }
  return forward;
}

/** Server balance already includes remote payments. Add only this device's unsent delta. */
export function mergeBalanceDeltas(serverBalance: number, localUnsyncedDelta: number): number {
  return Math.round(((Number(serverBalance) || 0) + (Number(localUnsyncedDelta) || 0)) * 100) / 100;
}

export function nextRetryDelayMs(attempt: number): number {
  const step = Math.max(0, attempt - 1);
  return Math.min(60_000, 1000 * 2 ** step);
}

export interface DeviceSnapshot<T extends VersionedRecord & { id: string; fields: Record<string, string | number | null> }> {
  rows: T[];
  stockBase: number;
  stockDeltas: StockDelta[];
  balanceBase: number;
  balanceDelta: number;
}

export interface ReconciledDevice<T> {
  rows: T[];
  stock: number;
  balance: number;
}

function mergeRows<T extends VersionedRecord & { id: string; fields: Record<string, string | number | null> }>(
  left: T[],
  right: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const row of [...left, ...right]) {
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, row);
      continue;
    }
    const winner = lastWriteWins(current, row);
    const fields: Record<string, string | number | null> = { ...current.fields };
    for (const key of new Set([...Object.keys(current.fields), ...Object.keys(row.fields)])) {
      if (current.fields[key] === row.fields[key]) {
        fields[key] = current.fields[key];
        continue;
      }
      const fieldWinner = lastWriteWins(
        { updated_at: current.updated_at, version: current.version },
        { updated_at: row.updated_at, version: row.version }
      );
      const source = fieldWinner === current || (fieldWinner.updated_at === current.updated_at && fieldWinner.version === current.version)
        ? current
        : row;
      fields[key] = source.fields[key] ?? null;
    }
    byId.set(row.id, { ...winner, fields });
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/** Simulate two devices editing offline, then reconnecting. Both results match. */
export function reconcileDevices<T extends VersionedRecord & { id: string; fields: Record<string, string | number | null> }>(
  deviceA: DeviceSnapshot<T>,
  deviceB: DeviceSnapshot<T>
): { a: ReconciledDevice<T>; b: ReconciledDevice<T> } {
  const rows = mergeRows(deviceA.rows, deviceB.rows);
  const stock = reconcileStock(deviceA.stockBase, deviceA.stockDeltas, deviceB.stockDeltas);
  const balance = mergeBalanceDeltas(
    deviceA.balanceBase + deviceB.balanceDelta,
    deviceA.balanceDelta
  );
  const snapshot = { rows, stock, balance };
  return { a: snapshot, b: { rows: rows.map((row) => ({ ...row, fields: { ...row.fields } })), stock, balance } };
}
