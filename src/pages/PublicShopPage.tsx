import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag, Minus, Plus, Trash2, Loader2, ArrowLeft, CheckCircle2, Package, ExternalLink, MapPin, Phone,
} from 'lucide-react';
import ProductImage from '@/components/ProductImage';
import {
  fetchPublicShopCatalog,
  placePublicOnlineOrder,
  type OnlineCartItem,
  type PublicShopCatalog,
  type PublicShopProduct,
} from '@/lib/ecommerce';
import { formatStoreMoney } from '@/lib/currency';
import { useI18nStore, useT } from '@/lib/i18n';
import { readPairCache } from '@/lib/adimatAi/pairCache';
import { suggestBoughtTogether } from '@/lib/adimatAi/boughtTogether';

interface PublicShopPageProps {
  slug: string;
}

type View = 'catalog' | 'cart' | 'checkout' | 'success';

export default function PublicShopPage({ slug }: PublicShopPageProps) {
  const language = useI18nStore((s) => s.language);
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<PublicShopCatalog | null>(null);
  const money = (n: number) => formatStoreMoney(n, catalog?.store.currency_code, language);
  const [cart, setCart] = useState<OnlineCartItem[]>([]);
  const [view, setView] = useState<View>('catalog');
  const [category, setCategory] = useState('All');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCatalog(await fetchPublicShopCatalog(slug));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load shop');
      setCatalog(null);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!catalog) return;
    document.title = `${catalog.store.name} | Online shop`;
    const description = catalog.store.tagline || `Shop ${catalog.store.name} online`;
    const image = `${window.location.origin}/storefront-social-preview.svg`;
    const setMeta = (property: string, content: string) => {
      let tag = document.head.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };
    setMeta('og:title', catalog.store.name);
    setMeta('og:description', description);
    setMeta('og:image', image);
    setMeta('og:type', 'website');
    return () => {
      document.title = 'Adimat POS';
    };
  }, [catalog]);

  const categories = useMemo(() => {
    if (!catalog) return ['All'];
    const set = new Set(catalog.products.map((p) => p.category || 'Other'));
    return ['All', ...Array.from(set).sort()];
  }, [catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    if (category === 'All') return catalog.products;
    return catalog.products.filter((p) => (p.category || 'Other') === category);
  }, [catalog, category]);

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);

  const addToCart = (product: PublicShopProduct) => {
    if (!product.in_stock) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id
            ? { ...i, quantity: Math.min(i.quantity + 1, Math.max(1, product.stock_level)) }
            : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          unit_price: product.selling_price,
          quantity: 1,
          image_url: product.image_url,
        },
      ];
    });
  };

  const updateQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.product_id === productId ? { ...i, quantity: qty } : i))
        .filter((i) => i.quantity > 0)
    );
  };

  const submitOrder = async () => {
    if (!catalog) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await placePublicOnlineOrder({
        storeId: catalog.store.id,
        customerName,
        customerPhone,
        customerAddress,
        notes,
        items: cart,
      });
      setOrderNumber(result.orderNumber);
      setCart([]);
      setView('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Order failed');
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="ios-canvas h-full min-h-0 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="ios-canvas h-full min-h-0 flex flex-col items-center justify-center p-6 text-center">
        <Package className="w-12 h-12 text-gray-300 mb-3" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Shop unavailable</h1>
        <p className="text-sm text-gray-500 max-w-sm">{error || 'This storefront was not found.'}</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 bg-emerald-50/60 flex flex-col overflow-hidden">
      <header className="bg-gradient-to-br from-primary-dark via-primary to-emerald-700 text-white px-4 py-5 xl:px-0 flex-shrink-0 shadow-lg">
        <div className="mx-auto flex w-full items-center gap-3 xl:px-8 2xl:px-12">
          {catalog.store.logo_url ? (
            <img
              src={catalog.store.logo_url}
              alt=""
              className="w-12 h-12 rounded-xl object-cover bg-white"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center">
              <ShoppingBag className="w-6 h-6" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold truncate">{catalog.store.name}</h1>
            <p className="text-emerald-100 text-xs mt-0.5 truncate">{catalog.store.tagline}</p>
          </div>
          {view !== 'success' && (
            <button
              type="button"
              onClick={() => setView(view === 'catalog' ? 'cart' : 'catalog')}
              className="relative bg-white/15 px-3 py-2 rounded-xl touch-target"
            >
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-amber-400 text-amber-950 text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
                  {cartCount}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      <main
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div className="mx-auto w-full px-4 py-5 pb-28 xl:px-8 2xl:px-12">
          <section className="mb-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-emerald-100">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Welcome to {catalog.store.name}</p>
            <p className="mt-1 text-sm text-gray-600">{catalog.store.tagline}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
              {catalog.store.address ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-primary" />{catalog.store.address}</span> : null}
              {catalog.store.support_number ? <a href={`tel:${catalog.store.support_number}`} className="inline-flex items-center gap-1 text-primary"><Phone className="h-3.5 w-3.5" />{catalog.store.support_number}</a> : null}
            </div>
            {catalog.store.links.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                {catalog.store.links.map((link) => (
                  <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-2 text-xs font-semibold text-primary hover:bg-emerald-100">
                    {link.label}<ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
            ) : null}
          </section>
          {error && view !== 'catalog' && (
            <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {view === 'success' && (
            <div className="text-center py-16">
              <CheckCircle2 className="w-14 h-14 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Order placed</h2>
              <p className="text-sm text-gray-600 mb-1">Reference</p>
              <p className="text-lg font-mono font-bold text-primary mb-4">{orderNumber}</p>
              <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6">
                Pay on delivery. The store will contact you on {customerPhone || 'your phone'} to confirm.
              </p>
              <button
                type="button"
                onClick={() => {
                  setView('catalog');
                  setCustomerName('');
                  setCustomerPhone('');
                  setCustomerAddress('');
                  setNotes('');
                }}
                className="px-5 py-3 bg-primary text-white rounded-xl font-semibold touch-target"
              >
                Continue shopping
              </button>
            </div>
          )}

          {view === 'catalog' && (
            <>
              <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4 touch-pan-x">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                      category === cat
                        ? 'bg-primary text-white'
                        : 'bg-white text-gray-600 border border-gray-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Package className="w-10 h-10 mx-auto mb-3" />
                  <p className="text-sm">No products listed yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {filtered.map((product) => (
                    <div
                      key={product.id}
                      className={`bg-white rounded-2xl border border-emerald-100 p-3 flex flex-col shadow-sm transition-shadow hover:shadow-md ${
                        product.in_stock ? '' : 'opacity-60'
                      }`}
                    >
                      <ProductImage src={product.image_url} alt={product.name} size="lg" className="w-full aspect-square mb-2" />
                      <p className="text-sm font-semibold text-gray-900 line-clamp-2 min-h-[2.5rem]">
                        {product.name}
                      </p>
                      <p className="text-primary font-bold mt-1">
                        {money(product.selling_price)}
                      </p>
                      {(() => {
                        const cache = readPairCache(catalog.store.id);
                        const suggestion = suggestBoughtTogether(cache?.pairs || [], cache?.names || {}, [product.id], 1)[0];
                        const match = suggestion ? catalog.products.find((item) => item.id === suggestion.productId && item.in_stock) : null;
                        if (!match) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => addToCart(match)}
                            className="mt-1 text-left text-[11px] font-semibold text-emerald-800"
                          >
                            {t('ai.alsoBuy')}: {match.name}
                          </button>
                        );
                      })()}
                      <p className="text-[10px] text-gray-500 mt-0.5 mb-2">
                        {product.in_stock ? 'In stock' : 'Out of stock'}
                      </p>
                      <button
                        type="button"
                        disabled={!product.in_stock}
                        onClick={() => addToCart(product)}
                        className="mt-auto w-full py-2 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-40 touch-target"
                      >
                        Add to cart
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {(view === 'cart' || view === 'checkout') && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setView(view === 'checkout' ? 'cart' : 'catalog')}
                className="inline-flex items-center gap-1 text-sm text-primary font-medium touch-target"
              >
                <ArrowLeft className="w-4 h-4" />
                {view === 'checkout' ? 'Back to cart' : 'Back to products'}
              </button>

              {cart.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <ShoppingBag className="w-10 h-10 mx-auto mb-3" />
                  <p className="text-sm">Your cart is empty</p>
                </div>
              ) : view === 'cart' ? (
                <>
                  {cart.map((item) => (
                    <div
                      key={item.product_id}
                      className="bg-white border border-emerald-50 rounded-xl p-3 flex items-center gap-3"
                    >
                      <ProductImage src={item.image_url} alt={item.product_name} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{item.product_name}</p>
                        <p className="text-xs text-primary font-bold mt-0.5">
                          {money(item.unit_price)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateQty(item.product_id, item.quantity - 1)}
                          className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQty(item.product_id, item.quantity + 1)}
                          className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateQty(item.product_id, 0)}
                          className="p-2 text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="bg-white border border-emerald-50 rounded-xl p-4 flex items-center justify-between">
                    <span className="font-semibold text-gray-700">Total</span>
                    <span className="text-lg font-bold text-primary">{money(cartTotal)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setView('checkout')}
                    className="w-full py-3.5 bg-primary text-white rounded-xl font-bold touch-target"
                  >
                    Checkout
                  </button>
                </>
              ) : (
                <div className="bg-white border border-emerald-50 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">
                    Payment: <span className="font-semibold">Pay on delivery</span>
                  </p>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Full name</label>
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Phone</label>
                    <input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
                      placeholder="0XXXXXXXXX"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Delivery address</label>
                    <textarea
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      rows={2}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Where should we deliver?"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Notes (optional)</label>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
                      placeholder="Any special instructions"
                    />
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-1">
                    <span>Order total</span>
                    <span className="text-primary">{money(cartTotal)}</span>
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitOrder()}
                    className="w-full py-3.5 bg-primary text-white rounded-xl font-bold touch-target disabled:opacity-50"
                  >
                    {submitting ? 'Placing order…' : 'Place order'}
                  </button>
                </div>
              )}
            </div>
          )}

          {view === 'catalog' ? (
            <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-gray-500">
              <a href="#/terms" className="font-semibold text-primary">Terms & conditions</a>
              <span>Powered by Adimat</span>
            </footer>
          ) : null}
        </div>
      </main>

      {view === 'catalog' && cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)] to-transparent pointer-events-none z-30">
          <button
            type="button"
            onClick={() => setView('cart')}
            className="pointer-events-auto max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto w-full bg-primary text-white py-3.5 rounded-2xl flex items-center justify-between px-5 shadow-lg font-semibold"
          >
            <span>View cart ({cartCount})</span>
            <span>{money(cartTotal)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
