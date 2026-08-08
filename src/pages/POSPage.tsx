import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingCart, Minus, Plus, Trash2, Search, ChevronRight, Package, AlertCircle, Bluetooth,
  ScanBarcode
} from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import CheckoutOverlay from '@/components/CheckoutOverlay';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';
import { LocalProduct, getCurrentStoreActiveProducts } from '@/lib/dexie';
import { playScanBeep, primeScanBeep } from '@/lib/scanBeep';
import { useBluetoothBarcodeInput } from '@/hooks/useBluetoothBarcodeInput';
import { getBluetoothHardwareStatus, subscribeBluetoothStatus } from '@/lib/bluetoothPeripherals';
import ProductImage from '@/components/ProductImage';

type PosTab = 'products' | 'cart';

export default function POSPage() {
  const cart = useCartStore();
  const { currentUser } = useAuthStore();
  const [posTab, setPosTab] = useState<PosTab>('products');
  const [scannerActive, setScannerActive] = useState(true);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [stockError, setStockError] = useState<string | null>(null);
  const [btStatus, setBtStatus] = useState(getBluetoothHardwareStatus());

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const list = await getCurrentStoreActiveProducts();
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(list);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    // Refresh catalog when returning to the Products tab (e.g. after inventory edits)
    if (posTab === 'products') {
      void loadProducts();
    }
  }, [posTab, loadProducts]);

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

  const handleAddProduct = (product: LocalProduct) => {
    const result = cart.addItem(product);

    if (result.success) {
      flashFeedback({ type: 'success', message: `Added: ${product.name}` }, 2000);
      playScanBeep('success');
    } else if (result.error) {
      setStockError(result.error);
      playScanBeep('error');
      setTimeout(() => setStockError(null), 3000);
    }
  };

  const handleIncrement = (itemId: string) => {
    const result = cart.incrementItem(itemId);
    if (!result.success && result.error) {
      setStockError(result.error);
      setTimeout(() => setStockError(null), 3000);
    }
  };

  const handleUpdateQuantity = (itemId: string, newQty: number) => {
    const result = cart.updateQuantity(itemId, newQty);
    if (!result.success && result.error) {
      setStockError(result.error);
      setTimeout(() => setStockError(null), 3000);
    }
  };

  const handleCheckoutComplete = (_receipt: string) => {
    setShowCheckout(false);
    setScannerActive(true);
    setPosTab('products');
    void loadProducts();
  };

  const cartCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-primary px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-white font-bold text-lg">POS</h1>
          <p className="text-emerald-200 text-xs">Hi, {currentUser?.name}</p>
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

      {/* Products / Cart tabs */}
      <div className="bg-white border-b border-gray-200 px-3 py-2 flex gap-2 flex-shrink-0">
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
        <div className="px-3 pt-3 flex-shrink-0">
          <BarcodeScanner onScan={handleScan} active={scannerActive && !showCheckout} />
        </div>
      )}

      {posTab === 'products' && (
        <>
          <div className="px-3 pt-3 flex-shrink-0 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products or barcode..."
                data-allow-typing="true"
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
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
                : `${filteredProducts.length} product${filteredProducts.length === 1 ? '' : 's'} · tap to add to cart`}
            </p>
          </div>

          <div className={`flex-1 overflow-y-auto px-3 pt-2 no-scrollbar ${cart.items.length > 0 ? 'pb-28' : 'pb-20'}`}>
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
              <div className="grid grid-cols-2 gap-2">
                {filteredProducts.map((product) => {
                  const outOfStock = product.stock_level <= 0;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleAddProduct(product)}
                      disabled={outOfStock}
                      className={`text-left bg-white rounded-xl border p-2.5 shadow-sm touch-target transition active:scale-[0.98] ${
                        outOfStock
                          ? 'border-gray-100 opacity-55 cursor-not-allowed'
                          : 'border-gray-100 hover:border-primary/40'
                      }`}
                    >
                      <div className="w-full h-24 rounded-lg overflow-hidden mb-2 bg-gray-50 flex items-center justify-center">
                        <ProductImage
                          src={product.image_url}
                          alt={product.name}
                          size="lg"
                          className="w-full h-full max-w-none rounded-none"
                        />
                      </div>
                      <p className="text-xs font-semibold text-gray-900 line-clamp-2 min-h-[2rem]">{product.name}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5 truncate">{product.category}</p>
                      <div className="flex items-center justify-between mt-1.5 gap-1">
                        <span className="text-sm font-bold text-primary">GH₵{product.selling_price.toFixed(2)}</span>
                        {outOfStock ? (
                          <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">OUT</span>
                        ) : product.stock_level < 5 ? (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                            {product.stock_level}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-500">{product.stock_level}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {posTab === 'cart' && (
        <div className={`flex-1 overflow-y-auto px-3 pt-3 no-scrollbar ${cart.items.length > 0 ? 'pb-28' : 'pb-20'}`}>
          {cart.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ShoppingCart className="w-12 h-12 mb-3" />
              <p className="text-sm font-medium">Cart is empty</p>
              <p className="text-xs mt-1">Browse products or scan a barcode to begin</p>
              <button
                type="button"
                onClick={() => setPosTab('products')}
                className="mt-4 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold touch-target"
              >
                Browse products
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
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
                  className="bg-white rounded-xl p-3 shadow-sm border border-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <ProductImage src={item.image_url} alt={item.name} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-gray-500">GH₵{item.unit_price.toFixed(2)} each</p>
                        {item.quantity >= item.available_stock && (
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
                        onChange={(e) => handleUpdateQuantity(item.id, parseInt(e.target.value) || 1)}
                        className="w-10 text-sm font-bold text-center bg-transparent border-b border-gray-200 focus:border-primary outline-none"
                        min="1"
                        max={item.available_stock}
                      />
                      <button
                        type="button"
                        onClick={() => handleIncrement(item.id)}
                        disabled={item.quantity >= item.available_stock}
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
      )}

      {/* Checkout Bar */}
      {cart.items.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 px-4 pb-3 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pt-4 z-30">
          <button
            type="button"
            onClick={() => {
              setScannerActive(false);
              setShowCheckout(true);
            }}
            className="w-full bg-primary text-white py-4 rounded-2xl flex items-center justify-between px-5 shadow-lg active:bg-primary-dark transition touch-target"
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
