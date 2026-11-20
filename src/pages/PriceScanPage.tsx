import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Minus, Plus, ShoppingCart, Trash2, Wifi, WifiOff } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { db, generateId, type LocalProduct } from '@/lib/dexie';
import { flushPendingPickupOrders, formatMoney, getSimilarProducts, lookupProductByBarcodeWithSource, resolvePriceScanStore, type PriceScanStore } from '@/lib/priceScan';
import { useI18nStore, useT } from '@/lib/i18n';
import { generatePaystackReference, initializePaystack, isPaystackConfigured, resolvePaystackEmail } from '@/lib/paystack';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

interface PriceScanPageProps {
  slug: string;
}

interface CartItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  stockLevel: number;
  imageUrl: string;
}

type ScanProduct = Pick<LocalProduct, 'id' | 'name' | 'category' | 'selling_price' | 'stock_level' | 'image_url' | 'reorder_level'>;

function makePickupCode(): string {
  return `PS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export default function PriceScanPage({ slug }: PriceScanPageProps) {
  const t = useT();
  const language = useI18nStore((state) => state.language);
  const [store, setStore] = useState<PriceScanStore | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scannedProduct, setScannedProduct] = useState<ScanProduct | null>(null);
  const [isCachedPrice, setIsCachedPrice] = useState(false);
  const [similarProducts, setSimilarProducts] = useState<LocalProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [pickupCode, setPickupCode] = useState('');
  const [orderPendingSync, setOrderPendingSync] = useState(false);
  const scanBusy = useRef(false);

  const money = useCallback((amount: number) => formatMoney(amount, store?.currency_code || 'GHS', language), [store?.currency_code, language]);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const canPaystack = isPaystackConfigured() && !isOffline && store?.currency_code.toUpperCase() === 'GHS';

  useEffect(() => {
    let active = true;
    const updateOnline = () => setIsOffline(navigator.onLine === false);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    setPageLoading(true);
    setPageError('');
    void resolvePriceScanStore(slug).then((result) => {
      if (!active) return;
      if (!result) setPageError(t('priceScan.storeUnavailable'));
      setStore(result);
    }).catch((error: unknown) => {
      if (active) setPageError(error instanceof Error ? error.message : t('priceScan.storeUnavailable'));
    }).finally(() => {
      if (active) setPageLoading(false);
    });
    return () => {
      active = false;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [slug, t]);

  useEffect(() => {
    if (store) document.title = `${store.name} | ${t('priceScan.title')}`;
    return () => { document.title = 'Adimat POS'; };
  }, [store, t]);

  useEffect(() => {
    if (!store) return;
    const retryPendingOrders = () => {
      void flushPendingPickupOrders(store.id).then((count) => {
        if (count > 0) setOrderPendingSync(false);
      }).catch(() => undefined);
    };
    if (navigator.onLine !== false) retryPendingOrders();
    window.addEventListener('online', retryPendingOrders);
    return () => window.removeEventListener('online', retryPendingOrders);
  }, [store?.id]);

  const addToCart = useCallback((product: LocalProduct | ScanProduct) => {
    const stockLevel = Math.max(0, Number(product.stock_level) || 0);
    if (stockLevel <= 0) return;
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        return current.map((item) => item.productId === product.id
          ? { ...item, quantity: Math.min(item.quantity + 1, stockLevel) }
          : item);
      }
      return [...current, {
        productId: product.id,
        name: product.name,
        unitPrice: Number(product.selling_price) || 0,
        quantity: 1,
        stockLevel,
        imageUrl: product.image_url || '',
      }];
    });
    setCartOpen(true);
  }, []);

  const scanBarcode = useCallback(async (barcode: string) => {
    if (!store || scanBusy.current) return;
    scanBusy.current = true;
    setScanLoading(true);
    setScanError('');
    try {
      const result = await lookupProductByBarcodeWithSource(store.id, barcode);
      if (!result) {
        setScannedProduct(null);
        setSimilarProducts([]);
        setScanError(t('priceScan.productNotFound'));
        return;
      }
      const product = result.product;
      setScannedProduct(product);
      setIsCachedPrice(result.source === 'cached');
      setSimilarProducts(await getSimilarProducts(store.id, product.id, product.category, 6));
    } catch (error: unknown) {
      setScanError(error instanceof Error ? error.message : t('priceScan.lookupFailed'));
    } finally {
      scanBusy.current = false;
      setScanLoading(false);
    }
  }, [store, t]);

  const updateQuantity = (productId: string, delta: number) => {
    setCart((current) => current
      .map((item) => item.productId === productId
        ? { ...item, quantity: Math.min(item.stockLevel, item.quantity + delta) }
        : item)
      .filter((item) => item.quantity > 0));
  };

  const saveOrder = useCallback(async (paymentMethod: 'paystack' | 'pay_on_delivery') => {
    if (!store || cart.length === 0) throw new Error(t('priceScan.cartEmpty'));
    const now = new Date().toISOString();
    const orderId = generateId();
    const orderNumber = makePickupCode();
    const orderTotal = Math.round(cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100;
    const orderItems = cart.map((item) => ({
      id: generateId(),
      store_id: store.id,
      order_id: orderId,
      product_id: item.productId,
      product_name: item.name,
      unit_price: item.unitPrice,
      quantity: item.quantity,
      subtotal: Math.round(item.unitPrice * item.quantity * 100) / 100,
      created_at: now,
      synced: 0,
    }));
    let synced = 0;
    if (navigator.onLine !== false && isSupabaseConfigured()) {
      try {
        const { error: orderError } = await supabase.from('online_orders').insert({
          id: orderId,
          store_id: store.id,
          order_number: orderNumber,
          customer_name: '',
          customer_phone: '',
          customer_address: '',
          notes: '',
          status: 'new',
          payment_method: paymentMethod,
          total_amount: orderTotal,
          created_at: now,
          updated_at: now,
        });
        if (!orderError) {
          const { error: itemsError } = await supabase.from('online_order_items').insert(orderItems.map((item) => ({
            id: item.id,
            store_id: item.store_id,
            order_id: item.order_id,
            product_id: item.product_id,
            product_name: item.product_name,
            unit_price: item.unit_price,
            quantity: item.quantity,
            subtotal: item.subtotal,
            created_at: item.created_at,
          })));
          if (!itemsError) synced = 1;
        }
      } catch {
        // Save locally and let the store device sync the order later.
      }
    }
    await db.transaction('rw', [db.online_orders, db.online_order_items], async () => {
      await db.online_orders.add({
        id: orderId,
        store_id: store.id,
        order_number: orderNumber,
        customer_name: '',
        customer_phone: '',
        customer_address: '',
        notes: '',
        status: 'new',
        payment_method: paymentMethod,
        total_amount: orderTotal,
        created_at: now,
        updated_at: now,
        synced,
      });
      await db.online_order_items.bulkAdd(orderItems.map((item) => ({ ...item, synced })));
    });
    setCart([]);
    setCartOpen(false);
    setOrderPendingSync(synced === 0);
    setPickupCode(orderNumber);
  }, [store, cart, t]);

  const payAtCounter = async () => {
    setSubmitting(true);
    setCheckoutError('');
    try {
      await saveOrder('pay_on_delivery');
    } catch (error: unknown) {
      setCheckoutError(error instanceof Error ? error.message : t('priceScan.orderFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const payWithPaystack = async () => {
    if (!store || cart.length === 0) return;
    setSubmitting(true);
    setCheckoutError('');
    const reference = generatePaystackReference();
    try {
      await initializePaystack({
        email: resolvePaystackEmail('', reference),
        amount: Math.round(cartTotal * 100),
        reference,
        paymentFor: 'Price-scan pickup order',
        onSuccess: () => {
          void saveOrder('paystack').catch((error: unknown) => {
            setCheckoutError(error instanceof Error ? error.message : t('priceScan.orderFailed'));
          }).finally(() => setSubmitting(false));
        },
        onClose: () => setSubmitting(false),
      });
    } catch (error: unknown) {
      setCheckoutError(error instanceof Error ? error.message : t('priceScan.paymentFailed'));
      setSubmitting(false);
    }
  };

  const visibleSimilar = useMemo(() => similarProducts.slice(0, 6), [similarProducts]);

  if (pageLoading) {
    return <main className="flex min-h-screen items-center justify-center bg-emerald-50 p-6 text-gray-700" role="status">{t('common.loading')}</main>;
  }
  if (!store) {
    return <main className="flex min-h-screen items-center justify-center bg-emerald-50 p-6 text-center text-gray-700"><p role="alert">{pageError || t('priceScan.storeUnavailable')}</p></main>;
  }

  if (pickupCode) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-emerald-50 px-6 py-10 text-center">
        <CheckCircle2 className="mb-4 h-16 w-16 text-emerald-600" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-gray-900">{t('priceScan.orderPlaced')}</h1>
        <p className="mt-3 text-gray-600">{t('priceScan.pickupCode')}</p>
        <p className="mt-2 rounded-2xl bg-white px-6 py-4 font-mono text-3xl font-bold tracking-wider text-primary shadow-sm">{pickupCode}</p>
        <p className="mt-4 max-w-sm text-sm text-gray-600">{t('priceScan.showCode')}</p>
        {orderPendingSync && <p className="mt-4 max-w-sm rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('priceScan.orderSavedOffline')}</p>}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-emerald-50 pb-28 text-gray-900">
      <header className="bg-gradient-to-br from-primary-dark via-primary to-emerald-700 px-4 py-5 text-white shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {store.logo_url && <img src={store.logo_url} alt="" className="h-12 w-12 rounded-xl bg-white object-contain p-1" />}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold">{store.name}</h1>
            <p className="text-xs text-emerald-100">{t('priceScan.title')}</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-xs" aria-label={isOffline ? t('priceScan.offline') : t('priceScan.online')}>
            {isOffline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
            {isOffline ? t('priceScan.offline') : t('priceScan.online')}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-bold">{t('priceScan.scanBarcode')}</h2>
          <BarcodeScanner onScan={scanBarcode} active={!pickupCode} large />
          {scanLoading && <p className="mt-3 text-sm text-primary" role="status">{t('priceScan.lookingUp')}</p>}
          {scanError && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">{scanError}</p>}
        </section>

        {scannedProduct && (
          <section className="rounded-2xl bg-white p-4 shadow-sm" aria-live="polite">
            {isCachedPrice && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{t('priceScan.offlineCached')}</p>}
            <div className="flex items-center gap-4">
              {scannedProduct.image_url && <img src={scannedProduct.image_url} alt="" className="h-20 w-20 rounded-xl object-cover" />}
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-lg font-bold">{scannedProduct.name}</h2>
                <p className="mt-1 text-2xl font-bold text-primary">{money(scannedProduct.selling_price)}</p>
                <StockBadge product={scannedProduct} t={t} />
              </div>
            </div>
            <button type="button" onClick={() => addToCart(scannedProduct)} disabled={scannedProduct.stock_level <= 0} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-white touch-target disabled:bg-gray-300">
              <Plus className="h-5 w-5" />{t('priceScan.addToCart')}
            </button>
          </section>
        )}

        {visibleSimilar.length > 0 && (
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-bold">{t('priceScan.similarProducts')}</h2>
            <ul className="divide-y divide-gray-100">
              {visibleSimilar.map((product) => (
                <li key={product.id} className="flex items-center gap-3 py-3">
                  {product.image_url && <img src={product.image_url} alt="" className="h-14 w-14 rounded-lg object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{product.name}</p>
                    <p className="text-sm font-bold text-primary">{money(product.selling_price)}</p>
                    <StockBadge product={product} t={t} />
                  </div>
                  <button type="button" onClick={() => addToCart(product)} disabled={product.stock_level <= 0} aria-label={`${t('priceScan.addToCart')}: ${product.name}`} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-primary touch-target disabled:opacity-40">{t('priceScan.add')}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {cartCount > 0 && (
        <button type="button" onClick={() => setCartOpen(true)} className="fixed inset-x-4 bottom-4 z-20 mx-auto flex max-w-3xl items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-white shadow-xl touch-target">
          <span className="inline-flex items-center gap-2 font-semibold"><ShoppingCart className="h-5 w-5" />{t('priceScan.cart')} ({cartCount})</span>
          <span className="font-bold">{money(cartTotal)}</span>
        </button>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="price-scan-cart-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="price-scan-cart-title" className="text-xl font-bold">{t('priceScan.cart')}</h2>
              <button type="button" onClick={() => setCartOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 touch-target">{t('common.close')}</button>
            </div>
            {cart.length === 0 ? <p className="py-6 text-center text-gray-500">{t('priceScan.cartEmpty')}</p> : (
              <ul className="divide-y divide-gray-100">
                {cart.map((item) => (
                  <li key={item.productId} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold">{item.name}</p><p className="text-sm text-gray-600">{money(item.unitPrice)} · {money(item.unitPrice * item.quantity)}</p></div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => updateQuantity(item.productId, -1)} aria-label={`${t('priceScan.decrease')} ${item.name}`} className="rounded-lg border p-2 touch-target"><Minus className="h-4 w-4" /></button>
                      <span className="min-w-6 text-center font-semibold">{item.quantity}</span>
                      <button type="button" onClick={() => updateQuantity(item.productId, 1)} aria-label={`${t('priceScan.increase')} ${item.name}`} disabled={item.quantity >= item.stockLevel} className="rounded-lg border p-2 touch-target disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setCart((current) => current.filter((entry) => entry.productId !== item.productId))} aria-label={`${t('common.delete')} ${item.name}`} className="rounded-lg p-2 text-red-600 touch-target"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-between border-t pt-4 text-lg font-bold"><span>{t('priceScan.total')}</span><span>{money(cartTotal)}</span></div>
            {checkoutError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{checkoutError}</p>}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {canPaystack && <button type="button" onClick={() => void payWithPaystack()} disabled={submitting || cart.length === 0} className="rounded-xl bg-primary px-4 py-3 font-semibold text-white touch-target disabled:opacity-50">{submitting ? t('priceScan.processing') : t('priceScan.payNow')}</button>}
              <button type="button" onClick={() => void payAtCounter()} disabled={submitting || cart.length === 0} className="rounded-xl border border-primary px-4 py-3 font-semibold text-primary touch-target disabled:opacity-50">{t('priceScan.payAtCounter')}</button>
            </div>
            {!canPaystack && <p className="mt-2 text-xs text-gray-500">{isOffline ? t('priceScan.offlineCheckoutHint') : t('priceScan.payAtCounterHint')}</p>}
          </section>
        </div>
      )}
    </main>
  );
}

function StockBadge({ product, t }: { product: Pick<LocalProduct, 'stock_level' | 'reorder_level'>; t: ReturnType<typeof useT> }) {
  const stock = Math.max(0, Number(product.stock_level) || 0);
  const label = stock <= 0 ? t('priceScan.outOfStock')
    : stock <= Math.max(1, Number(product.reorder_level) || 5) ? t('priceScan.lowStock')
      : t('priceScan.inStock');
  const color = stock <= 0 ? 'text-red-700' : label === t('priceScan.lowStock') ? 'text-amber-700' : 'text-emerald-700';
  return <p className={`mt-1 text-xs font-semibold ${color}`}>{label}</p>;
}
