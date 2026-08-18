import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingCart, Minus, Plus, Trash2, Search, ChevronRight, Package, AlertCircle, Bluetooth,
  ScanBarcode, MapPin
} from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import CheckoutOverlay from '@/components/CheckoutOverlay';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';
import { LocalProduct, LocalLocation, getCurrentStoreActiveProducts, getCurrentStoreId } from '@/lib/dexie';
import { playScanBeep, primeScanBeep } from '@/lib/scanBeep';
import { useBluetoothBarcodeInput } from '@/hooks/useBluetoothBarcodeInput';
import { getBluetoothHardwareStatus, subscribeBluetoothStatus } from '@/lib/bluetoothPeripherals';
import ProductImage from '@/components/ProductImage';
import { getAvailableSaleModes, type SaleMode, type UnitType } from '@/lib/bulkPricing';
import { subscribeStockChanges } from '@/lib/stockEvents';
import {
  canUserSellWholesale,
  ensureStoreLocations,
  getLocationStockMap,
  alignProductsWithBatchStock,
  resolveSaleLocations,
} from '@/lib/warehouse';
import { triggerAutoSync } from '@/lib/sync';

type PosTab = 'products' | 'cart';

export default function POSPage() {
  const cart = useCartStore();
  const setSaleContext = useCartStore((s) => s.setSaleContext);
  const { currentUser, currentStore } = useAuthStore();
  const [posTab, setPosTab] = useState<PosTab>('products');
  const [scannerActive, setScannerActive] = useState(true);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [locationStock, setLocationStock] = useState<Record<string, number>>({});
  const [saleLocations, setSaleLocations] = useState<LocalLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [saleMode, setSaleMode] = useState<SaleMode>('retail');
  const [unitType, setUnitType] = useState<UnitType>('base');
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [stockError, setStockError] = useState<string | null>(null);
  const [btStatus, setBtStatus] = useState(getBluetoothHardwareStatus());

  const canWholesale = canUserSellWholesale(currentUser);

  const loadSaleContext = useCallback(async () => {
    if (!currentStore || !currentUser) return;
    await ensureStoreLocations(currentStore.id);
    const locations = await resolveSaleLocations(currentStore, currentUser);
    setSaleLocations(locations);
    setSelectedLocationId((prev) => {
      if (prev && locations.some((l) => l.id === prev)) return prev;
      return (
        locations.find((l) => l.id === currentUser.assigned_location_id)?.id ||
        locations.find((l) => l.is_default === 1)?.id ||
        locations[0]?.id ||
        ''
      );
    });
  }, [currentStore, currentUser]);

  const loadProducts = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft);
    if (!soft) setLoadingProducts(true);
    try {
      const storeId = await getCurrentStoreId();
      if (storeId && !soft) await ensureStoreLocations(storeId);
      let list = await getCurrentStoreActiveProducts();
      // Keep catalog stock_level = batch totals (same truth Inventory uses)
      if (storeId) {
        try {
          list = await alignProductsWithBatchStock(list);
        } catch {
          // Still show products even if align fails
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(list);

      if (storeId && selectedLocationId) {
        setLocationStock(await getLocationStockMap(storeId, selectedLocationId));
      } else {
        setLocationStock({});
      }
    } finally {
      if (!soft) setLoadingProducts(false);
    }
  }, [selectedLocationId]);

  useEffect(() => {
    void loadSaleContext();
  }, [loadSaleContext]);

  useEffect(() => {
    setSaleContext(selectedLocationId || null, saleMode);
  }, [selectedLocationId, saleMode, setSaleContext]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // Match Inventory: pull cloud stock when returning to POS on this device
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        await triggerAutoSync('pos-visible');
        await loadProducts({ soft: true });
      })();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadProducts]);

  // Instant stock UI after sale / order / adjust — no full catalog reload
  useEffect(() => {
    if (!currentStore?.id) return;
    return subscribeStockChanges((event) => {
      if (event.storeId !== currentStore.id) return;

      setProducts((prev) =>
        prev.map((p) => {
          const change = event.changes.find((c) => c.productId === p.id);
          if (!change || change.totalQty === undefined) return p;
          return { ...p, stock_level: change.totalQty };
        })
      );

      if (!event.locationId || event.locationId === selectedLocationId) {
        setLocationStock((prev) => {
          const next = { ...prev };
          for (const change of event.changes) {
            if (change.locationQty !== undefined) {
              next[change.productId] = change.locationQty;
            }
          }
          return next;
        });
      }
    });
  }, [currentStore?.id, selectedLocationId]);

  useEffect(() => {
    // iOS/Safari often blocks WebAudio until the first user gesture.
    const handler = () => {
      primeScanBeep();
      window.removeEventListener('pointerdown', handler);
    };
    window.addEventListener('pointerdown', handler, { passive: true });
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  useEffect(() => {
    setBtStatus(getBluetoothHardwareStatus());
    return subscribeBluetoothStatus(() => setBtStatus(getBluetoothHardwareStatus()));
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
    });
    return ['All', ...Array.from(cats).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, searchQuery, selectedCategory]);

  const flashFeedback = useCallback((feedback: { type: 'success' | 'error' | 'warning'; message: string }, ms = 2500) => {
    setScanFeedback(feedback);
    setTimeout(() => setScanFeedback(null), ms);
  }, []);

  const handleScan = useCallback(async (barcode: string) => {
    const result = await cart.addItemByBarcode(barcode);

    if (result.success && result.product) {
      flashFeedback({ type: 'success', message: `Added: ${result.product.name}` });
      playScanBeep('success');
      setPosTab('cart');
    } else if (result.error) {
      if (result.error.includes('out of stock') || result.error.includes('available')) {
        flashFeedback({ type: 'warning', message: result.error });
        playScanBeep('warning');
      } else {
        flashFeedback({ type: 'error', message: result.error });
        playScanBeep('error');
      }
    }
  }, [cart, flashFeedback]);

  // Handheld Bluetooth / HID scanner → cart (active while not in checkout)
  useBluetoothBarcodeInput(handleScan, scannerActive && !showCheckout);

  const handleAddProduct = async (product: LocalProduct) => {
    const modes = getAvailableSaleModes(product);
    const mode = saleMode === 'wholesale' && modes.includes('wholesale') ? 'wholesale' : 'retail';
    if (mode !== saleMode) cart.setSaleContext(selectedLocationId || null, mode);

    const packSize = Math.max(1, Number(product.pack_size) || 1);
    const usePack = unitType === 'pack' && packSize > 1;
    const result = await cart.addItem(product, { unitType: usePack ? 'pack' : 'base' });

    if (result.success) {
      flashFeedback({ type: 'success', message: `Added: ${product.name}` }, 2000);
      playScanBeep('success');
    } else if (result.error) {
      setStockError(result.error);
      playScanBeep('error');
      setTimeout(() => setStockError(null), 3000);
    }
  };

  const handleIncrement = async (itemId: string) => {
    const result = await cart.incrementItem(itemId);
    if (!result.success && result.error) {
      setStockError(result.error);
      setTimeout(() => setStockError(null), 3000);
    }
  };

  const handleUpdateQuantity = async (itemId: string, newQty: number) => {
    const result = await cart.updateQuantity(itemId, newQty);
    if (!result.success && result.error) {
      setStockError(result.error);
      setTimeout(() => setStockError(null), 3000);
    }
  };

  const handleCheckoutComplete = (_receipt: string) => {
    setShowCheckout(false);
    setScannerActive(true);
    setPosTab('products');
    // Stock already patched via stockEvents — soft refresh without spinner
    void loadProducts({ soft: true });
  };

  const cartCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="page-shell relative">
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div>
          <h1>POS</h1>
          <p className="text-emerald-200 text-xs mt-0.5">Hi, {currentUser?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          {(btStatus.hidScannerEnabled || btStatus.scannerConnected) && (
            <div
              className="bg-white/15 px-2 py-1 rounded-lg flex items-center gap-1"
              title={btStatus.scannerConnected ? `BLE: ${btStatus.scannerName}` : 'HID scanner ready'}
            >
              <Bluetooth className="w-3.5 h-3.5 text-emerald-200" />
              <span className="text-[10px] text-emerald-100 font-medium">Scanner</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowCameraScanner((v) => !v)}
            className={`p-2.5 rounded-xl touch-target ${
              showCameraScanner ? 'bg-white text-primary' : 'bg-white/20 text-white'
            }`}
            title="Camera scanner"
          >
            <ScanBarcode className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Products / Cart tabs — mobile only; desktop shows both panes */}
      <div className="bg-white border-b border-emerald-100 px-3 py-2 flex gap-2 flex-shrink-0 md:hidden">
        <button
          type="button"
          onClick={() => setPosTab('products')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold touch-target ${
            posTab === 'products' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Products
        </button>
        <button
          type="button"
          onClick={() => setPosTab('cart')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold touch-target inline-flex items-center justify-center gap-2 ${
            posTab === 'cart' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          Cart{cartCount > 0 ? ` (${cartCount})` : ''}
        </button>
      </div>

      {/* Sale context: location + retail/wholesale + unit */}
      <div className="bg-white border-b border-emerald-50 px-3 py-2.5 md:px-4 flex-shrink-0 space-y-2 md:space-y-0 md:flex md:items-center md:gap-3">
        <div className="flex items-center gap-2 md:flex-1 md:min-w-0">
          <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <select
            value={selectedLocationId}
            onChange={(e) => {
              if (cart.items.length > 0 && !confirm('Change location clears the cart. Continue?')) return;
              cart.clearCart();
              setSelectedLocationId(e.target.value);
            }}
            className="flex-1 text-xs font-semibold bg-emerald-50/60 border border-emerald-100 rounded-lg px-2 py-2 outline-none"
          >
            {saleLocations.length === 0 && <option value="">No location</option>}
            {saleLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name} ({loc.location_type})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 md:w-auto md:flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              if (cart.items.length > 0 && saleMode !== 'retail' && !confirm('Switching to retail clears the cart. Continue?')) return;
              if (saleMode !== 'retail') cart.clearCart();
              setSaleMode('retail');
            }}
            className={`flex-1 md:flex-none md:px-4 py-2 rounded-lg text-xs font-semibold touch-target ${
              saleMode === 'retail' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            Retail
          </button>
          <button
            type="button"
            disabled={!canWholesale}
            onClick={() => {
              if (!canWholesale) return;
              if (cart.items.length > 0 && saleMode !== 'wholesale' && !confirm('Switching to wholesale clears the cart. Continue?')) return;
              if (saleMode !== 'wholesale') cart.clearCart();
              setSaleMode('wholesale');
            }}
            className={`flex-1 md:flex-none md:px-4 py-2 rounded-lg text-xs font-semibold touch-target disabled:opacity-40 ${
              saleMode === 'wholesale' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
            title={canWholesale ? 'Wholesale / bulk pricing' : 'Wholesale disabled for this cashier'}
          >
            Wholesale
          </button>
          <button
            type="button"
            onClick={() => setUnitType((u) => (u === 'base' ? 'pack' : 'base'))}
            className={`px-3 py-2 rounded-lg text-xs font-semibold touch-target whitespace-nowrap ${
              unitType === 'pack' ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {unitType === 'pack' ? 'By pack' : 'By unit'}
          </button>
        </div>
      </div>

      {/* Scan Feedback */}
      {scanFeedback && (
        <div
          className={`px-4 py-2.5 text-sm font-medium text-center animate-fade-in flex items-center justify-center gap-2 flex-shrink-0 ${
            scanFeedback.type === 'success'
              ? 'bg-green-100 text-green-800'
              : scanFeedback.type === 'warning'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {scanFeedback.type === 'warning' && <AlertCircle className="w-4 h-4" />}
          {scanFeedback.message}
        </div>
      )}

      {/* Stock Error Toast */}
      {stockError && (
        <div className="px-4 py-2.5 bg-amber-100 text-amber-800 text-sm font-medium text-center animate-fade-in flex items-center justify-center gap-2 flex-shrink-0">
          <AlertCircle className="w-4 h-4" />
          {stockError}
        </div>
      )}

      {/* Optional camera scanner */}
      {showCameraScanner && (
        <div className="px-3 md:px-4 pt-3 flex-shrink-0">
          <BarcodeScanner onScan={handleScan} active={scannerActive && !showCheckout} />
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Products pane */}
        <section
          className={`${
            posTab === 'products' ? 'flex' : 'hidden'
          } md:flex flex-col flex-1 min-w-0 min-h-0 md:border-r md:border-emerald-100`}
        >
          <div className="px-3 md:px-4 pt-3 flex-shrink-0 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products or barcode..."
                data-allow-typing="true"
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-emerald-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap touch-target ${
                    selectedCategory === cat
                      ? 'bg-primary text-white'
                      : 'bg-white text-gray-600 border border-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 px-0.5">
              {loadingProducts
                ? 'Loading products…'
                : `${filteredProducts.length} product${filteredProducts.length === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className={`flex-1 overflow-y-auto px-3 md:px-4 pt-2 no-scrollbar ${cart.items.length > 0 ? 'pb-28 md:pb-4' : 'pb-4'}`}>
            {loadingProducts ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Package className="w-10 h-10 mb-2 animate-pulse" />
                <p className="text-sm">Loading store inventory…</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Package className="w-12 h-12 mb-3" />
                <p className="text-sm font-medium">No products found</p>
                <p className="text-xs mt-1 text-center px-6">
                  {products.length === 0
                    ? 'Add products in Inventory (owner) to sell from POS.'
                    : 'Try a different search or category.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 md:grid md:grid-cols-1 xl:grid-cols-2 md:gap-2 md:space-y-0">
                {filteredProducts.map((product) => {
                  // Location batches only — never fall back to store-wide catalog stock
                  const stockHere = locationStock[product.id] ?? 0;
                  const stockAll = Number(product.stock_level) || 0;
                  const outOfStock = stockHere <= 0;
                  const packSize = Math.max(1, Number(product.pack_size) || 1);
                  const modes = getAvailableSaleModes(product);
                  const wholesaleOk = saleMode === 'wholesale' && modes.includes('wholesale');
                  return (
                    <div
                      key={product.id}
                      className={`bg-white rounded-xl border border-emerald-50 px-3 py-2.5 shadow-sm flex items-center gap-3 ${
                        outOfStock ? 'opacity-55' : ''
                      }`}
                    >
                      <ProductImage src={product.image_url} alt={product.name} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                        <p className="text-sm font-semibold text-primary mt-0.5">
                          GHS {product.selling_price.toFixed(2)}
                          {packSize > 1 ? <span className="text-[10px] text-gray-400 font-medium"> / unit</span> : null}
                        </p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          Here: {stockHere}
                          {stockAll !== stockHere ? ` · All locations: ${stockAll}` : ''}
                          {product.track_expiry === 1 ? ' · Expiry tracked' : ''}
                          {wholesaleOk ? ' · Wholesale ready' : ''}
                        </p>
                        {outOfStock && (
                          <p className="text-[10px] font-semibold text-red-600 mt-0.5">
                            {stockAll > 0 ? 'None at this location' : 'Out of stock'}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleAddProduct(product)}
                        disabled={outOfStock}
                        className="flex-shrink-0 px-3 py-2 rounded-lg border border-primary/30 bg-emerald-50 text-primary text-xs font-semibold touch-target disabled:opacity-40 disabled:cursor-not-allowed active:bg-emerald-100"
                      >
                        Add to cart
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Cart pane */}
        <section
          className={`${
            posTab === 'cart' ? 'flex' : 'hidden'
          } md:flex flex-col w-full md:w-[380px] lg:w-[420px] flex-shrink-0 min-h-0 bg-[var(--color-surface)] md:bg-white`}
        >
          <div className="hidden md:flex items-center justify-between px-4 py-3 border-b border-emerald-100 flex-shrink-0">
            <h3 className="text-sm font-bold text-gray-800">
              Cart{cartCount > 0 ? ` (${cartCount})` : ''}
            </h3>
            {cart.items.length > 0 && (
              <button
                type="button"
                onClick={() => cart.clearCart()}
                className="text-xs text-red-500 font-medium touch-target px-2 py-1"
              >
                Clear All
              </button>
            )}
          </div>

          <div className={`flex-1 overflow-y-auto px-3 md:px-4 pt-3 no-scrollbar ${cart.items.length > 0 ? 'pb-28 md:pb-4' : 'pb-4'}`}>
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <ShoppingCart className="w-12 h-12 mb-3" />
                <p className="text-sm font-medium">Cart is empty</p>
                <p className="text-xs mt-1 text-center">Browse products or scan a barcode to begin</p>
                <button
                  type="button"
                  onClick={() => setPosTab('products')}
                  className="mt-4 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold touch-target md:hidden"
                >
                  Browse products
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2 md:hidden">
                  <h3 className="text-sm font-bold text-gray-700">
                    Cart ({cart.items.length} item{cart.items.length !== 1 ? 's' : ''})
                  </h3>
                  <button
                    type="button"
                    onClick={() => cart.clearCart()}
                    className="text-xs text-red-500 font-medium touch-target px-2 py-1"
                  >
                    Clear All
                  </button>
                </div>

                {cart.items.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white md:bg-[var(--color-surface)] rounded-xl p-3 shadow-sm border border-emerald-50"
                  >
                    <div className="flex items-center gap-3">
                      <ProductImage src={item.image_url} alt={item.name} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <p className="text-xs text-gray-500">
                            GH₵{item.unit_price.toFixed(2)} / {item.unit_type === 'pack' ? 'pack' : 'unit'}
                          </p>
                          {item.sale_mode === 'wholesale' && (
                            <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">
                              Wholesale
                            </span>
                          )}
                          {item.base_quantity >= item.available_stock && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              Max stock
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => cart.decrementItem(item.id)}
                        disabled={item.quantity <= 1}
                        className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center touch-target disabled:opacity-40"
                      >
                        <Minus className="w-3.5 h-3.5 text-gray-600" />
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => void handleUpdateQuantity(item.id, parseInt(e.target.value) || 1)}
                        className="w-10 text-sm font-bold text-center bg-transparent border-b border-gray-200 focus:border-primary outline-none"
                        min="1"
                      />
                      <button
                        type="button"
                        onClick={() => void handleIncrement(item.id)}
                        className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center touch-target disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5 text-primary" />
                      </button>
                      </div>

                      <div className="text-right min-w-[70px]">
                        <p className="text-sm font-bold text-gray-900">GH₵{item.subtotal.toFixed(2)}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => cart.removeItem(item.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 touch-target"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desktop checkout docked in cart column */}
          {cart.items.length > 0 && (
            <div className="hidden md:block flex-shrink-0 border-t border-emerald-100 p-4 bg-white">
              <button
                type="button"
                onClick={() => {
                  setScannerActive(false);
                  setShowCheckout(true);
                }}
                className="w-full bg-primary text-white py-3.5 rounded-2xl flex items-center justify-between px-5 shadow-md active:bg-primary-dark transition touch-target"
              >
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" />
                  <span className="font-bold text-base">Checkout</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">GH₵{cart.total.toFixed(2)}</span>
                  <ChevronRight className="w-5 h-5" />
                </div>
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Mobile checkout bar — sits above bottom nav */}
      {cart.items.length > 0 && (
        <div className="md:hidden absolute bottom-0 left-0 right-0 px-4 pb-3 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)] to-transparent pt-4 z-30 pointer-events-none">
          <button
            type="button"
            onClick={() => {
              setScannerActive(false);
              setShowCheckout(true);
            }}
            className="pointer-events-auto w-full bg-primary text-white py-4 rounded-2xl flex items-center justify-between px-5 shadow-lg active:bg-primary-dark transition touch-target"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              <span className="font-bold text-lg">Checkout</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">GH₵{cart.total.toFixed(2)}</span>
              <ChevronRight className="w-5 h-5" />
            </div>
          </button>
        </div>
      )}

      {/* Checkout Overlay */}
      <CheckoutOverlay
        isOpen={showCheckout}
        onClose={() => {
          setShowCheckout(false);
          setScannerActive(true);
        }}
        onComplete={handleCheckoutComplete}
      />
    </div>
  );
}
