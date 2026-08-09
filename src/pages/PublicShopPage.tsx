import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag, Minus, Plus, Trash2, Loader2, ArrowLeft, CheckCircle2, Package,
} from 'lucide-react';
import ProductImage from '@/components/ProductImage';
import {
  fetchPublicShopCatalog,
  placePublicOnlineOrder,
  type OnlineCartItem,
  type PublicShopCatalog,
  type PublicShopProduct,
} from '@/lib/ecommerce';

interface PublicShopPageProps {
  slug: string;
}

type View = 'catalog' | 'cart' | 'checkout' | 'success';

export default function PublicShopPage({ slug }: PublicShopPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<PublicShopCatalog | null>(null);
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
      <div className="min-h-[100dvh] bg-[var(--color-surface)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="min-h-[100dvh] bg-[var(--color-surface)] flex flex-col items-center justify-center p-6 text-center">
        <Package className="w-12 h-12 text-gray-300 mb-3" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">Shop unavailable</h1>
        <p className="text-sm text-gray-500 max-w-sm">{error || 'This storefront was not found.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--color-surface)] flex flex-col">
      <header className="bg-primary text-white px-4 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
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

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 pb-28">
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
              <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {filtered.map((product) => (
                    <div
                      key={product.id}
                      className={`bg-white rounded-xl border border-emerald-50 p-3 flex flex-col ${
                        product.in_stock ? '' : 'opacity-60'
                      }`}
                    >
                      <ProductImage src={product.image_url} alt={product.name} size="lg" className="w-full aspect-square mb-2" />
                      <p className="text-sm font-semibold text-gray-900 line-clamp-2 min-h-[2.5rem]">
                        {product.name}
                      </p>
                      <p className="text-primary font-bold mt-1">
                        GHS {product.selling_price.toFixed(2)}
                      </p>
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
                          GHS {item.unit_price.toFixed(2)}
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
                    <span className="text-lg font-bold text-primary">GHS {cartTotal.toFixed(2)}</span>
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
                    <span className="text-primary">GHS {cartTotal.toFixed(2)}</span>
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
        </div>
      </main>

      {view === 'catalog' && cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)] to-transparent">
          <button
            type="button"
            onClick={() => setView('cart')}
            className="max-w-3xl mx-auto w-full bg-primary text-white py-3.5 rounded-2xl flex items-center justify-between px-5 shadow-lg font-semibold"
          >
            <span>View cart ({cartCount})</span>
            <span>GHS {cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
