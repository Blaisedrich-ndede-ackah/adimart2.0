import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, ShoppingBag } from 'lucide-react';
import { db, type LocalOnlineOrder, type LocalOnlineOrderItem, type OnlineOrderStatus } from '@/lib/dexie';
import {
  canManageEcommerce,
  getPublicShopShareUrl,
  listLocalOnlineOrderItems,
  listLocalOnlineOrders,
  listOnlineCatalogProducts,
  pullOnlineOrdersFromCloud,
  setProductSellOnline,
  updateOnlineOrderStatus,
} from '@/lib/ecommerce';
import { subscribeStockChanges } from '@/lib/stockEvents';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';

const STATUS_FLOW: OnlineOrderStatus[] = ['new', 'confirmed', 'fulfilled', 'cancelled'];

type OrderRow = LocalOnlineOrder & { items: LocalOnlineOrderItem[] };

export default function EcommercePage() {
  const { currentStore, currentUser, refreshStore } = useAuthStore();
  const money = useFormatMoney();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof listOnlineCatalogProducts>>>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'orders' | 'catalog'>('orders');
  const [statusMsg, setStatusMsg] = useState('');

  const allowed = canManageEcommerce(currentUser, currentStore);
  const enabled = (currentStore?.ecommerce_enabled ?? 0) === 1;
  const staffOk =
    currentUser?.role === 'owner' || (currentUser?.can_manage_ecommerce ?? 0) === 1;
  const slug = currentStore?.ecommerce_slug?.trim() || '';
  const shareUrl = slug ? getPublicShopShareUrl(slug) : '';

  const onlineProducts = useMemo(
    () => catalog.filter((p) => (p.sell_online ?? 0) === 1),
    [catalog]
  );
  const offlineEligible = useMemo(
    () => catalog.filter((p) => (p.sell_online ?? 0) !== 1),
    [catalog]
  );

  const loadCatalog = useCallback(async () => {
    if (!currentStore) return;
    setCatalog(await listOnlineCatalogProducts(currentStore.id));
  }, [currentStore]);

  const refreshOrders = useCallback(async (opts?: { pull?: boolean }) => {
    if (!currentStore) return;
    const shouldPull = opts?.pull !== false;
    setBusy(true);
    try {
      // Paint local orders immediately, then optionally pull cloud
      const paintLocal = async () => {
        const rows = await listLocalOnlineOrders(currentStore.id);
        const withItems: OrderRow[] = [];
        for (const order of rows) {
          const items = await listLocalOnlineOrderItems(currentStore.id, order.id);
          withItems.push({ ...order, items });
        }
        setOrders(withItems);
      };

      await paintLocal();
      if (shouldPull) {
        await pullOnlineOrdersFromCloud(currentStore.id);
        await paintLocal();
      }
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Could not refresh orders');
      setTimeout(() => setStatusMsg(''), 4000);
    } finally {
      setBusy(false);
    }
  }, [currentStore]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!currentStore || !enabled || !staffOk) return;
    void refreshOrders({ pull: true });
    const id = window.setInterval(() => {
      void refreshOrders({ pull: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [currentStore, enabled, staffOk, refreshOrders]);

  // Keep online catalog stock numbers fresh after POS sales
  useEffect(() => {
    if (!currentStore?.id) return;
    return subscribeStockChanges((event) => {
      if (event.storeId !== currentStore.id) return;
      setCatalog((prev) =>
        prev.map((p) => {
          const change = event.changes.find((c) => c.productId === p.id);
          if (!change || change.totalQty === undefined) return p;
          return { ...p, stock_level: change.totalQty };
        })
      );
    });
  }, [currentStore?.id]);

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatusMsg('Shop link copied');
    } catch {
      setStatusMsg(shareUrl);
    }
    setTimeout(() => setStatusMsg(''), 4000);
  };

  const setSellOnline = async (productId: string, sellOnline: boolean) => {
    await setProductSellOnline(productId, sellOnline);
    await loadCatalog();
    setStatusMsg(sellOnline ? 'Listed online' : 'Removed from online shop');
    setTimeout(() => setStatusMsg(''), 2500);
  };

  const setStatus = async (orderId: string, status: OnlineOrderStatus) => {
    try {
      await updateOnlineOrderStatus(orderId, status);
      await refreshOrders();
      setStatusMsg(`Order marked ${status}`);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'Could not update order');
    }
    setTimeout(() => setStatusMsg(''), 3000);
  };

  if (!currentStore || !currentUser) return null;

  if (!staffOk) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-lg p-6 text-center">
          <ShoppingBag className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 text-xl font-bold text-gray-900">Online shop</h1>
          <p className="mt-2 text-sm text-gray-600">
            You do not have permission to manage e-commerce orders. Ask the store owner.
          </p>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-lg p-6 text-center">
          <ShoppingBag className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 text-xl font-bold text-gray-900">Online shop</h1>
          <p className="mt-2 text-sm text-gray-600">
            E-commerce is not enabled for this store. Ask your Adimat admin to turn it on and set a
            public shop slug, then sync.
          </p>
          <button
            type="button"
            onClick={() => void refreshStore?.()}
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Refresh store
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24 md:p-6">
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Online shop
              </p>
              <h1 className="mt-1 text-2xl font-bold text-gray-900">{currentStore.name}</h1>
              <p className="mt-1 text-sm text-gray-600">
                Share your catalog link. Customers order online; you fulfill in-store (pay on
                delivery).
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshOrders()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Public link</p>
            <p className="mt-1 break-all font-mono text-sm text-gray-800">
              {shareUrl || 'Slug not set — ask admin to set ecommerce slug'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!shareUrl}
                onClick={() => void copyLink()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
                Copy link
              </button>
              {shareUrl ? (
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open shop
                </a>
              ) : null}
            </div>
          </div>

          {statusMsg ? (
            <p className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900">
              {statusMsg}
            </p>
          ) : null}

          {!allowed ? (
            <p className="mt-3 text-sm text-amber-800">
              Sync your store after the admin enables e-commerce.
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === 'orders' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
            }`}
          >
            Orders ({orders.filter((o) => !['fulfilled', 'cancelled'].includes(o.status)).length})
          </button>
          <button
            type="button"
            onClick={() => setTab('catalog')}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              tab === 'catalog' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
            }`}
          >
            Catalog ({onlineProducts.length})
          </button>
        </div>

        {tab === 'orders' ? (
          <div className="space-y-3">
            {orders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
                No online orders yet. Share your shop link to start receiving them.
              </div>
            ) : (
              orders.map((order) => (
                <article
                  key={order.id}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-gray-900">{order.customer_name}</p>
                      <p className="text-sm text-gray-600">{order.customer_phone}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {order.order_number} · {new Date(order.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-primary">
                        {money(Number(order.total_amount))}
                      </p>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {order.status}
                      </p>
                    </div>
                  </div>

                  <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-700">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-2">
                        <span>
                          {item.product_name} × {item.quantity}
                        </span>
                        <span>{money(Number(item.subtotal))}</span>
                      </li>
                    ))}
                  </ul>

                  {order.notes ? (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      Note: {order.notes}
                    </p>
                  ) : null}
                  {order.customer_address ? (
                    <p className="mt-2 text-sm text-gray-600">
                      Deliver to: {order.customer_address}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {STATUS_FLOW.filter((s) => s !== order.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => void setStatus(order.id, status)}
                        className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold capitalize text-gray-700 hover:bg-gray-50"
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </article>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="font-bold text-gray-900">Listed online</h2>
              <p className="mt-1 text-sm text-gray-600">These products appear on your public shop.</p>
              <div className="mt-3 space-y-2">
                {onlineProducts.length === 0 ? (
                  <p className="text-sm text-gray-500">No products listed yet.</p>
                ) : (
                  onlineProducts.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">
                          {money(Number(p.selling_price))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void setSellOnline(p.id, false)}
                        className="shrink-0 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700"
                      >
                        Unlist
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="font-bold text-gray-900">Add to online shop</h2>
              <p className="mt-1 text-sm text-gray-600">Opt in any active product.</p>
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {offlineEligible.length === 0 ? (
                  <p className="text-sm text-gray-500">All active products are already listed.</p>
                ) : (
                  offlineEligible.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">
                          {money(Number(p.selling_price))}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void setSellOnline(p.id, true)}
                        className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white"
                      >
                        List
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
