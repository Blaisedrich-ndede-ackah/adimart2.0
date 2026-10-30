import { useCallback, useEffect, useState } from 'react';
import { Archive, ClipboardList, Plus, RefreshCw, Truck } from 'lucide-react';
import { db, type LocalProduct, type LocalPurchaseOrder, type LocalSupplier, type LocalLocation, type PurchaseOrderLine } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { ensureStoreLocations } from '@/lib/warehouse';
import { addSupplier, cancelPurchaseOrder, createPurchaseOrder, parsePurchaseOrderLines, purchaseLineOpenQuantity, receivePurchaseOrder } from '@/lib/purchasing';
import { takeDraftPurchaseOrder } from '@/lib/adimatAi/draftPo';
import { useT } from '@/lib/i18n';
import { triggerPushSync } from '@/lib/sync';
import { isSupabaseConfigured } from '@/lib/supabase';
import { syncBidirectional } from '@/lib/dexie';

type OrderLineDraft = { productId: string; quantity: string; unitCost: string };

export default function PurchasingPage() {
  const { currentStore, currentUser } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
  const [suppliers, setSuppliers] = useState<LocalSupplier[]>([]);
  const [orders, setOrders] = useState<LocalPurchaseOrder[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [supplierForm, setSupplierForm] = useState(false);
  const [orderForm, setOrderForm] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ name: '', contact_name: '', phone: '', email: '', address: '', notes: '' });
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState<OrderLineDraft[]>([{ productId: '', quantity: '1', unitCost: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [draftNote, setDraftNote] = useState('');

  const load = useCallback(async (sync = false) => {
    if (!currentStore?.id) return;
    if (sync && isSupabaseConfigured()) {
      const result = await syncBidirectional();
      if (!result.success) setMessage(result.message);
    }
    await ensureStoreLocations(currentStore.id);
    const [supplierRows, orderRows, productRows, locationRows] = await Promise.all([
      db.suppliers.where('store_id').equals(currentStore.id).toArray(),
      db.purchase_orders.where('store_id').equals(currentStore.id).toArray(),
      db.products.where('store_id').equals(currentStore.id).and((p) => p.is_active === 1).toArray(),
      db.locations.where('store_id').equals(currentStore.id).and((location) => location.is_active === 1).toArray(),
    ]);
    supplierRows.sort((a, b) => a.name.localeCompare(b.name));
    orderRows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    productRows.sort((a, b) => a.name.localeCompare(b.name));
    setSuppliers(supplierRows);
    setOrders(orderRows);
    setProducts(productRows);
    setLocations(locationRows);
    setSupplierId((previous) => previous || supplierRows.find((supplier) => supplier.is_active === 1)?.id || '');
    setLocationId((previous) => previous || locationRows.find((location) => location.is_default === 1)?.id || locationRows[0]?.id || '');
  }, [currentStore?.id]);

  useEffect(() => {
    const draft = takeDraftPurchaseOrder();
    void load(true)
      .then(() => {
        if (!draft) return;
        setSupplierId(draft.supplierId);
        setNotes(draft.notes);
        setLines(
          draft.lines.length > 0
            ? draft.lines.map((line) => ({
                productId: line.productId,
                quantity: String(line.quantity),
                unitCost: String(line.unitCost),
              }))
            : [{ productId: '', quantity: '1', unitCost: '' }]
        );
        setOrderForm(true);
        setDraftNote(draft.notes);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Could not load purchasing data.');
      });
  }, [load]);

  useEffect(() => {
    const draft = takeDraftPurchaseOrder();
    if (!draft || draft.lines.length === 0) return;
    setOrderForm(true);
    setSupplierId(draft.supplierId);
    setNotes(draft.notes);
    setDraftNote(draft.notes);
    setLines(draft.lines.map((line) => ({
      productId: line.productId,
      quantity: String(line.quantity),
      unitCost: String(line.unitCost),
    })));
  }, []);

  const saveSupplier = async () => {
    if (!currentStore?.id) return;
    setBusy(true);
    setMessage('');
    try {
      await addSupplier({ ...supplierDraft, is_active: 1 }, currentStore.id);
      setSupplierDraft({ name: '', contact_name: '', phone: '', email: '', address: '', notes: '' });
      setSupplierForm(false);
      await load();
      void triggerPushSync('supplier-save');
      setMessage('Supplier saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save supplier.');
    } finally {
      setBusy(false);
    }
  };

  const saveOrder = async () => {
    if (!currentStore?.id) return;
    const orderLines: PurchaseOrderLine[] = lines.map((line) => {
      const product = products.find((candidate) => candidate.id === line.productId);
      return {
        product_id: line.productId,
        product_name: product?.name || '',
        quantity: Number(line.quantity),
        unit_cost: Number(line.unitCost),
        received_quantity: 0,
      };
    });
    setBusy(true);
    setMessage('');
    try {
      await createPurchaseOrder({ storeId: currentStore.id, supplierId, items: orderLines, notes });
      setLines([{ productId: '', quantity: '1', unitCost: '' }]);
      setNotes('');
      setOrderForm(false);
      await load();
      void triggerPushSync('purchase-order-save');
      setMessage('Purchase order created.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create purchase order.');
    } finally {
      setBusy(false);
    }
  };

  const receiveOrder = async (order: LocalPurchaseOrder) => {
    if (!currentStore?.id || !currentUser?.id) return;
    const targetLocationId = locationId || locations[0]?.id;
    if (!targetLocationId) {
      setMessage('Create a shop location before receiving stock.');
      return;
    }
    let orderLines: PurchaseOrderLine[];
    try {
      orderLines = parsePurchaseOrderLines(order.items_json);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Purchase order items are invalid.');
      return;
    }
    if (!confirm(`Receive the selected quantities in ${order.order_number} into ${locations.find((location) => location.id === targetLocationId)?.name || 'the selected location'}?`)) return;
    setReceivingId(order.id);
    setMessage('');
    try {
      await receivePurchaseOrder({
        orderId: order.id,
        storeId: currentStore.id,
        locationId: targetLocationId,
        userId: currentUser.id,
        quantities: orderLines.map((line, index) => {
          const remaining = purchaseLineOpenQuantity(line);
          return receiptQuantities[`${order.id}:${index}`] === undefined
            ? remaining
            : Number(receiptQuantities[`${order.id}:${index}`]);
        }),
      });
      await load();
      setReceiptQuantities((previous) => Object.fromEntries(
        Object.entries(previous).filter(([key]) => !key.startsWith(`${order.id}:`))
      ));
      void triggerPushSync('purchase-order-receive');
      setMessage(`${order.order_number} is waiting for a cashier to confirm the goods are present. Stock and cost prices update after that approval.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not receive purchase order.');
    } finally {
      setReceivingId(null);
    }
  };

  const cancelOrder = async (order: LocalPurchaseOrder) => {
    if (!currentStore?.id || !confirm(`Cancel ${order.order_number}?`)) return;
    try {
      await cancelPurchaseOrder(order.id, currentStore.id);
      await load();
      void triggerPushSync('purchase-order-cancel');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel purchase order.');
    }
  };

  const supplierName = (id: string) => suppliers.find((supplier) => supplier.id === id)?.name || 'Supplier';

  return (
    <div className="page-shell">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg">Suppliers & purchasing</h1>
          <p className="text-emerald-200 text-xs">Create orders, receive stock and track supplier details</p>
        </div>
        <button type="button" onClick={() => void load(true).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not refresh purchasing data.'))} className="rounded-xl bg-white/20 p-2.5 touch-target" aria-label="Refresh purchasing data">
          <RefreshCw className="h-4 w-4 text-white" />
        </button>
      </div>
      <div className="page-body no-scrollbar space-y-4">
        {message && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" /><h2 className="font-bold">Suppliers</h2></div>
            <button type="button" onClick={() => setSupplierForm((open) => !open)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white touch-target">
              <Plus className="h-4 w-4" /> Add supplier
            </button>
          </div>
          {supplierForm && (
            <div className="mb-4 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
              <input aria-label="Supplier name" value={supplierDraft.name} onChange={(e) => setSupplierDraft({ ...supplierDraft, name: e.target.value })} placeholder="Supplier / company name *" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <input aria-label="Contact person" value={supplierDraft.contact_name} onChange={(e) => setSupplierDraft({ ...supplierDraft, contact_name: e.target.value })} placeholder="Contact person" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <input aria-label="Supplier phone" value={supplierDraft.phone} onChange={(e) => setSupplierDraft({ ...supplierDraft, phone: e.target.value })} placeholder="Phone" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <input aria-label="Supplier email" type="email" value={supplierDraft.email} onChange={(e) => setSupplierDraft({ ...supplierDraft, email: e.target.value })} placeholder="Email" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <input aria-label="Supplier address" value={supplierDraft.address} onChange={(e) => setSupplierDraft({ ...supplierDraft, address: e.target.value })} placeholder="Address" className="rounded-lg border border-gray-200 px-3 py-2 text-sm sm:col-span-2" />
              <textarea aria-label="Supplier notes" value={supplierDraft.notes} onChange={(e) => setSupplierDraft({ ...supplierDraft, notes: e.target.value })} placeholder="Notes" className="rounded-lg border border-gray-200 px-3 py-2 text-sm sm:col-span-2" />
              <button type="button" disabled={busy} onClick={() => void saveSupplier()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">Save supplier</button>
            </div>
          )}
          {suppliers.length === 0 ? <p className="text-sm text-gray-500">Add suppliers to start recording purchases.</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {suppliers.map((supplier) => (
                <div key={supplier.id} className="rounded-xl border border-gray-100 p-3">
                  <p className="text-sm font-semibold text-gray-900">{supplier.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
                  {supplier.notes && <p className="mt-1 text-xs text-gray-500">{supplier.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /><h2 className="font-bold">Purchase orders</h2></div>
            <button type="button" onClick={() => setOrderForm((open) => !open)} disabled={!suppliers.some((supplier) => supplier.is_active === 1) || products.length === 0} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 touch-target">
              <Plus className="h-4 w-4" /> New order
            </button>
          </div>
          {orderForm && (
            <div className="mb-4 space-y-3 rounded-xl bg-slate-50 p-3">
              {draftNote && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{draftNote || t('ai.restock.draftNote')}</p>
              )}
              <select aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="">Choose supplier</option>
                {suppliers.filter((supplier) => supplier.is_active === 1).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-2 gap-2 rounded-lg bg-white p-2 sm:grid-cols-4">
                  <select aria-label={`Product ${index + 1}`} value={line.productId} onChange={(e) => setLines((current) => current.map((item, i) => i === index ? { ...item, productId: e.target.value, unitCost: products.find((product) => product.id === e.target.value)?.cost_price.toString() || '' } : item))} className="col-span-2 rounded-lg border border-gray-200 px-2 py-2 text-sm sm:col-span-2">
                    <option value="">Choose product</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                  <input aria-label={`Quantity ${index + 1}`} type="number" min="1" step="1" value={line.quantity} onChange={(e) => setLines((current) => current.map((item, i) => i === index ? { ...item, quantity: e.target.value } : item))} placeholder="Qty" className="rounded-lg border border-gray-200 px-2 py-2 text-sm" />
                  <input aria-label={`Unit cost ${index + 1}`} type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => setLines((current) => current.map((item, i) => i === index ? { ...item, unitCost: e.target.value } : item))} placeholder="Unit cost" className="rounded-lg border border-gray-200 px-2 py-2 text-sm" />
                  {lines.length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-xs text-red-600 sm:col-span-4">Remove line</button>}
                </div>
              ))}
              <button type="button" onClick={() => setLines((current) => [...current, { productId: '', quantity: '1', unitCost: '' }])} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">Add another product</button>
              <select aria-label="Receive into location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                <option value="">Choose receiving location</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
              <textarea aria-label="Purchase order notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order notes" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <p className="text-xs text-gray-600">Order total: {money(lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0))}</p>
              <button type="button" disabled={busy} onClick={() => void saveOrder()} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Place purchase order</button>
            </div>
          )}
          {orders.length === 0 ? <p className="text-sm text-gray-500">No purchase orders yet.</p> : (
            <div className="space-y-2">
              {orders.map((order) => {
                let orderLines: PurchaseOrderLine[] = [];
                let orderLinesError = '';
                try {
                  orderLines = parsePurchaseOrderLines(order.items_json);
                } catch (error) {
                  orderLinesError = error instanceof Error ? error.message : 'Purchase order items are invalid.';
                }
                return (
                  <article key={order.id} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{order.order_number}</p>
                        <p className="text-xs text-gray-500">{supplierName(order.supplier_id)} · {new Date(order.created_at).toLocaleString()}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${order.status === 'received' ? 'bg-emerald-100 text-emerald-800' : order.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-800'}`}>{order.status.replace('_', ' ')}</span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-gray-700">
                      {orderLinesError && <p role="alert" className="rounded bg-red-50 p-2 text-red-800">{orderLinesError}</p>}
                      {orderLines.map((line, index) => {
                        const remaining = purchaseLineOpenQuantity(line);
                        const waiting = Number(line.pending_quantity) || 0;
                        const open = order.status === 'ordered' || order.status === 'partially_received';
                        return (
                          <div key={`${line.product_id}-${index}`} className="flex flex-wrap items-center justify-between gap-2">
                            <p>{line.quantity} × {line.product_name} @ {money(line.unit_cost)}{(line.received_quantity || 0) > 0 ? ` · received ${line.received_quantity}` : ''}{waiting > 0 ? ` · ${waiting} awaiting cashier approval` : ''}</p>
                            {open && remaining > 0 && (
                              <label className="flex items-center gap-1.5 text-[11px]">
                                Receive
                                <input
                                  aria-label={`Receive quantity for ${line.product_name}`}
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  step="1"
                                  value={receiptQuantities[`${order.id}:${index}`] ?? String(remaining)}
                                  onChange={(event) => setReceiptQuantities((current) => ({ ...current, [`${order.id}:${index}`]: event.target.value }))}
                                  className="w-16 rounded border border-gray-200 px-2 py-1 text-center"
                                />
                                / {remaining}
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-bold">{money(order.total_amount)}</p>
                      {(order.status === 'ordered' || order.status === 'partially_received') && (
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void cancelOrder(order)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 touch-target">Cancel</button>
                          <button type="button" disabled={receivingId === order.id} onClick={() => void receiveOrder(order)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 touch-target">
                            <Archive className="h-3.5 w-3.5" /> {receivingId === order.id ? 'Receiving…' : 'Receive stock'}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
