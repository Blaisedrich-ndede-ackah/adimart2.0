import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Package, AlertTriangle, TrendingDown, DollarSign, Coins,
  Plus, Search, ArrowUpDown, Edit, Trash2, ToggleLeft, ToggleRight, Tags,
  PackagePlus, RefreshCw, Upload, Barcode, Bluetooth, Download
} from 'lucide-react';
import {
  db,
  deleteProductCompletely,
  LocalProduct,
  getCurrentStoreProducts,
  getCurrentStoreProductCategories,
  syncBidirectional,
  syncStockFast,
} from '@/lib/dexie';
import { isSupabaseConfigured } from '@/lib/supabase';
import { alignProductsWithBatchStock, toMoney, toQty } from '@/lib/warehouse';
import { scoreSmartSearch } from '@/lib/adimatAi/search';
import { subscribeStockChanges } from '@/lib/stockEvents';
import AddProduct from '@/components/AddProduct';
import StockAdjustment from '@/components/StockAdjustment';
import CsvImportModal from '@/components/CsvImportModal';
import { downloadBarcodeLabel, printBarcodeLabel } from '@/lib/barcodeLabels';
import { useAuthStore } from '@/store/useAuthStore';
import { cashierCanSeeStockQuantity } from '@/lib/staffAccess';
import { useFormatMoney } from '@/lib/currency';
import { useBluetoothBarcodeInput } from '@/hooks/useBluetoothBarcodeInput';
import { playScanBeep } from '@/lib/scanBeep';
import ProductImage from '@/components/ProductImage';
import InventoryInsights from '@/components/InventoryInsights';
import ManageProductCategoriesModal from '@/components/ManageProductCategoriesModal';
import { downloadInventoryCsv, downloadInventoryPdf } from '@/lib/inventoryExport';

type SortMode = 'recent' | 'alpha' | 'stock-low' | 'stock-high';

export default function InventoryPage({
  openAddOnLoad = false,
  onQuickActionHandled,
}: {
  openAddOnLoad?: boolean;
  onQuickActionHandled?: () => void;
}) {
  const { currentStore, currentUser } = useAuthStore();
  const showStockQty = cashierCanSeeStockQuantity(currentUser, currentStore);
  const money = useFormatMoney();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [inventoryLoadError, setInventoryLoadError] = useState('');
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
  const [showInsights, setShowInsights] = useState(false);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const lastSyncAtRef = useRef(0);

  useEffect(() => {
    if (!openAddOnLoad) return;
    setEditProduct(null);
    setScannedBarcodeForAdd(null);
    setShowAddProduct(true);
    onQuickActionHandled?.();
  }, [openAddOnLoad, onQuickActionHandled]);

  const loadProducts = useCallback(async (opts?: { sync?: boolean }) => {
    const shouldSync = Boolean(opts?.sync);

    const paintLocal = async () => {
      const allProducts = await getCurrentStoreProducts();
      const aligned = await alignProductsWithBatchStock(allProducts);
      const productCategories = await getCurrentStoreProductCategories();
      setProducts(aligned);
      setProductsLoaded(true);
      setInventoryLoadError('');
      setCategories(['All', ...productCategories.map((category) => category.name)]);
    };

    try {
      await paintLocal();

      if (shouldSync && isSupabaseConfigured()) {
        try {
          setSyncStatus('Updating from cloud…');
          const result = await syncStockFast();
          lastSyncAtRef.current = Date.now();
          if (result.success) {
            setSyncStatus('Stock is up to date');
            window.setTimeout(() => setSyncStatus(''), 2000);
          } else {
            setSyncStatus(result.message || 'Cloud update delayed — tap Refresh');
          }
          await paintLocal();
        } catch (error) {
          console.error('[Inventory] Cloud refresh failed:', error);
          setSyncStatus('No internet or cloud connection. Showing saved inventory; refresh when reconnected.');
        }
      }
    } catch (error) {
      console.error('[Inventory] Could not load inventory:', error);
      try {
        const allProducts = await getCurrentStoreProducts();
        setProducts(allProducts);
        setProductsLoaded(true);
        setInventoryLoadError('');
        const productCategories = await getCurrentStoreProductCategories();
        setCategories(['All', ...productCategories.map((category) => category.name)]);
        setSyncStatus('Showing this browser’s inventory');
        window.setTimeout(() => setSyncStatus(''), 2500);
      } catch {
        setProducts([]);
        setCategories(['All']);
        setProductsLoaded(true);
        setInventoryLoadError('Could not load inventory from this device. Check storage and refresh.');
      }
    }
  }, [currentStore?.id]);

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

  // Instant stock numbers after POS sale / order fulfill / adjust
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
    });
  }, [currentStore?.id]);

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

  // Local refresh between syncs (sales on this device) — less aggressive now that events patch live
  useEffect(() => {
    const interval = setInterval(() => {
      void loadProducts({ sync: false });
    }, 60_000);
    return () => clearInterval(interval);
  }, [loadProducts]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    lastSyncAtRef.current = 0;
    setSyncStatus('Full sync…');
    try {
      if (isSupabaseConfigured()) {
        const result = await syncBidirectional();
        setSyncStatus(result.success ? 'Stock is up to date' : result.message);
        window.setTimeout(() => setSyncStatus(''), 2500);
      }
      await loadProducts({ sync: false });
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    let result = [...products];

    if (selectedCategory !== 'All') {
      result = result.filter((p) => (p.category || 'Other') === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      result = result
        .map((product) => ({ product, score: scoreSmartSearch(product, q) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((row) => row.product);
    } else switch (sortMode) {
      case 'recent':
        result.sort(
          (a, b) =>
            new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
        );
        break;
      case 'alpha':
        result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'stock-low':
        result.sort((a, b) => toQty(a.stock_level) - toQty(b.stock_level));
        break;
      case 'stock-high':
        result.sort((a, b) => toQty(b.stock_level) - toQty(a.stock_level));
        break;
    }

    setFilteredProducts(result);
  }, [products, selectedCategory, searchQuery, sortMode]);

  const activeProducts = products.filter((p) => p.is_active === 1);
  const totalSKUs = activeProducts.length;
  const outOfStock = activeProducts.filter((p) => toQty(p.stock_level) === 0).length;
  const lowStock = activeProducts.filter((p) => {
    const stock = toQty(p.stock_level);
    const threshold = Number(p.reorder_level) > 0 ? Number(p.reorder_level) : 5;
    return stock > 0 && stock <= threshold;
  }).length;
  const totalValue = activeProducts.reduce(
    (sum, p) => sum + toQty(p.stock_level) * toMoney(p.selling_price),
    0
  );
  const totalCostOfProduct = activeProducts.reduce(
    (sum, p) => sum + toQty(p.stock_level) * toMoney(p.cost_price),
    0
  );

  const formatInventoryMoney = (amount: number) => money(amount);

  const formatStockQty = (value: unknown) => String(toQty(value));

  const handleInventoryExport = (format: 'csv' | 'pdf') => {
    setShowExportMenu(false);
    setExportStatus('');
    try {
      const currencyCode = currentStore?.currency_code || 'GHS';
      const storeName = currentStore?.name || 'Store';
      if (format === 'csv') {
        downloadInventoryCsv(filteredProducts, currencyCode, storeName);
      } else {
        downloadInventoryPdf(filteredProducts, currencyCode, storeName);
      }
      setExportStatus(`Exported ${filteredProducts.length} inventory products as ${format.toUpperCase()}.`);
    } catch (error) {
      console.error('[Inventory] Could not export inventory:', error);
      setExportStatus(error instanceof Error ? `Could not export inventory: ${error.message}` : 'Could not export inventory.');
    }
  };

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
      await printBarcodeLabel(product, currentStore?.name || 'Store', currentStore?.currency_code);
      setLabelStatus(`Printed label for ${product.name}`);
    } catch {
      downloadBarcodeLabel(product, currentStore?.name || 'Store', currentStore?.currency_code);
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu((visible) => !visible)}
                disabled={!productsLoaded || filteredProducts.length === 0}
                className="bg-white/20 p-2 rounded-xl touch-target disabled:opacity-50"
                title="Export inventory"
                aria-label="Export inventory"
                aria-expanded={showExportMenu}
              >
                <Download className="w-4 h-4 text-white" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 min-w-36 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  <button
                    type="button"
                    onClick={() => handleInventoryExport('csv')}
                    className="w-full px-3 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 touch-target"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInventoryExport('pdf')}
                    className="w-full border-t border-gray-100 px-3 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 touch-target"
                  >
                    Export PDF
                  </button>
                </div>
              )}
            </div>
            {currentUser?.role === 'owner' && (
              <button
                type="button"
                onClick={() => setShowManageCategories(true)}
                className="bg-white/20 p-2 rounded-xl touch-target"
                title="Manage product categories"
                aria-label="Manage product categories"
              >
                <Tags className="w-4 h-4 text-white" />
              </button>
            )}
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
        {exportStatus && (
          <p role={exportStatus.startsWith('Could not') ? 'alert' : 'status'} className="text-emerald-100/90 text-[11px] text-center mb-2">
            {exportStatus}
          </p>
        )}

        {/* Dashboard Cards — identical layout and figures on phone and desktop */}
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/15 rounded-xl p-2 text-center min-w-0">
              <Package className="w-4 h-4 text-white mx-auto mb-1" />
              <p className="text-white font-bold text-base sm:text-lg leading-tight tabular-nums">
                {formatStockQty(totalSKUs)}
              </p>
              <p className="text-emerald-200 text-[9px] mt-0.5">Total SKUs</p>
            </div>
            <button
              onClick={() => { setSelectedCategory('All'); setSortMode('stock-low'); }}
              className="bg-white/15 rounded-xl p-2 text-center hover:bg-white/25 transition min-w-0"
            >
              <AlertTriangle className="w-4 h-4 text-red-300 mx-auto mb-1" />
              <p className="text-white font-bold text-base sm:text-lg leading-tight tabular-nums">
                {formatStockQty(outOfStock)}
              </p>
              <p className="text-emerald-200 text-[9px] mt-0.5">Out of Stock</p>
            </button>
            <button
              onClick={() => { setSelectedCategory('All'); setSortMode('stock-low'); }}
              className="bg-white/15 rounded-xl p-2 text-center hover:bg-white/25 transition min-w-0"
            >
              <TrendingDown className="w-4 h-4 text-yellow-300 mx-auto mb-1" />
              <p className="text-white font-bold text-base sm:text-lg leading-tight tabular-nums">
                {formatStockQty(lowStock)}
              </p>
              <p className="text-emerald-200 text-[9px] mt-0.5">Low Stock</p>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/15 rounded-xl p-2 text-center min-w-0">
              <DollarSign className="w-4 h-4 text-green-300 mx-auto mb-1" />
              <p className="text-white font-bold text-xs sm:text-sm leading-tight tabular-nums break-all">
                {formatInventoryMoney(totalValue)}
              </p>
              <p className="text-emerald-200 text-[9px] mt-0.5">Value</p>
            </div>
            <div className="bg-white/15 rounded-xl p-2 text-center min-w-0">
              <Coins className="w-4 h-4 text-amber-200 mx-auto mb-1" />
              <p className="text-white font-bold text-xs sm:text-sm leading-tight tabular-nums break-all">
                {formatInventoryMoney(totalCostOfProduct)}
              </p>
              <p className="text-emerald-200 text-[9px] mt-0.5 leading-tight">
                Total Cost
              </p>
            </div>
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
        <div className="mb-3 flex gap-2">
          <button type="button" onClick={() => setShowInsights(false)} className={`rounded-lg px-3 py-2 text-xs font-semibold touch-target ${!showInsights ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200'}`}>
            Products
          </button>
          <button type="button" onClick={() => setShowInsights(true)} className={`rounded-lg px-3 py-2 text-xs font-semibold touch-target ${showInsights ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200'}`}>
            Restock & audit
          </button>
        </div>
        {showInsights ? (
          currentStore?.id ? (
            <InventoryInsights
              storeId={currentStore.id}
              products={products}
              onEditProduct={(product) => { setEditProduct(product); setShowAddProduct(true); }}
            />
          ) : null
        ) : !productsLoaded ? (
          <div className="space-y-2" aria-label="Loading inventory" aria-busy="true">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="animate-pulse rounded-xl border border-gray-100 bg-white p-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-lg bg-gray-100" />
                  <div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-gray-100" /><div className="h-2 w-1/3 rounded bg-gray-100" /></div>
                  <div className="h-4 w-16 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : inventoryLoadError ? (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>{inventoryLoadError}</p>
            <button type="button" onClick={() => void loadProducts({ sync: true })} className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold">Refresh inventory</button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Package className="w-12 h-12 mb-3" />
            <p className="text-sm font-medium">{products.length === 0 ? 'No products yet' : 'No products found'}</p>
            <p className="mt-1 text-center text-xs">{products.length === 0 ? 'Scan or import to start adding items to your store.' : 'Try another search or category.'}</p>
            <button
              onClick={() => { setEditProduct(null); setShowAddProduct(true); }}
              className="mt-4 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium"
            >
              {products.length === 0 ? 'Add First Product' : 'Add Product'}
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
                          {toQty(product.stock_level) === 0 && product.is_active === 1 && (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[9px] font-bold rounded">
                              OUT OF STOCK
                            </span>
                          )}
                          {toQty(product.stock_level) > 0 &&
                            toQty(product.stock_level) <= (Number(product.reorder_level) > 0 ? Number(product.reorder_level) : 5) &&
                            product.is_active === 1 && (
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
                            {money(toMoney(product.selling_price))}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            Cost: {money(toMoney(product.cost_price))}
                          </p>
                        </div>
                        {showStockQty && (
                          <p
                            className={`text-xs font-semibold ${
                              toQty(product.stock_level) === 0
                                ? 'text-red-500'
                                : toQty(product.stock_level) <= (Number(product.reorder_level) > 0 ? Number(product.reorder_level) : 5)
                                  ? 'text-amber-500'
                                  : 'text-gray-700'
                            }`}
                          >
                            Stock: {formatStockQty(product.stock_level)}
                          </p>
                        )}
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
        categories={categories.filter((category) => category !== 'All')}
        initialBarcode={scannedBarcodeForAdd}
      />

      <ManageProductCategoriesModal
        isOpen={showManageCategories}
        onClose={() => setShowManageCategories(false)}
        onChanged={() => {
          setSelectedCategory('All');
          void loadProducts({ sync: false });
        }}
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
