import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Save, AlertTriangle, StopCircle, ScanBarcode, Bluetooth } from 'lucide-react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { db, generateId, LocalProduct, getCurrentStoreId } from '@/lib/dexie';
import { useBluetoothBarcodeInput } from '@/hooks/useBluetoothBarcodeInput';
import { playScanBeep } from '@/lib/scanBeep';
import { getBluetoothHardwareStatus } from '@/lib/bluetoothPeripherals';

interface AddProductProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editProduct?: LocalProduct | null;
  /** Prefill barcode from handheld scanner (inventory logging) */
  initialBarcode?: string | null;
}

const CATEGORIES = ['Food', 'Beverages', 'Dairy', 'Household', 'Electronics', 'Clothing', 'Health', 'Accessories', 'Other'];

export default function AddProduct({ isOpen, onClose, onSaved, editProduct, initialBarcode }: AddProductProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Food');
  const [barcode, setBarcode] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [stockLevel, setStockLevel] = useState('');
  const [skuType, setSkuType] = useState('unit');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [scanPulse, setScanPulse] = useState(false);
  const [hardwareHint, setHardwareHint] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const stopCameraScanner = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }
    setShowCameraScanner(false);
    setScannerReady(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const hw = getBluetoothHardwareStatus();
      if (hw.scannerConnected) {
        setHardwareHint(`BLE scanner ready: ${hw.scannerName}`);
      } else if (hw.hidScannerEnabled) {
        setHardwareHint('Point your handheld scanner at a barcode — no camera needed');
      } else {
        setHardwareHint('Enable HID Scanner Input in Settings → Bluetooth Hardware');
      }

      if (editProduct) {
        setName(editProduct.name);
        setCategory(editProduct.category);
        setBarcode(editProduct.barcode);
        setCostPrice(editProduct.cost_price.toString());
        setSellingPrice(editProduct.selling_price.toString());
        setStockLevel(editProduct.stock_level.toString());
        setSkuType(editProduct.sku_type);
      } else {
        setName('');
        setCategory('Food');
        setBarcode(initialBarcode?.trim() || '');
        setCostPrice('');
        setSellingPrice('');
        setStockLevel('');
        setSkuType('unit');
      }
      setError('');
      setScanPulse(Boolean(initialBarcode?.trim()));
      stopCameraScanner();

      // Focus barcode field so handheld HID scanners type/submit directly into inventory entry
      requestAnimationFrame(() => {
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
      });
    }
  }, [isOpen, editProduct, initialBarcode, stopCameraScanner]);

  const applyHandheldBarcode = useCallback((code: string) => {
    const cleaned = code.trim();
    if (!cleaned) return;
    setBarcode(cleaned);
    setScanPulse(true);
    playScanBeep('success');
    stopCameraScanner();
    // Keep focus on barcode so the next scan overwrites cleanly
    requestAnimationFrame(() => {
      barcodeInputRef.current?.focus();
      barcodeInputRef.current?.select();
    });
    setTimeout(() => setScanPulse(false), 1500);
  }, [stopCameraScanner]);

  // Handheld Bluetooth / HID scanner is the primary inventory barcode input
  useBluetoothBarcodeInput(applyHandheldBarcode, isOpen);

  const profitMargin = (() => {
    const cost = parseFloat(costPrice);
    const sell = parseFloat(sellingPrice);
    if (isNaN(cost) || isNaN(sell) || cost <= 0) return null;
    return ((sell - cost) / cost * 100).toFixed(1);
  })();

  const startCameraScanner = useCallback(async () => {
    setShowCameraScanner(true);
    setScannerReady(false);

    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const backCamera = videoDevices.find(d =>
        d.label.toLowerCase().includes('back') ||
        d.label.toLowerCase().includes('rear') ||
        d.label.toLowerCase().includes('environment')
      );
      const cameraId = backCamera?.deviceId || videoDevices[videoDevices.length - 1]?.deviceId || null;

      if (!videoRef.current) return;

      await reader.decodeFromVideoDevice(
        cameraId,
        videoRef.current,
        (result, err) => {
          if (result) {
            applyHandheldBarcode(result.getText());
          }
          if (err && !(err instanceof NotFoundException)) {
            console.debug('Scan error:', err);
          }
        }
      );

      setScannerReady(true);
    } catch (err) {
      console.error('Camera error:', err);
      setShowCameraScanner(false);
      setError('Camera unavailable. Use a handheld Bluetooth scanner or type the barcode.');
    }
  }, [applyHandheldBarcode]);

  useEffect(() => {
    return () => {
      if (readerRef.current) {
        readerRef.current.reset();
      }
    };
  }, []);

  const handleSave = async () => {
    setError('');

    if (!name.trim()) {
      setError('Product name is required');
      return;
    }
    if (!costPrice || parseFloat(costPrice) < 0) {
      setError('Enter a valid cost price');
      return;
    }
    if (!sellingPrice || parseFloat(sellingPrice) < 0) {
      setError('Enter a valid selling price');
      return;
    }
    if (!stockLevel || parseInt(stockLevel) < 0) {
      setError('Enter a valid stock level');
      return;
    }

    setSaving(true);

    try {
      const storeId = await getCurrentStoreId();
      if (!storeId) {
        throw new Error('No store selected');
      }

      const now = new Date().toISOString();

      if (editProduct) {
        await db.products.update(editProduct.id, {
          name: name.trim(),
          category,
          barcode: barcode.trim(),
          cost_price: parseFloat(costPrice),
          selling_price: parseFloat(sellingPrice),
          stock_level: parseInt(stockLevel),
          sku_type: skuType,
          updated_at: now,
          synced: 0,
        });
      } else {
        await db.products.add({
          id: generateId(),
          store_id: storeId,
          name: name.trim(),
          category,
          sku_type: skuType,
          barcode: barcode.trim(),
          cost_price: parseFloat(costPrice),
          selling_price: parseFloat(sellingPrice),
          stock_level: parseInt(stockLevel),
          is_active: 1,
          created_at: now,
          updated_at: now,
          synced: 0,
        });
      }

      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }

    setSaving(false);
  };

  const handleClose = () => {
    stopCameraScanner();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center animate-fade-in">
      <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[95vh] overflow-y-auto animate-slide-up" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-gray-900">
            {editProduct ? 'Edit Product' : 'Add New Product'}
          </h2>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-gray-100 touch-target">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Handheld scanner is primary for inventory barcode entry */}
          <div
            className={`rounded-xl border px-4 py-3 ${
              scanPulse
                ? 'border-primary bg-primary/5'
                : 'border-blue-100 bg-blue-50'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                scanPulse ? 'bg-primary text-white' : 'bg-blue-100 text-blue-700'
              }`}>
                {scanPulse ? <ScanBarcode className="w-4 h-4" /> : <Bluetooth className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {scanPulse ? 'Barcode captured' : 'Handheld scanner ready'}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {scanPulse
                    ? `Using ${barcode}`
                    : hardwareHint}
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Barcode</label>
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              placeholder="Scan with handheld scanner or type barcode"
              data-barcode-input="true"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={`w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none font-mono ${
                scanPulse ? 'border-primary bg-primary/5' : 'border-gray-300'
              }`}
            />
            <div className="flex items-center justify-between mt-2 gap-2">
              <p className="text-[11px] text-gray-500">
                Scan first, then fill name, prices, and stock.
              </p>
              <button
                type="button"
                onClick={showCameraScanner ? stopCameraScanner : startCameraScanner}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium touch-target ${
                  showCameraScanner
                    ? 'bg-red-50 text-red-600'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {showCameraScanner ? <StopCircle className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                {showCameraScanner ? 'Stop camera' : 'Use camera'}
              </button>
            </div>
          </div>

          {showCameraScanner && (
            <div className="bg-black rounded-xl overflow-hidden relative animate-fade-in">
              <video
                ref={videoRef}
                className="w-full h-36 object-cover"
                playsInline
                muted
                autoPlay
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-20 border-2 border-accent rounded-lg relative">
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-accent rounded-tl" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-accent rounded-tr" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-accent rounded-bl" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-accent rounded-br" />
                  {scannerReady && (
                    <div className="absolute inset-x-2 top-1/2 h-0.5 bg-red-500 animate-pulse" />
                  )}
                </div>
              </div>
              <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white">
                {scannerReady ? 'Point camera at barcode' : 'Starting camera...'}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Product Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Coca-Cola 500ml"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Unit Type</label>
              <select
                value={skuType}
                onChange={e => setSkuType(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none bg-white"
              >
                <option value="unit">Unit</option>
                <option value="bag">Bag</option>
                <option value="box">Box</option>
                <option value="pack">Pack</option>
                <option value="peaces">Peaces</option>
                <option value="kg">Kilogram</option>
                <option value="liter">Liter</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Cost Price (GH₵) *</label>
              <input
                type="number"
                value={costPrice}
                onChange={e => setCostPrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Selling Price (GH₵) *</label>
              <input
                type="number"
                value={sellingPrice}
                onChange={e => setSellingPrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          {profitMargin !== null && (
            <div className={`text-sm px-4 py-2.5 rounded-xl font-medium ${
              parseFloat(profitMargin) >= 0
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              Profit Margin: {profitMargin}%
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Stock Level *</label>
            <input
              type="number"
              value={stockLevel}
              onChange={e => setStockLevel(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-4 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50 mt-2"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : editProduct ? 'Update Product' : 'Add Product'}
          </button>
        </div>
      </div>
    </div>
  );
}
