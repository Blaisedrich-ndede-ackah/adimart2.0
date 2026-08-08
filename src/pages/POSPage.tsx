import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart, Minus, Plus, Trash2, Search, ChevronRight, Package, AlertCircle, Bluetooth
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

export default function POSPage() {
  const cart = useCartStore();
  const { currentUser } = useAuthStore();
  const [scannerActive, setScannerActive] = useState(true);
  const [showCheckout, setShowCheckout] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocalProduct[]>([]);
  const [stockError, setStockError] = useState<string | null>(null);
  const [btStatus, setBtStatus] = useState(getBluetoothHardwareStatus());

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

  const handleScan = useCallback(async (barcode: string) => {
    const result = await cart.addItemByBarcode(barcode);
    
    if (result.success && result.product) {
      setScanFeedback({ type: 'success', message: `Added: ${result.product.name}` });
      playScanBeep('success');
    } else if (result.error) {
      if (result.error.includes('out of stock') || result.error.includes('available')) {
        setScanFeedback({ type: 'warning', message: result.error });
        playScanBeep('warning');
      } else {
        setScanFeedback({ type: 'error', message: result.error });
        playScanBeep('error');
      }
    }
    
    setTimeout(() => setScanFeedback(null), 3000);
  }, [cart]);

  // Handheld Bluetooth / HID scanner → cart during checkout
  useBluetoothBarcodeInput(handleScan, scannerActive && !showCheckout);

  useEffect(() => {
    if (searchQuery.length >= 1) {
      getCurrentStoreActiveProducts()
        .then((all: LocalProduct[]) => {
          const q = searchQuery.toLowerCase();
          const filtered = all.filter((p: LocalProduct) =>
            p.name.toLowerCase().includes(q) ||
            p.barcode.includes(q) ||
            p.category.toLowerCase().includes(q)
          );
          setSearchResults(filtered.slice(0, 20));
        });
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const handleAddFromSearch = (product: LocalProduct) => {
    const result = cart.addItem(product);
    
    if (result.success) {
      setScanFeedback({ type: 'success', message: `Added: ${product.name}` });
      playScanBeep('success');
      setShowProductSearch(false);
      setSearchQuery('');
    } else if (result.error) {
      setStockError(result.error);
      playScanBeep('error');
      setTimeout(() => setStockError(null), 3000);
    }
    
    setTimeout(() => setScanFeedback(null), 2000);
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
  };

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
            onClick={() => setShowProductSearch(!showProductSearch)}
            className="bg-white/20 p-2.5 rounded-xl touch-target"
          >
            <Search className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* Scan Feedback */}
      {scanFeedback && (
        <div
          className={`px-4 py-2.5 text-sm font-medium text-center animate-fade-in flex items-center justify-center gap-2 ${
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
        <div className="px-4 py-2.5 bg-amber-100 text-amber-800 text-sm font-medium text-center animate-fade-in flex items-center justify-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {stockError}
        </div>
      )}

      {/* Product Search */}
      {showProductSearch && (
        <div className="bg-white border-b border-gray-200 p-3 animate-fade-in">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search product name or barcode..."
            data-allow-typing="true"
            className="w-full px-4 py-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200">
              {searchResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleAddFromSearch(p)}
                  disabled={p.stock_level <= 0}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0 touch-target ${
                    p.stock_level <= 0 
                      ? 'bg-gray-50 opacity-60 cursor-not-allowed' 
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <ProductImage src={p.image_url} alt={p.name} size="sm" />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    <p className="text-xs text-gray-500">
                      {p.category} • 
                      {p.stock_level <= 0 ? (
                        <span className="text-red-500 font-medium"> Out of Stock</span>
                      ) : p.stock_level < 5 ? (
                        <span className="text-amber-500 font-medium"> Low: {p.stock_level} left</span>
                      ) : (
                        <span> Stock: {p.stock_level}</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-sm font-bold text-primary">GH₵{p.selling_price.toFixed(2)}</span>
                    {p.stock_level <= 0 && (
                      <p className="text-[10px] text-red-500">Unavailable</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scanner Area - Upper portion */}
      <div className="px-3 pt-3 flex-shrink-0">
        <BarcodeScanner onScan={handleScan} active={scannerActive && !showCheckout} />
      </div>

      {/* Cart List - Lower portion */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-40 no-scrollbar">
        {cart.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Package className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">Cart is empty</p>
            <p className="text-xs mt-1">Scan a product to begin</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-700">
                Cart ({cart.items.length} item{cart.items.length !== 1 ? 's' : ''})
              </h3>
              <button
                onClick={() => cart.clearCart()}
                className="text-xs text-red-500 font-medium touch-target px-2 py-1"
              >
                Clear All
              </button>
            </div>

            {cart.items.map(item => (
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
                      onClick={() => cart.decrementItem(item.id)}
                      disabled={item.quantity <= 1}
                      className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center touch-target disabled:opacity-40"
                    >
                      <Minus className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={e => handleUpdateQuantity(item.id, parseInt(e.target.value) || 1)}
                      className="w-10 text-sm font-bold text-center bg-transparent border-b border-gray-200 focus:border-primary outline-none"
                      min="1"
                      max={item.available_stock}
                    />
                    <button
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

      {/* Checkout Bar */}
      {cart.items.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 px-4 pb-3 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent pt-4 z-30">
          <button
            onClick={() => { setScannerActive(false); setShowCheckout(true); }}
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
        onClose={() => { setShowCheckout(false); setScannerActive(true); }}
        onComplete={handleCheckoutComplete}
      />
    </div>
  );
}
