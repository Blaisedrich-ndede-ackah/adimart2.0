import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag, Minus, Plus, Trash2, Loader2, ArrowLeft, CheckCircle2, Package, ExternalLink, MapPin, Phone, UserRound,
} from 'lucide-react';
import ProductImage from '@/components/ProductImage';
import ShopAccountCard from '@/components/shop/ShopAccountCard';
import ShopAuthCard, { type ShopAuthMode } from '@/components/shop/ShopAuthCard';
import ShopCheckoutCard from '@/components/shop/ShopCheckoutCard';
import {
  fetchPublicShopCatalog,
  type OnlineCartItem,
  type PublicShopCatalog,
  type PublicShopProduct,
} from '@/lib/ecommerce';
import { formatStoreMoney } from '@/lib/currency';
import { useI18nStore, useT } from '@/lib/i18n';
import {
  currentShopToken,
  rememberSession,
  shopCheckout,
  shopLogin,
  shopMe,
  shopRequestOtp,
  shopResetEmail,
  shopSignOut,
  shopSignup,
  shopStartTopup,
  shopUpdatePassword,
  shopVerifyOtp,
  shopVerifyPayment,
  shopperSupabase,
  type ShopProfile,
} from '@/lib/shopClient';

interface PublicShopPageProps {
  slug: string;
}

type View = 'catalog' | 'cart' | 'checkout' | 'success' | 'auth' | 'account';

const previewProfile: ShopProfile = {
  account: {
    id: 'preview-account',
    name: 'Ama Owusu',
    phone: '+233244123456',
    email: 'ama@example.com',
    store_id: '00000000-0000-4000-8000-000000000001',
    customer_id: 'preview-customer',
  },
  balance: 45,
  transactions: [{
    id: 'preview-tx',
    entry_type: 'topup',
    direction: 'credit',
    amount: 45,
    balance_after: 45,
    description: 'Paystack wallet top-up',
    payment_reference: 'WAL-PREVIEW',
    created_at: new Date().toISOString(),
  }],
  orders: [{
    id: 'preview-order',
    order_number: 'ON-PREVIEW',
    status: 'new',
    payment_method: 'wallet',
    total_amount: 32,
    wallet_amount: 32,
    paystack_amount: 0,
    created_at: new Date().toISOString(),
  }],
};

const previewCatalog: PublicShopCatalog = {
  store: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Makola Groceries',
    address: 'Makola Market, Accra',
    support_number: '0244000000',
    logo_url: '',
    tagline: 'Fresh goods, delivered around Accra',
    slug: 'preview',
    currency_code: 'GHS',
    links: [],
  },
  products: [
    { id: 'rice', name: 'Local rice 5kg', category: 'Grocery', selling_price: 85, stock_level: 12, image_url: '', in_stock: true },
    { id: 'oil', name: 'Cooking oil 1L', category: 'Grocery', selling_price: 32, stock_level: 8, image_url: '', in_stock: true },
    { id: 'soap', name: 'Bar soap', category: 'Household', selling_price: 8, stock_level: 20, image_url: '', in_stock: true },
  ],
};

function hashReference(): string {
  const hash = window.location.hash.replace(/^#/, '');
  const query = hash.split('?')[1] || '';
  return new URLSearchParams(query).get('reference') || new URLSearchParams(window.location.search).get('reference') || '';
}

export default function PublicShopPage({ slug }: PublicShopPageProps) {
  const preview = import.meta.env.DEV && slug === 'preview';
  const language = useI18nStore((s) => s.language);
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState<PublicShopCatalog | null>(null);
  const money = (n: number) => formatStoreMoney(n, catalog?.store.currency_code, language);
  const [cart, setCart] = useState<OnlineCartItem[]>([]);
  const [view, setView] = useState<View>('catalog');
  const [category, setCategory] = useState('All');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<'delivery' | 'wallet' | 'paystack' | 'mixed'>('delivery');
  const [walletAmount, setWalletAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [authMode, setAuthMode] = useState<ShopAuthMode>('login');
  const [otpPhone, setOtpPhone] = useState('');
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [recovery, setRecovery] = useState(false);

  const applyProfile = (next: Partial<ShopProfile> | ShopProfile) => {
    if (!next.account) return;
    setProfile(next as ShopProfile);
    setCustomerName(next.account.name);
    setCustomerPhone(next.account.phone);
    setView('account');
  };

  const loadProfile = useCallback(async (storeId: string) => {
    const token = await currentShopToken();
    if (!token) return;
    try {
      applyProfile(await shopMe(storeId, token));
    } catch {
      await shopSignOut();
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (preview) {
        setCatalog(previewCatalog);
      } else {
        const next = await fetchPublicShopCatalog(slug);
        setCatalog(next);
        await loadProfile(next.store.id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load shop');
      setCatalog(null);
    }
    setLoading(false);
  }, [loadProfile, preview, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!catalog || preview) return;
    const reference = hashReference();
    if (!reference) return;
    setSubmitting(true);
    void shopVerifyPayment(catalog.store.id, reference)
      .then(async (result) => {
        if (result.orderNumber) {
          setOrderNumber(result.orderNumber);
          setCart([]);
          setView('success');
        } else {
          setNotice(result.creditedWallet ? 'Wallet topped up.' : 'Payment received.');
          setView('account');
        }
        const token = await currentShopToken();
        if (token) applyProfile(await shopMe(catalog.store.id, token));
        const clean = `${window.location.pathname}#/shop/${catalog.store.slug}`;
        window.history.replaceState(null, '', clean);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Payment could not be verified'))
      .finally(() => setSubmitting(false));
  }, [catalog, preview]);

  useEffect(() => {
    if (preview) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('shop_recovery') && !params.get('code')) return;
    setRecovery(true);
    setAuthMode('reset');
    setView('auth');
    void shopperSupabase.auth.getSession().then(({ data }) => {
      if (data.session) setNotice('Choose a new password.');
    });
  }, [preview]);

  useEffect(() => {
    if (!catalog) return;
    document.title = `${catalog.store.name} | Online shop`;
    return () => {
      document.title = 'Adimat POS';
    };
  }, [catalog]);

  const categories = useMemo(() => {
    if (!catalog) return ['All'];
    return ['All', ...Array.from(new Set(catalog.products.map((product) => product.category || 'Other'))).sort()];
  }, [catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    if (category === 'All') return catalog.products;
    return catalog.products.filter((product) => (product.category || 'Other') === category);
  }, [catalog, category]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

  const addToCart = (product: PublicShopProduct) => {
    if (!product.in_stock) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.id);
      if (existing) {
        return prev.map((item) => item.product_id === product.id
          ? { ...item, quantity: Math.min(item.quantity + 1, Math.max(1, product.stock_level)) }
          : item);
      }
      return [...prev, {
        product_id: product.id,
        product_name: product.name,
        unit_price: product.selling_price,
        quantity: 1,
        image_url: product.image_url,
      }];
    });
  };

  const updateQty = (productId: string, qty: number) => {
    setCart((prev) => prev.map((item) => item.product_id === productId ? { ...item, quantity: qty } : item).filter((item) => item.quantity > 0));
  };

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong');

  const onSignup = async (input: { name: string; phone: string; email: string; password: string }) => {
    if (!catalog) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      if (preview) {
        setOtpPhone(input.phone);
        setAuthMode('otp');
        setNotice('Preview shop: enter any 6-digit code.');
        return;
      }
      const result = await shopSignup({ storeId: catalog.store.id, ...input });
      if (result.session && result.account) {
        await rememberSession(result.session);
        applyProfile(result);
        setNotice('Account created.');
        return;
      }
      setOtpPhone(result.phone || input.phone);
      setAuthMode('otp');
      setNotice('Enter the SMS code to finish creating the account.');
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onLogin = async (identifier: string, password: string) => {
    if (!catalog) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      if (preview) {
        setProfile(previewProfile);
        setCustomerName(previewProfile.account.name);
        setCustomerPhone('0244123456');
        setView('account');
        return;
      }
      const result = await shopLogin(catalog.store.id, identifier, password);
      if (result.needsOtp) {
        setOtpPhone(result.phone || identifier);
        setAuthMode('otp');
        setNotice(result.message || 'Enter the SMS code.');
        return;
      }
      if (result.session) await rememberSession(result.session);
      applyProfile(result);
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onOtp = async (code: string) => {
    if (!catalog) return;
    setSubmitting(true);
    setError('');
    try {
      if (preview) {
        setProfile(previewProfile);
        setCustomerName(previewProfile.account.name);
        setCustomerPhone('0244123456');
        setNotice('Phone confirmed in the preview shop.');
        setView('account');
        return;
      }
      const result = await shopVerifyOtp(catalog.store.id, otpPhone, code);
      if (result.session) await rememberSession(result.session);
      applyProfile(result);
      setNotice('Phone confirmed.');
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onTopup = async (amount: number) => {
    if (!catalog) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      if (preview) {
        setNotice('Preview shop: Paystack would open for MoMo, card, or bank. The wallet is credited only after verification.');
        return;
      }
      const token = await currentShopToken();
      const started = await shopStartTopup(catalog.store.id, amount, token);
      window.location.assign(started.authorizationUrl);
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onCheckout = async () => {
    if (!catalog) return;
    setSubmitting(true);
    setError('');
    try {
      if (preview) {
        if (method === 'paystack' || method === 'mixed') {
          setNotice('Preview shop: Paystack would open for the remaining balance.');
          setView('checkout');
        } else {
          setOrderNumber(method === 'wallet' ? 'ON-WALLET' : 'ON-DELIVERY');
          setCart([]);
          setView('success');
        }
        return;
      }
      const token = await currentShopToken();
      const result = await shopCheckout({
        storeId: catalog.store.id,
        method,
        name: customerName,
        phone: customerPhone,
        address: customerAddress,
        notes,
        walletAmount: Number(walletAmount) || 0,
        items: cart.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
        token,
      });
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      setOrderNumber(result.orderNumber || '');
      setCart([]);
      if (token) applyProfile(await shopMe(catalog.store.id, token));
      setView('success');
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="ios-canvas flex h-full min-h-0 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="ios-canvas flex h-full min-h-0 flex-col items-center justify-center p-6 text-center">
        <Package className="mb-3 h-12 w-12 text-muted" />
        <h1 className="mb-2 text-xl font-bold text-ink">Shop unavailable</h1>
        <p className="max-w-sm text-sm text-muted">{error || 'This storefront was not found.'}</p>
      </div>
    );
  }

  return (
    <div className="ios-canvas flex h-full min-h-0 flex-col overflow-hidden">
      <header className="ios-bar flex-shrink-0 px-4 py-4 xl:px-8">
        <div className="mx-auto flex w-full items-center gap-3">
          {catalog.store.logo_url ? (
            <img src={catalog.store.logo_url} alt="" className="h-12 w-12 rounded-2xl bg-white/80 object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/50">
              <ShoppingBag className="h-6 w-6 text-primary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-bold tracking-tight text-ink">{catalog.store.name}</h1>
            <p className="truncate text-[13px] text-muted">{catalog.store.tagline}</p>
          </div>
          <button type="button" onClick={() => setView(profile ? 'account' : 'auth')} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-white/70 px-3 text-sm font-semibold text-primary">
            <UserRound className="h-4 w-4" /> {profile ? 'Account' : 'Log in'}
          </button>
          {view !== 'success' ? (
            <button type="button" onClick={() => setView(view === 'catalog' ? 'cart' : 'catalog')} className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-primary text-white">
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 ? <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950">{cartCount}</span> : null}
            </button>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="mx-auto w-full px-4 py-5 pb-28 xl:px-8">
          {view === 'catalog' ? (
            <section className="ios-glass mb-5 rounded-[28px] p-4">
              <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-primary">Welcome to {catalog.store.name}</p>
              <p className="mt-1 text-sm text-muted">{catalog.store.tagline}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                {catalog.store.address ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-primary" />{catalog.store.address}</span> : null}
                {catalog.store.support_number ? <a href={`tel:${catalog.store.support_number}`} className="inline-flex items-center gap-1 font-semibold text-primary"><Phone className="h-3.5 w-3.5" />{catalog.store.support_number}</a> : null}
              </div>
              {catalog.store.links.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-white/50 pt-3">
                  {catalog.store.links.map((link) => (
                    <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-2 text-xs font-semibold text-primary">
                      {link.label}<ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {view === 'auth' ? (
            <ShopAuthCard
              mode={recovery ? 'reset' : authMode}
              busy={submitting}
              error={error}
              notice={notice}
              phone={otpPhone}
              onMode={(next) => {
                setAuthMode(next);
                setRecovery(false);
                setError('');
                setNotice('');
              }}
              onLogin={(identifier, password) => void onLogin(identifier, password)}
              onSignup={(input) => void onSignup(input)}
              onOtp={(code) => void onOtp(code)}
              onResend={() => {
                if (preview) {
                  setNotice('Preview shop: the code can be any 6 digits.');
                  return;
                }
                void shopRequestOtp(catalog.store.id, otpPhone).then(() => setNotice('A new code is on the way.')).catch(fail);
              }}
              onForgot={(email) => {
                if (preview) {
                  setNotice('Preview shop: a reset link would be emailed.');
                  return;
                }
                const redirectTo = `${window.location.origin}/?shop_recovery=${encodeURIComponent(catalog.store.slug)}`;
                void shopResetEmail(email, redirectTo).then(() => setNotice('Check your email for the reset link.')).catch(fail);
              }}
              onReset={(password) => {
                if (preview) {
                  setNotice('Password updated in the preview shop.');
                  setView('account');
                  return;
                }
                void currentShopToken().then((token) => shopUpdatePassword(password, token)).then(() => {
                  setNotice('Password updated.');
                  setRecovery(false);
                  setView(profile ? 'account' : 'auth');
                  setAuthMode('login');
                }).catch(fail);
              }}
            />
          ) : null}

          {view === 'account' && profile ? (
            <ShopAccountCard
              profile={profile}
              busy={submitting}
              error={error}
              notice={notice}
              money={money}
              onTopup={(amount) => void onTopup(amount)}
              onLogout={() => {
                void shopSignOut();
                setProfile(null);
                setView('catalog');
              }}
              onReset={(password) => {
                if (preview) {
                  setNotice('Password updated in the preview shop.');
                  return;
                }
                void currentShopToken().then((token) => shopUpdatePassword(password, token)).then(() => setNotice('Password updated.')).catch(fail);
              }}
            />
          ) : null}

          {view === 'success' ? (
            <div className="ios-glass mx-auto max-w-md rounded-[28px] px-6 py-12 text-center">
              <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-primary" />
              <h2 className="mb-2 text-2xl font-bold text-ink">Order placed</h2>
              <p className="mb-1 text-sm text-muted">Reference</p>
              <p className="mb-4 font-mono text-lg font-bold text-primary">{orderNumber}</p>
              <button type="button" onClick={() => setView('catalog')} className="rounded-2xl bg-primary px-5 py-3 font-semibold text-white">Continue shopping</button>
            </div>
          ) : null}

          {view === 'catalog' ? (
            <>
              <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
                {categories.map((item) => (
                  <button key={item} type="button" onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold ${category === item ? 'bg-primary text-white' : 'bg-white/70 text-ink'}`}>
                    {item}
                  </button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-muted">
                  <Package className="mx-auto mb-3 h-10 w-10" />
                  <p className="text-sm">No products listed yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {filtered.map((product) => (
                    <article key={product.id} className={`flex flex-col rounded-[24px] border border-white/70 bg-white/55 p-3 shadow-[0_10px_28px_rgba(36,54,78,0.07)] backdrop-blur-md ${product.in_stock ? '' : 'opacity-60'}`}>
                      <ProductImage src={product.image_url} alt={product.name} size="lg" className="mb-2 aspect-square w-full" />
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-ink">{product.name}</p>
                      <p className="mt-1 font-bold text-primary">{money(product.selling_price)}</p>
                      <p className="mb-2 text-[10px] text-muted">{product.in_stock ? 'In stock' : 'Out of stock'}</p>
                      <button type="button" disabled={!product.in_stock} onClick={() => addToCart(product)} className="mt-auto w-full rounded-2xl bg-primary py-2 text-xs font-semibold text-white disabled:opacity-40">
                        Add to cart
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {view === 'cart' || view === 'checkout' ? (
            <div className="mx-auto max-w-xl space-y-3">
              <button type="button" onClick={() => setView(view === 'checkout' ? 'cart' : 'catalog')} className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
                <ArrowLeft className="h-4 w-4" /> {view === 'checkout' ? 'Back to cart' : 'Back to products'}
              </button>
              {cart.length === 0 ? (
                <div className="py-16 text-center text-muted">
                  <ShoppingBag className="mx-auto mb-3 h-10 w-10" />
                  <p className="text-sm">Your cart is empty</p>
                </div>
              ) : view === 'cart' ? (
                <>
                  {cart.map((item) => (
                    <div key={item.product_id} className="ios-glass flex items-center gap-3 rounded-[24px] p-3">
                      <ProductImage src={item.image_url} alt={item.product_name} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{item.product_name}</p>
                        <p className="text-xs font-bold text-primary">{money(item.unit_price)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => updateQty(item.product_id, item.quantity - 1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70"><Minus className="h-4 w-4" /></button>
                        <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                        <button type="button" onClick={() => updateQty(item.product_id, item.quantity + 1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Plus className="h-4 w-4" /></button>
                        <button type="button" onClick={() => updateQty(item.product_id, 0)} className="p-2 text-red-500"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                  <div className="ios-glass flex items-center justify-between rounded-[24px] p-4">
                    <span className="font-semibold text-ink">Total</span>
                    <span className="text-lg font-bold text-primary">{money(cartTotal)}</span>
                  </div>
                  <button type="button" onClick={() => setView('checkout')} className="w-full rounded-2xl bg-primary py-3.5 font-bold text-white">Checkout</button>
                </>
              ) : (
                <ShopCheckoutCard
                  totalLabel={money(cartTotal)}
                  balanceLabel={money(profile?.balance || 0)}
                  signedIn={Boolean(profile)}
                  busy={submitting}
                  error={error}
                  name={customerName}
                  phone={customerPhone}
                  address={customerAddress}
                  notes={notes}
                  method={method}
                  walletAmount={walletAmount}
                  onName={setCustomerName}
                  onPhone={setCustomerPhone}
                  onAddress={setCustomerAddress}
                  onNotes={setNotes}
                  onMethod={setMethod}
                  onWalletAmount={setWalletAmount}
                  onSubmit={() => void onCheckout()}
                />
              )}
            </div>
          ) : null}
        </div>
      </main>

      {view === 'catalog' && cartCount > 0 ? (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 p-4">
          <button type="button" onClick={() => setView('cart')} className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-primary px-5 py-3.5 font-semibold text-white shadow-lg">
            <span>View cart ({cartCount})</span>
            <span>{money(cartTotal)}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
