import { useEffect, useMemo, useState } from 'react';
import { Download, History, PackageSearch } from 'lucide-react';
import { db, syncFromSupabase, type LocalLocation, type LocalProduct, type LocalStockMovement, type LocalUser } from '@/lib/dexie';
import { useFormatMoney } from '@/lib/currency';
import { toQty } from '@/lib/warehouse';
import { isSupabaseConfigured } from '@/lib/supabase';

type InventoryInsightsProps = {
  storeId: string;
  products: LocalProduct[];
  onEditProduct: (product: LocalProduct) => void;
};

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export default function InventoryInsights({ storeId, products, onEditProduct }: InventoryInsightsProps) {
  const money = useFormatMoney();
  const [tab, setTab] = useState<'restock' | 'audit'>('restock');
  const [movements, setMovements] = useState<LocalStockMovement[]>([]);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [auditStatus, setAuditStatus] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      if (tab === 'audit' && isSupabaseConfigured()) {
        setAuditStatus('Loading cloud stock history…');
        const result = await syncFromSupabase({ onlyTables: ['stock_movements'], skipCatalogAlign: true });
        if (!active) return;
        setAuditStatus(result.success ? '' : result.message);
      }
      const [movementRows, userRows, locationRows] = await Promise.all([
        db.stock_movements.where('store_id').equals(storeId).toArray(),
        db.users.where('store_id').equals(storeId).toArray(),
        db.locations.where('store_id').equals(storeId).toArray(),
      ]);
      if (!active) return;
      movementRows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setMovements(movementRows.slice(0, 500));
      setUsers(userRows);
      setLocations(locationRows);
    })().catch((error: unknown) => {
      console.error('[Inventory] Could not load stock audit history:', error);
      if (active) setAuditStatus(error instanceof Error ? error.message : 'Could not load stock audit history.');
    });
    return () => { active = false; };
  }, [storeId, tab]);

  const restockItems = useMemo(
    () => products
      .filter((product) => (product.reorder_level ?? 0) > 0 && toQty(product.stock_level) <= (product.reorder_level ?? 0))
      .sort((a, b) => toQty(a.stock_level) - toQty(b.stock_level)),
    [products]
  );
  const productNames = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);
  const userNames = useMemo(() => new Map(users.map((user) => [user.id, user.name])), [users]);
  const locationNames = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);

  const exportAudit = () => {
    void db.stock_movements.where('store_id').equals(storeId).toArray().then((allMovements) => {
      const rows = [
        ['Date', 'Product', 'Movement', 'Quantity', 'From', 'To', 'Staff', 'Reason'],
        ...allMovements
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((movement) => [
            movement.created_at,
            productNames.get(movement.product_id) || movement.product_id,
            movement.movement_type,
            movement.quantity,
            movement.from_location_id ? locationNames.get(movement.from_location_id) || '' : '',
            movement.to_location_id ? locationNames.get(movement.to_location_id) || '' : '',
            movement.user_id ? userNames.get(movement.user_id) || '' : '',
            movement.note,
          ]),
      ];
      const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `stock-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch((error: unknown) => {
      console.error('[Inventory] Could not export stock audit:', error);
      setAuditStatus(error instanceof Error ? error.message : 'Could not export stock audit.');
    });
  };

  return (
    <section className="space-y-3" aria-label="Inventory insights">
      <div className="flex gap-2">
        <button type="button" onClick={() => setTab('restock')} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold touch-target ${tab === 'restock' ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200'}`}>
          <PackageSearch className="h-4 w-4" /> Restock suggestions ({restockItems.length})
        </button>
        <button type="button" onClick={() => setTab('audit')} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold touch-target ${tab === 'audit' ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200'}`}>
          <History className="h-4 w-4" /> Inventory history
        </button>
      </div>

      {tab === 'restock' ? (
        <div className="space-y-2">
          {restockItems.length === 0 ? (
            <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">
              No restock alerts. Set each product’s restock alert level from its edit form.
            </div>
          ) : restockItems.map((product) => (
            <article key={product.id} className="flex items-center gap-3 rounded-xl border border-amber-100 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{product.name}</p>
                <p className="mt-0.5 text-xs text-gray-600">
                  In stock: <strong>{toQty(product.stock_level)}</strong> · Reorder at: {product.reorder_level} · Suggested quantity: {Math.max(0, (product.reorder_level ?? 0) * 2 - toQty(product.stock_level))}
                </p>
                <p className="text-[11px] text-gray-500">Cost: {money(product.cost_price)}</p>
              </div>
              <button type="button" onClick={() => onEditProduct(product)} className="shrink-0 rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900 touch-target">Edit level</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Inventory history</p>
              <p className="text-xs text-gray-500">Latest {movements.length} stock changes; CSV includes every recorded movement</p>
            </div>
            {auditStatus && <p role="status" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{auditStatus}</p>}
            <button type="button" onClick={exportAudit} disabled={movements.length === 0} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-40 touch-target">
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
          {movements.length === 0 ? <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">No stock movements recorded yet.</p> : (
            movements.map((movement) => (
              <article key={movement.id} className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{productNames.get(movement.product_id) || 'Removed product'}</p>
                    <p className="mt-0.5 text-xs capitalize text-gray-600">{movement.movement_type} · {movement.from_location_id ? locationNames.get(movement.from_location_id) || 'Unknown' : '—'} → {movement.to_location_id ? locationNames.get(movement.to_location_id) || 'Unknown' : '—'}</p>
                    <p className="text-xs text-gray-500">{movement.user_id ? userNames.get(movement.user_id) || 'Former staff' : 'System / staff not recorded'}{movement.note ? ` · ${movement.note}` : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-gray-900">{movement.quantity}</p>
                    <p className="text-[10px] text-gray-500">{new Date(movement.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
