import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Camera, Save, AlertTriangle, StopCircle } from 'lucide-react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import { db, generateId, LocalProduct, getCurrentStoreId } from '@/lib/dexie';

interface AddProductProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editProduct?: LocalProduct | null;
}

const CATEGORIES = ['Food', 'Beverages', 'Dairy', 'Household', 'Electronics', 'Clothing', 'Health', 'Other'];

export default function AddProduct({ isOpen, onClose, onSaved, editProduct }: AddProductProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Food');
  const [barcode, setBarcode] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [stockLevel, setStockLevel] = useState('');
  const [skuType, setSkuType] = useState('unit');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  useEffect(() => {
    if (isOpen) {
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
        setBarcode('');
        setCostPrice('');
        setSellingPrice('');
        setStockLevel('');
        setSkuType('unit');
      }
      setError('');
      setShowBarcodeScanner(false);
    }
  }, [isOpen, editProduct]);

  const profitMargin = (() => {
    const cost = parseFloat(costPrice);
    const sell = parseFloat(sellingPrice);
    if (isNaN(cost) || isNaN(sell) || cost <= 0) return null;
    return ((sell - cost) / cost * 100).toFixed(1);
  })();

  const startBarcodeScanner = useCallback(async () => {
    setShowBarcodeScanner(true);
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
            setBarcode(result.getText());
            stopBarcodeScanner();
          }
          if (err && !(err instanceof NotFoundException)) {
            console.debug('Scan error:', err);
          }
        }
      );
      
      setScannerReady(true);
    } catch (err) {
      console.error('Camera error:', err);
      setShowBarcodeScanner(false);
    }
  }, []);

  const stopBarcodeScanner = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }
    setShowBarcodeScanner(false);
    setScannerReady(false);
  }, []);

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
    stopBarcodeScanner();
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
                <option value="kg">Kilogram</option>
                <option value="liter">Liter</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Barcode</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
                placeholder="Scan or enter manually"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary outline-none"
              />
              <button
                onClick={showBarcodeScanner ? stopBarcodeScanner : startBarcodeScanner}
                className={`px-4 py-3 rounded-xl touch-target ${
                  showBarcodeScanner 
                    ? 'bg-red-500 text-white' 
                    : 'bg-primary text-white'
                }`}
              >
                {showBarcodeScanner ? <StopCircle className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {showBarcodeScanner && (
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
                {scannerReady ? 'Point at barcode' : 'Starting camera...'}
              </div>
            </div>
          )}

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
