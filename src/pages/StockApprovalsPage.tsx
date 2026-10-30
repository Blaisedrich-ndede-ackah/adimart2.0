import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ClipboardCheck, Loader2 } from 'lucide-react';
import { db, type LocalLocation, type LocalProduct } from '@/lib/dexie';
import { ensureStoreLocations, listLocations, receiveStock } from '@/lib/warehouse';
import {
  approveStockReceipt,
  listStockApprovalLogs,
  listStockReceiptRequests,
  rejectStockReceipt,
} from '@/lib/stockApprovals';
import type { LocalStockApprovalLog, LocalStockReceiptRequest } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { triggerPushSync } from '@/lib/sync';

const KIND_LABEL: Record<string, string> = {
  receive: 'Goods received',
  adjust_in: 'Stock increase',
  purchase: 'Purchase order',
  opening: 'Opening stock',
  count: 'Stock count increase',
};

export default function StockApprovalsPage() {
  const { currentStore, currentUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const isCashier = currentUser?.role === 'cashier';
  const [requests, setRequests] = useState<LocalStockReceiptRequest[]>([]);
  const [logs, setLogs] = useState<LocalStockApprovalLog[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!currentStore?.id) return;
    setLoading(true);
    try {
      await ensureStoreLocations(currentStore.id);
      const [nextRequests, nextLogs, nextProducts, nextLocations] = await Promise.all([
        listStockReceiptRequests(currentStore.id),
        isOwner ? listStockApprovalLogs(currentStore.id) : Promise.resolve([]),
        db.products.where('store_id').equals(currentStore.id).and((product) => product.is_active === 1).toArray(),
        listLocations(currentStore.id),
      ]);
      setRequests(nextRequests);
      setLogs(nextLogs);
      setProducts(nextProducts.sort((a, b) => a.name.localeCompare(b.name)));
      setLocations(nextLocations.filter((location) => location.is_active === 1));
      setLocationId((current) => current || nextLocations.find((location) => location.is_default === 1)?.id || nextLocations[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load stock approvals.');
    } finally {
      setLoading(false);
    }
  }, [currentStore?.id, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = requests.filter((request) => request.status === 'pending');

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentStore?.id || !currentUser) return;
    setError('');
    setMessage('');
    setBusyId('new');
    try {
      const result = await receiveStock({
        storeId: currentStore.id,
        productId,
        locationId,
        quantity: Number(quantity),
        userId: currentUser.id,
        note: note.trim() || 'Goods awaiting physical confirmation',
      });
      if (!('pending' in result)) {
        throw new Error('Stock was added without approval. Refresh and try again.');
      }
      setQuantity('1');
      setNote('');
      setMessage('Request saved. Stock stays unchanged until a cashier confirms the items are physically present.');
      await load();
      void triggerPushSync('stock-request');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create the stock request.');
    } finally {
      setBusyId('');
    }
  };

  const decide = async (request: LocalStockReceiptRequest, decision: 'approved' | 'rejected') => {
    if (!currentStore?.id || !currentUser) return;
    setError('');
    setMessage('');
    setBusyId(request.id);
    try {
      const payload = {
        requestId: request.id,
        storeId: currentStore.id,
        userId: currentUser.id,
        userName: currentUser.name,
        role: currentUser.role,
        note: decisionNotes[request.id] || '',
      };
      if (decision === 'approved') {
        await approveStockReceipt({ ...payload, confirmedPresent: confirmed[request.id] === true });
        setMessage(`${request.product_name} is now in stock.`);
      } else {
        await rejectStockReceipt(payload);
        setMessage(`${request.product_name} was not added.`);
      }
      await load();
      void triggerPushSync('stock-approval');
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : 'Could not update the stock request.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="text-white font-bold text-lg">Stock approvals</h1>
        <p className="text-emerald-200 text-xs">
          Stock is added only after a cashier confirms the items are physically present.
        </p>
      </div>
      <div className="page-body no-scrollbar space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

        <form onSubmit={(event) => void submitRequest(event)} className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-gray-900">Request a stock arrival</h2>
          </div>
          <p className="text-xs text-gray-500">This does not change inventory. A cashier still has to approve it.</p>
          <label className="block text-sm text-gray-700">
            Product
            <select required value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5">
              <option value="">Choose a product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            Location
            <select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5">
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            Quantity
            <input required min={1} type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" />
          </label>
          <label className="block text-sm text-gray-700">
            Note
            <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5" placeholder="Supplier, invoice, or count note" />
          </label>
          <button type="submit" disabled={busyId === 'new'} className="touch-target w-full rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-50">
            {busyId === 'new' ? 'Saving request…' : 'Queue for cashier approval'}
          </button>
        </form>

        <section className="space-y-3">
          <h2 className="font-semibold text-gray-900">Waiting for approval ({pending.length})</h2>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : pending.length === 0 ? (
            <p className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-500">No stock is waiting to be checked.</p>
          ) : pending.map((request) => (
            <article key={request.id} className="space-y-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div>
                <p className="font-semibold text-gray-900">{request.product_name} · {request.quantity}</p>
                <p className="text-xs text-gray-500">
                  {KIND_LABEL[request.kind] || request.kind}
                  {request.location_name ? ` · ${request.location_name}` : ''}
                  {' · '}requested by {request.requested_by_name} · {new Date(request.requested_at).toLocaleString()}
                </p>
                {request.note && <p className="mt-1 text-sm text-gray-700">{request.note}</p>}
              </div>
              {isCashier ? (
                <>
                  <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={confirmed[request.id] === true}
                      onChange={(event) => setConfirmed((current) => ({ ...current, [request.id]: event.target.checked }))}
                      className="mt-1 accent-primary"
                    />
                    <span>I have checked these items and they are physically present.</span>
                  </label>
                  <input
                    value={decisionNotes[request.id] || ''}
                    onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                    placeholder="Approval note (optional)"
                    maxLength={300}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === request.id || confirmed[request.id] !== true}
                      onClick={() => void decide(request, 'approved')}
                      className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Approve and add stock
                    </button>
                    <button
                      type="button"
                      disabled={busyId === request.id}
                      onClick={() => void decide(request, 'rejected')}
                      className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-semibold text-gray-700"
                    >
                      Reject
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-amber-800">A cashier must sign in and confirm the goods before this quantity is added.</p>
              )}
            </article>
          ))}
        </section>

        {isOwner && (
          <section className="space-y-3">
            <h2 className="font-semibold text-gray-900">Approval log</h2>
            {logs.length === 0 ? (
              <p className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-500">No stock approvals have been recorded yet.</p>
            ) : logs.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-gray-100 bg-white p-3 text-sm shadow-sm">
                <p className="font-semibold text-gray-900">
                  {entry.decision === 'approved' ? 'Approved' : 'Rejected'} · {entry.product_name} · {entry.quantity}
                </p>
                <p className="text-xs text-gray-500">
                  {entry.approved_by_name} · {new Date(entry.approved_at).toLocaleString()} · {KIND_LABEL[entry.kind] || entry.kind}
                </p>
                {entry.note && <p className="mt-1 text-xs text-gray-700">{entry.note}</p>}
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
