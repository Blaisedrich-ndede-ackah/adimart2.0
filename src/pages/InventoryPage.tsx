import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Package, AlertTriangle, TrendingDown, DollarSign, Coins,
  Plus, Search, ArrowUpDown, Edit, Trash2, ToggleLeft, ToggleRight,
  PackagePlus, RefreshCw, Upload, Barcode, Bluetooth
} from 'lucide-react';
import {
  db,
  deleteProductCompletely,
  LocalProduct,
  getCurrentStoreProducts,
  syncBidirectional,
} from '@/lib/dexie';
import { isSupabaseConfigured } from '@/lib/supabase';
import { alignProductsWithBatchStock } from '@/lib/warehouse';
import AddProduct from '@/components/AddProduct';
import StockAdjustment from '@/components/StockAdjustment';
import CsvImportModal from '@/components/CsvImportModal';
import { downloadBarcodeLabel, printBarcodeLabel } from '@/lib/barcodeLabels';
import { useAuthStore } from '@/store/useAuthStore';
import { useBluetoothBarcodeInput } from '@/hooks/useBluetoothBarcodeInput';
import { playScanBeep } from '@/lib/scanBeep';
import ProductImage from '@/components/ProductImage';

type SortMode = 'recent' | 'alpha' | 'stock-low' | 'stock-high';

export default function InventoryPage() {
  const { currentStore } = useAuthStore();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<LocalProduct[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editProduct, setEditProduct] = useState<LocalProduct | null>(null);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [stockAdjustProduct, setStockAdjustProduct] = useState<LocalProduct | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [labelStatus, setLabelStatus] = useState('');
  const [scanFeedback, setScanFeedback] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [scannedBarcodeForAdd, setScannedBarcodeForAdd] = useState<string | null>(null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const lastSyncAtRef = useRef(0);

  const loadProducts = useCallback(async (opts?: { sync?: boolean }) => {
    const shouldSync = Boolean(opts?.sync);
    if (shouldSync && isSupabaseConfigured() && navigator.onLine) {
      const now = Date.now();
      // Avoid hammering cloud when switching tabs quickly
      if (now - lastSyncAtRef.current > 12_000) {
        try {
          setSyncStatus('Syncing inventory…');
          await syncBidirectional();
          lastSyncAtRef.current = Date.now();
          setSyncStatus('Inventory synced');
        } catch {
          setSyncStatus('Showing local inventory (sync failed)');
        }
        window.setTimeout(() => setSyncStatus(''), 2500);
      }
    }

    const allProducts = await getCurrentStoreProducts();
    // Sales deduct warehouse batches — keep catalog stock_level aligned so phone & PC match
    const aligned = await alignProductsWithBatchStock(allProducts);
    setProducts(aligned);
    const cats = [...new Set(aligned.map((p) => p.category))].sort();
    setCategories(['All', ...cats]);
  }, []);

  const handleInventoryScan = useCallback(async (barcode: string) => {
    // While adding/editing a product, let AddProduct own the barcode field
    if (showAddProduct || showCsvImport) return;

    const all = await getCurrentStoreProducts();
    const match = all.find((p) => p.barcode === barcode || p.barcode === barcode.trim());

    if (match) {
      setSearchQuery(barcode);
      setSelectedCategory('All');
      setHighlightedProductId(match.id);
      setStockAdjustProduct(match);
      setScanFeedback(`Found: ${match.name} — adjust stock`);
      playScanBeep('success');
    } else {
      setScannedBarcodeForAdd(barcode);
      setEditProduct(null);
      setShowAddProduct(true);
      setScanFeedback(`Unknown barcode ${barcode} — add product`);
      playScanBeep('warning');
    }
    setTimeout(() => {
      setScanFeedback('');
      setHighlightedProductId(null);
    }, 4000);
  }, [showAddProduct, showCsvImport]);

  useBluetoothBarcodeInput(
    handleInventoryScan,
    !showAddProduct && !showCsvImport && !stockAdjustProduct
  );

  useEffect(() => {
    void loadProducts({ sync: true });
  }, [loadProducts]);

  // When returning to this tab/device, pull latest cloud stock
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadProducts({ sync: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadProducts]);

  // Local refresh between syncs (sales on this device)
  useEffect(() => {
    const interval = setInterval(() => {
      void loadProducts({ sync: false });
    }, 30000);
    return () => clearInterval(interval);
  }, [loadProducts]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadProducts({ sync: true });
    setIsRefreshing(false);
  };

  useEffect(() => {
    let result = [...products];

    if (selectedCategory !== 'All') {
      result = result.filter(p => p.category === selectedCategory);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
      );
    }

    switch (sortMode) {
      case 'recent':
        result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        break;
      case 'alpha':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'stock-low':
        result.sort((a, b) => a.stock_level - b.stock_level);
        break;
      case 'stock-high':
        result.sort((a, b) => b.stock_level - a.stock_level);
        break;
    }

    setFilteredProducts(result);
  }, [products, selectedCategory, searchQuery, sortMode]);

  const activeProducts = products.filter((p) => p.is_active === 1);
  const totalSKUs = activeProducts.length;
  const outOfStock = activeProducts.filter((p) => p.stock_level === 0).length;
  const lowStock = activeProducts.filter((p) => p.stock_level > 0 && p.stock_level < 5).length;
  const totalValue = activeProducts.reduce(
    (sum, p) => sum + p.stock_level * p.selling_price,
    0
  );
  const totalCostOfProduct = activeProducts.reduce(
    (sum, p) => sum + p.stock_level * p.cost_price,
    0
  );

  const handleDelete = async (id: string) => {
    if (
      confirm(
        'Delete this product permanently? It will be removed from inventory, warehouse stock, and the cloud catalog. Past sales keep the product name on the receipt.'
      )
    ) {
      await deleteProductCompletely(id);
      await loadProducts();
    }
  };

  const handleToggleActive = async (product: LocalProduct) => {
    await db.products.update(product.id, {
      is_active: product.is_active === 1 ? 0 : 1,
      updated_at: new Date().toISOString(),
      synced: 0,
    });
    loadProducts();
  };

  const handlePrintLabel = async (product: LocalProduct) => {
    setLabelStatus('');
    try {
      await printBarcodeLabel(product, currentStore?.name || 'Store');
      setLabelStatus(`Printed label for ${product.name}`);
    } catch {
      downloadBarcodeLabel(product, currentStore?.name || 'Store');
      setLabelStatus(`Downloaded label PDF for ${product.name}`);
    }
    setTimeout(() => setLabelStatus(''), 3000);
  };

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-white font-bold text-lg">Inventory</h1>
            <p className="text-emerald-200 text-[10px] flex items-center gap-1 mt-0.5">
              <Bluetooth className="w-3 h-3" />
              Scan to add products or adjust stock
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="bg-white/20 p-2 rounded-xl touch-target"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 text-white ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowCsvImport(true)}
              className="bg-white/20 p-2 rounded-xl touch-target"
              title="Import CSV"
            >
              <Upload className="w-4 h-4 text-white" />
            </button>
            <button
              onClick={() => { setEditProduct(null); setScannedBarcodeForAdd(null); setShowAddProduct(true); }}
              className="bg-white/20 p-2 rounded-xl touch-target flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-white" />
              <span className="text-white text-xs font-medium">Add</span>
            </button>
          </div>
        </div>
        {scanFeedback && (
          <p className="text-emerald-100 text-xs text-center mb-2 animate-fade-in">{scanFeedback}</p>
        )}
        {syncStatus && (
          <p className="text-emerald-100/90 text-[11px] text-center mb-2">{syncStatus}</p>
        )}

        {/* Dashboard Cards — same metrics on phone & desktop */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5 sm:grid sm:grid-cols-5 sm:overflow-visible sm:pb-0">
          <div className="bg-white/15 rounded-xl p-2 sm:p-2.5 text-center min-w-[4.75rem] flex-shrink-0 sm:min-w-0">
            <Package className="w-4 h-4 text-white mx-auto mb-1" />
            <p className="text-white font-bold text-lg leading-none">{totalSKUs}</p>
            <p className="text-emerald-200 text-[9px] mt-0.5">Total SKUs</p>
          </div>
          <button 
            onClick={() => { setSelectedCategory('All'); setSortMode('stock-low'); }}
            className="bg-white/15 rounded-xl p-2 sm:p-2.5 text-center hover:bg-white/25 transition min-w-[4.75rem] flex-shrink-0 sm:min-w-0"
          >
            <AlertTriangle className="w-4 h-4 text-red-300 mx-auto mb-1" />
            <p className="text-white font-bold text-lg leading-none">{outOfStock}</p>
            <p className="text-emerald-200 text-[9px] mt-0.5">Out of Stock</p>
          </button>
          <button
            onClick={() => { setSelectedCategory('All'); setSortMode('stock-low'); }}
            className="bg-white/15 rounded-xl p-2 sm:p-2.5 text-center hover:bg-white/25 transition min-w-[4.75rem] flex-shrink-0 sm:min-w-0"
          >
            <TrendingDown className="w-4 h-4 text-yellow-300 mx-auto mb-1" />
            <p className="text-white font-bold text-lg leading-none">{lowStock}</p>
            <p className="text-emerald-200 text-[9px] mt-0.5">Low Stock</p>
          </button>
          <div className="bg-white/15 rounded-xl p-2 sm:p-2.5 text-center min-w-[4.75rem] flex-shrink-0 sm:min-w-0">
            <DollarSign className="w-4 h-4 text-green-300 mx-auto mb-1" />
            <p className="text-white font-bold text-sm leading-none">GH₵{totalValue.toFixed(0)}</p>
            <p className="text-emerald-200 text-[9px] mt-0.5">Value</p>
          </div>
          <div className="bg-white/15 rounded-xl p-2 sm:p-2.5 text-center min-w-[5.25rem] flex-shrink-0 sm:min-w-0">
            <Coins className="w-4 h-4 text-amber-200 mx-auto mb-1" />
            <p className="text-white font-bold text-sm leading-none">GH₵{totalCostOfProduct.toFixed(0)}</p>
            <p className="text-emerald-200 text-[8px] sm:text-[9px] mt-0.5 leading-tight">
              Total Cost of Product
            </p>
          </div>
        </div>
      </div>

      {/* Search & Sort */}
      <div className="px-3 pt-3 flex-shrink-0">
        {labelStatus && (
          <p className="text-xs text-primary mb-2 text-center">{labelStatus}</p>
        )}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search products or scan barcode..."
              data-allow-typing="true"
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className="p-2.5 bg-white border border-gray-200 rounded-xl touch-target"
            >
              <ArrowUpDown className="w-4 h-4 text-gray-600" />
            </button>
            {showSortDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-40 overflow-hidden">
                {([
                  { key: 'recent', label: 'Most Recent' },
                  { key: 'alpha', label: 'A-Z' },
                  { key: 'stock-low', label: 'Stock: Low' },
                  { key: 'stock-high', label: 'Stock: High' },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { setSortMode(opt.key); setShowSortDropdown(false); }}
                    className={`w-full text-left px-3 py-2.5 text-sm touch-target ${
                      sortMode === opt.key ? 'bg-primary text-white' : 'hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {categories.map(cat => (
            <button
              key={cat}
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
      </div>

      {/* Product List */}
      <div className="page-body no-scrollbar">
        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Package className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">No products found</p>
            <button
              onClick={() => { setEditProduct(null); setShowAddProduct(true); }}
              className="mt-4 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium"
            >
              Add First Product
            </button>
          </div>
        ) : (
          <div className="space-y-2 md:space-y-2.5">
            {filteredProducts.map(product => (
              <div
                key={product.id}
                className={`bg-white rounded-xl p-3 md:p-3.5 shadow-sm border ${
                  highlightedProductId === product.id
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-gray-100'
                } ${product.is_active === 0 ? 'opacity-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <ProductImage src={product.image_url} alt={product.name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900 truncate max-w-full">
                            {product.name}
                          </p>
                          {product.stock_level === 0 && product.is_active === 1 && (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-bold rounded">
                              OUT OF STOCK
                            </span>
                          )}
                          {product.stock_level > 0 && product.stock_level < 5 && product.is_active === 1 && (
                            <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-[9px] font-bold rounded">
                              LOW
                            </span>
                          )}
                          {product.is_active === 0 && (
                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold rounded">
                              INACTIVE
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {product.category} • {product.sku_type}
                        </p>
                        {product.barcode && (
                          <p className="text-[10px] text-gray-400 font-mono mt-0.5">{product.barcode}</p>
                        )}
                      </div>
                      <div className="flex sm:flex-col sm:text-right items-end justify-between sm:justify-start gap-3 sm:gap-0.5 shrink-0">
                        <div className="text-left sm:text-right">
                          <p className="text-sm font-bold text-primary">
                            GH₵{product.selling_price.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            Cost: GH₵{product.cost_price.toFixed(2)}
                          </p>
                        </div>
                        <p
                          className={`text-xs font-semibold ${
                            product.stock_level === 0
                              ? 'text-red-500'
                              : product.stock_level < 5
                                ? 'text-amber-500'
                                : 'text-gray-700'
                          }`}
                        >
                          Stock: {product.stock_level}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-gray-50">
                  <button
                    onClick={() => handlePrintLabel(product)}
                    className="p-1.5 rounded-lg hover:bg-emerald-50 touch-target"
                    title="Print Barcode Label"
                  >
                    <Barcode className="w-4 h-4 text-primary" />
                  </button>
                  <button
                    onClick={() => setStockAdjustProduct(product)}
                    className="p-1.5 rounded-lg hover:bg-blue-50 touch-target"
                    title="Adjust Stock"
                  >
                    <PackagePlus className="w-4 h-4 text-blue-500" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(product)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 touch-target"
                    title={product.is_active === 1 ? 'Deactivate' : 'Activate'}
                  >
                    {product.is_active === 1 ? (
                      <ToggleRight className="w-5 h-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-gray-400" />
                    )}
                  </button>
                  <button
                    onClick={() => { setEditProduct(product); setShowAddProduct(true); }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 touch-target"
                  >
                    <Edit className="w-4 h-4 text-blue-500" />
                  </button>
                  <button
                    onClick={() => handleDelete(product.id)}
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

      <AddProduct
        isOpen={showAddProduct}
        onClose={() => { setShowAddProduct(false); setEditProduct(null); setScannedBarcodeForAdd(null); }}
        onSaved={() => { setScannedBarcodeForAdd(null); void loadProducts({ sync: true }); }}
        editProduct={editProduct}
        initialBarcode={scannedBarcodeForAdd}
      />

      <StockAdjustment
        isOpen={stockAdjustProduct !== null}
        product={stockAdjustProduct}
        onClose={() => setStockAdjustProduct(null)}
        onSaved={() => void loadProducts({ sync: true })}
      />

      <CsvImportModal
        isOpen={showCsvImport}
        onClose={() => setShowCsvImport(false)}
        onImported={() => void loadProducts({ sync: true })}
      />
    </div>
  );
}
