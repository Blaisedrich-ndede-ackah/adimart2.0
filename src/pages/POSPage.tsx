import { useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ShoppingCart, Minus, Plus, Trash2, Search, ChevronRight, Package, AlertCircle, Bluetooth,
  ScanBarcode, MapPin, X, Settings2, GripVertical, MoveUp, MoveDown, Mic, Pause, Play,
  CircleCheck, CircleX,
} from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import CheckoutOverlay from '@/components/CheckoutOverlay';
import FrequentItems from '@/components/FrequentItems';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';
import { canViewStockQuantities } from '@/lib/stockVisibility';
import { useAccessibilityStore } from '@/lib/accessibility';
import { db, LocalProduct, LocalLocation, getActiveStoreOwner, getCurrentStoreActiveProducts, getCurrentStoreId } from '@/lib/dexie';
import { playScanBeep, primeScanBeep } from '@/lib/scanBeep';
import { useBluetoothBarcodeInput } from '@/hooks/useBluetoothBarcodeInput';
import { getBluetoothHardwareStatus, subscribeBluetoothStatus } from '@/lib/bluetoothPeripherals';
import ProductImage from '@/components/ProductImage';
import { getAvailableSaleModes, resolveSalePrice, type SaleMode, type UnitType } from '@/lib/bulkPricing';
import { subscribeStockChanges } from '@/lib/stockEvents';
import {
  canUserSellWholesale,
  ensureStoreLocations,
  getLocationStockMap,
  alignProductsWithBatchStock,
  resolveSaleLocations,
  getStoreBatchStockMap,
  toMoney,
  toQty,
} from '@/lib/warehouse';
import { triggerAutoSync } from '@/lib/sync';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import { scoreSmartSearch } from '@/lib/adimatAi/search';
import { useAlsoBuy } from '@/lib/adimatAi/useAdimatAi';
import AlsoBuySuggestions from '@/components/AlsoBuySuggestions';
import {
  loadOwnerPosLayout,
  saveOwnerPosLayout,
  DEFAULT_POS_LAYOUT,
  type PosLayout,
  type PosSection,
} from '@/lib/posLayout';

type PosTab = 'products' | 'cart';
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

function productMatchScore(product: LocalProduct, query: string): number {
  const name = product.name.toLocaleLowerCase();
  const barcode = product.barcode.toLocaleLowerCase();
  const category = product.category.toLocaleLowerCase();
  if (barcode === query) return 1000;
  if (barcode.includes(query)) return 900;
  if (query.length >= 3 && query.includes(barcode) && barcode.length >= 3) return 850;
  if (name === query) return 800;
  if (name.startsWith(query)) return 750;
  if (name.includes(query) || name.replace(/\s+/g, '').includes(query.replace(/\s+/g, ''))) return 700;
  if (category.includes(query)) return 500;

  const queryParts = query.split(/\s+/).filter(Boolean);
  const words = `${name} ${category}`.split(/[\s/-]+/).filter(Boolean);
  let score = 0;
  for (const part of queryParts) {
    let best = 0;
    for (const word of words) {
      if (word.startsWith(part)) best = Math.max(best, 400);
      else if (part.length >= 3) {
        const distance = editDistance(part, word);
        const maxDistance = part.length < 5 ? 1 : Math.min(3, Math.floor(part.length * 0.25));
        if (distance <= maxDistance) best = Math.max(best, 350 - distance * 20);
      }
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

function moveBefore<T>(order: readonly T[], source: T, target: T): T[] {
  const next = [...order];
  const sourceIndex = next.indexOf(source);
  const targetIndex = next.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return next;
  next.splice(sourceIndex, 1);
  next.splice(next.indexOf(target), 0, source);
  return next;
}

function moveBy<T>(order: readonly T[], item: T, offset: number): T[] {
  const next = [...order];
  const index = next.indexOf(item);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export default function POSPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const cart = useCartStore();
  const setSaleContext = useCartStore((s) => s.setSaleContext);
  const { currentUser, currentStore } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
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
  const [ownerForLayout, setOwnerForLayout] = useState<typeof currentUser>(null);
  const [posLayout, setPosLayout] = useState<PosLayout>(DEFAULT_POS_LAYOUT);
  const [salesRank, setSalesRank] = useState<Record<string, { quantity: number; lastSold: number }>>({});
  const [voiceSearchAvailable, setVoiceSearchAvailable] = useState(false);
  const [voiceSearchActive, setVoiceSearchActive] = useState(false);
  const [voiceSearchError, setVoiceSearchError] = useState('');
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [showLayoutEditor, setShowLayoutEditor] = useState(false);
  const [layoutStatus, setLayoutStatus] = useState('');
  const [draggedSection, setDraggedSection] = useState<PosSection | null>(null);

  const canWholesale = canUserSellWholesale(currentUser);
  const isStoreOwner = currentUser?.role === 'owner';
  const showStockQty = canViewStockQuantities(currentUser, currentStore);
  const alsoBuy = useAlsoBuy(currentStore?.id, cart.items.map((item) => item.product_id));
  const retailLineCount = cart.items.filter((item) => item.sale_mode === 'retail').length;
  const wholesaleLineCount = cart.items.filter((item) => item.sale_mode === 'wholesale').length;
  const packLineCount = cart.items.filter((item) => item.unit_type === 'pack').length;
  const unitLineCount = cart.items.length - packLineCount;
  const isMixedCart = (retailLineCount > 0 && wholesaleLineCount > 0) || (packLineCount > 0 && unitLineCount > 0);

  useEffect(() => {
    let active = true;
    setOwnerForLayout(null);
    setPosLayout(DEFAULT_POS_LAYOUT);
    setLayoutStatus('');
    if (!currentStore?.id) return () => { active = false; };

    void (async () => {
      const owner = await getActiveStoreOwner(currentStore.id);
      if (!active) return;
      setOwnerForLayout(owner);
      if (!owner) return;
      const result = await loadOwnerPosLayout(owner.id);
      if (!active) return;
      setPosLayout(result.layout);
      if (result.cloudError) {
        setLayoutStatus(`Using this device's saved layout; cloud load failed: ${result.cloudError}`);
      }
    })().catch((error: unknown) => {
      if (!active) return;
      console.error('[POS] Could not load the owner layout:', error);
      setLayoutStatus(error instanceof Error ? error.message : 'Could not load the owner layout.');
    });

    return () => { active = false; };
  }, [currentStore?.id]);

  const savePosLayout = useCallback(async (next: PosLayout) => {
    setPosLayout(next);
    if (!ownerForLayout) {
      setLayoutStatus('The store owner account is unavailable on this device.');
      return;
    }
    setLayoutStatus('Saving layout…');
    try {
      const result = await saveOwnerPosLayout(ownerForLayout, next);
      setLayoutStatus(result.message);
    } catch (error) {
      console.error('[POS] Could not save the owner layout:', error);
      setLayoutStatus(error instanceof Error ? error.message : 'Could not save the owner layout.');
    }
  }, [ownerForLayout]);

  const reorderTopSection = useCallback((source: 'scanner' | 'frequent', target: 'scanner' | 'frequent') => {
    const topOrder = moveBefore(posLayout.topOrder, source, target);
    if (topOrder.some((section, index) => section !== posLayout.topOrder[index])) {
      void savePosLayout({ ...posLayout, topOrder });
    }
  }, [posLayout, savePosLayout]);

  const reorderPane = useCallback((source: 'products' | 'cart', target: 'products' | 'cart') => {
    const paneOrder = moveBefore(posLayout.paneOrder, source, target);
    if (paneOrder.some((section, index) => section !== posLayout.paneOrder[index])) {
      void savePosLayout({ ...posLayout, paneOrder });
    }
  }, [posLayout, savePosLayout]);

  const moveTopSection = useCallback((section: 'scanner' | 'frequent', offset: number) => {
    const topOrder = moveBy(posLayout.topOrder, section, offset);
    if (topOrder.some((item, index) => item !== posLayout.topOrder[index])) {
      void savePosLayout({ ...posLayout, topOrder });
    }
  }, [posLayout, savePosLayout]);

  const movePane = useCallback((section: 'products' | 'cart', offset: number) => {
    const paneOrder = moveBy(posLayout.paneOrder, section, offset);
    if (paneOrder.some((item, index) => item !== posLayout.paneOrder[index])) {
      void savePosLayout({ ...posLayout, paneOrder });
    }
  }, [posLayout, savePosLayout]);

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
      if (storeId && !soft) {
        await ensureStoreLocations(storeId);
        void triggerAutoSync('pos-load');
      }
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

      if (storeId) {
        const map = selectedLocationId
          ? await getLocationStockMap(storeId, selectedLocationId)
          : await getStoreBatchStockMap(storeId);
        for (const product of list) {
          if (map[product.id] === undefined) map[product.id] = toQty(product.stock_level);
        }
        setLocationStock(map);
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
    setSaleContext(selectedLocationId || null, saleMode, unitType);
  }, [selectedLocationId, saleMode, unitType, setSaleContext]);

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
    return products
      .filter((product) => selectedCategory === 'All' || product.category === selectedCategory)
      .map((product) => ({
        product,
        relevance: q ? Math.max(productMatchScore(product, q), scoreSmartSearch(product, q)) : 0,
        rank: salesRank[product.id],
      }))
      .filter(({ relevance }) => !q || relevance > 0)
      .sort((a, b) =>
        b.relevance - a.relevance ||
        (b.rank?.quantity || 0) - (a.rank?.quantity || 0) ||
        (b.rank?.lastSold || 0) - (a.rank?.lastSold || 0) ||
        new Date(b.product.updated_at || 0).getTime() - new Date(a.product.updated_at || 0).getTime()
      )
      .map(({ product }) => product);
  }, [products, searchQuery, selectedCategory, salesRank]);

  useEffect(() => {
    const speech = window as SpeechWindow;
    setVoiceSearchAvailable(Boolean(speech.SpeechRecognition || speech.webkitSpeechRecognition));
    return () => speechRecognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const storeId = await getCurrentStoreId();
      if (!storeId) return;
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const [transactions, items] = await Promise.all([
        db.transactions.where('store_id').equals(storeId).filter((transaction) =>
          transaction.status === 'completed' && new Date(transaction.created_at).getTime() >= since
        ).toArray(),
        db.transaction_items.where('store_id').equals(storeId).toArray(),
      ]);
      const transactionDates = new Map(transactions.map((transaction) => [transaction.id, new Date(transaction.created_at).getTime()]));
      const next: Record<string, { quantity: number; lastSold: number }> = {};
      for (const item of items) {
        const soldAt = transactionDates.get(item.transaction_id);
        if (!soldAt) continue;
        const entry = next[item.product_id] || { quantity: 0, lastSold: 0 };
        entry.quantity += Number(item.quantity) || 0;
        entry.lastSold = Math.max(entry.lastSold, soldAt);
        next[item.product_id] = entry;
      }
      if (active) setSalesRank(next);
    })().catch((error: unknown) => {
      console.error('[POS] Could not load product sales ranking:', error);
    });
    return () => { active = false; };
  }, [currentStore?.id]);

  const startVoiceSearch = useCallback(() => {
    const speech = window as SpeechWindow;
    const Recognition = speech.SpeechRecognition || speech.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceSearchError('Voice search is not supported in this browser.');
      return;
    }
    speechRecognitionRef.current?.stop();
    const recognition = new Recognition();
    recognition.lang = currentStore?.preferred_language === 'fr' ? 'fr-GH' : 'en-GH';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setSearchQuery(transcript);
    };
    recognition.onerror = () => {
      setVoiceSearchError('Could not hear that. Check microphone permission and try again.');
      setVoiceSearchActive(false);
    };
    recognition.onend = () => {
      setVoiceSearchActive(false);
      speechRecognitionRef.current = null;
    };
    speechRecognitionRef.current = recognition;
    setVoiceSearchError('');
    setVoiceSearchActive(true);
    try {
      recognition.start();
    } catch (error) {
      console.error('[POS] Could not start voice search:', error);
      setVoiceSearchActive(false);
      setVoiceSearchError('Could not start voice search. Check microphone permission and try again.');
    }
  }, [currentStore?.preferred_language]);

  const flashFeedback = useCallback((feedback: { type: 'success' | 'error' | 'warning'; message: string }, ms = 2500) => {
    setScanFeedback(feedback);
    setTimeout(() => setScanFeedback(null), ms);
  }, []);

  const handleScan = useCallback(async (barcode: string) => {
    const result = await cart.addItemByBarcode(barcode, { saleMode, unitType });

    if (result.success && result.product) {
      flashFeedback({ type: 'success', message: `Added: ${result.product.name}` });
      playScanBeep('success');
      setPosTab('cart');
    } else if (result.error) {
      if (
        result.error.includes('out of stock') ||
        result.error.includes('enough stock')
      ) {
        flashFeedback({ type: 'warning', message: result.error });
        playScanBeep('warning');
      } else {
        flashFeedback({ type: 'error', message: result.error });
        playScanBeep('error');
      }
    }
  }, [cart, flashFeedback, saleMode, unitType]);

  // Handheld Bluetooth / HID scanner → cart (active while not in checkout)
  useBluetoothBarcodeInput(handleScan, scannerActive && !showCheckout);

  const handleAddProduct = async (product: LocalProduct, overrideSaleMode?: SaleMode) => {
    const modes = getAvailableSaleModes(product);
    const defaultMode = saleMode === 'wholesale' && modes.includes('wholesale') ? 'wholesale' : 'retail';
    const mode = overrideSaleMode ?? defaultMode;

    const packSize = Math.max(1, Number(product.pack_size) || 1);
    const usePack = unitType === 'pack' && packSize > 1;
    const result = await cart.addItem(product, { unitType: usePack ? 'pack' : 'base', saleMode: mode });

    if (result.success) {
      flashFeedback({ type: 'success', message: `Added: ${product.name}` }, 2000);
      playScanBeep('success');
      return true;
    }

    if (result.error) {
      setStockError(result.error);
      playScanBeep('error');
      setTimeout(() => setStockError(null), 3000);
    }
    return false;
  };

  const handleSearchKeyDown = async (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && searchQuery) {
      event.preventDefault();
      setSearchQuery('');
      return;
    }

    if (
      event.key !== 'Enter' ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      !searchQuery.trim() ||
      filteredProducts.length !== 1
    ) {
      return;
    }

    const product = filteredProducts[0];
    const available = locationStock[product.id] ?? toQty(product.stock_level);
    if (available <= 0) return;

    event.preventDefault();
    if (await handleAddProduct(product)) setSearchQuery('');
  };

  const handleIncrement = async (itemId: string) => {
    const result = await cart.incrementItem(itemId);
    if (!result.success && result.error) {
      setStockError(result.error);
      setTimeout(() => setStockError(null), 3000);
    }
  };

  const handleDecrement = (itemId: string) => {
    const item = cart.items.find((i) => i.id === itemId);
    if (!item) return;
    if (item.quantity <= 1) {
      // Removing the last unit: confirm to avoid accidental clears during busy service.
      if (window.confirm(`Remove ${item.name} from the cart?`)) {
        cart.removeItem(itemId);
      }
      return;
    }
    void cart.decrementItem(itemId);
  };

  const toggleItemSaleMode = async (itemId: string) => {
    const item = cart.items.find((currentItem) => currentItem.id === itemId);
    if (!item) return;
    const nextMode: SaleMode = item.sale_mode === 'retail' ? 'wholesale' : 'retail';
    if (nextMode === 'wholesale') {
      if (!canWholesale) {
        flashFeedback({ type: 'warning', message: 'Wholesale pricing is disabled for this cashier.' });
        return;
      }
      const product = await db.products.get(item.product_id);
      if (!product || !getAvailableSaleModes(product).includes('wholesale')) {
        flashFeedback({ type: 'warning', message: `No wholesale pricing is configured for ${item.name}.` });
        return;
      }
    }
    const result = await cart.setItemSaleMode(itemId, nextMode);
    if (!result.success && result.error) {
      flashFeedback({ type: 'warning', message: result.error });
    }
  };

  const toggleItemUnitType = async (itemId: string) => {
    const item = cart.items.find((currentItem) => currentItem.id === itemId);
    if (!item) return;
    const nextUnit: UnitType = item.unit_type === 'pack' ? 'base' : 'pack';
    const result = await cart.setItemUnitType(itemId, nextUnit);
    if (!result.success && result.error) {
      flashFeedback({ type: 'warning', message: result.error });
    }
  };

  const handleUpdateQuantity = async (itemId: string, newQty: number) => {
    const qty = Math.floor(newQty);
    if (qty <= 0) {
      const item = cart.items.find((i) => i.id === itemId);
      if (item && window.confirm(`Remove ${item.name} from the cart?`)) {
        cart.removeItem(itemId);
      }
      return;
    }
    const result = await cart.updateQuantity(itemId, qty);
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

  const renderOrderGroup = <T extends PosSection,>(
    title: string,
    sections: readonly T[],
    labels: Record<T, string>,
    reorder: (source: T, target: T) => void,
    move: (section: T, offset: number) => void
  ) => (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
      <div className="space-y-1.5">
        {sections.map((section, index) => (
          <div
            key={section}
            draggable
            onDragStart={(event) => {
              setDraggedSection(section);
              event.dataTransfer.setData('text/plain', section);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dragged = sections.find((item) => item === event.dataTransfer.getData('text/plain'));
              if (dragged) reorder(dragged, section);
              setDraggedSection(null);
            }}
            onDragEnd={() => setDraggedSection(null)}
            className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 ${
              draggedSection === section ? 'opacity-50' : ''
            }`}
          >
            <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-400" aria-hidden="true" />
            <span className="flex-1 text-sm font-medium text-gray-800">{labels[section]}</span>
            <button
              type="button"
              onClick={() => move(section, -1)}
              disabled={index === 0}
              aria-label={`Move ${labels[section]} up`}
              className="rounded p-1.5 text-gray-500 hover:bg-white disabled:opacity-30 touch-target"
            >
              <MoveUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => move(section, 1)}
              disabled={index === sections.length - 1}
              aria-label={`Move ${labels[section]} down`}
              className="rounded p-1.5 text-gray-500 hover:bg-white disabled:opacity-30 touch-target"
            >
              <MoveDown className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );

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
          {isStoreOwner && (
            <button
              type="button"
              onClick={() => setShowLayoutEditor((open) => !open)}
              aria-expanded={showLayoutEditor}
              aria-label="Customize POS layout"
              className={`p-2.5 rounded-xl touch-target ${
                showLayoutEditor ? 'bg-white text-primary' : 'bg-white/20 text-white'
              }`}
              title="Customize POS layout"
            >
              <Settings2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {showLayoutEditor && isStoreOwner && (
        <section className="flex-shrink-0 border-b border-emerald-100 bg-white px-3 py-3 md:px-4" aria-label="Customize POS layout">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Customize POS layout</h2>
              <p className="text-xs text-gray-500">Drag sections or use the arrows to change their order.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowLayoutEditor(false)}
              aria-label="Close layout settings"
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 touch-target"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {renderOrderGroup(
              'Above the sales panels',
              posLayout.topOrder,
              { scanner: 'Camera scanner', frequent: 'Frequently bought' },
              reorderTopSection,
              moveTopSection
            )}
            {renderOrderGroup(
              'Sales panels',
              posLayout.paneOrder,
              { products: 'Products', cart: 'Cart' },
              reorderPane,
              movePane
            )}
          </div>
          {layoutStatus && (
            <p role="status" className="mt-2 text-xs text-gray-600" aria-live="polite">
              {layoutStatus}
            </p>
          )}
        </section>
      )}

      {/* Products / Cart tabs — mobile only; desktop shows both panes */}
      <div className="bg-white border-b border-emerald-100 px-3 py-2 flex gap-2 flex-shrink-0 lg:hidden">
        {posLayout.paneOrder.map((section) => (
          <button
            key={section}
            type="button"
            onClick={() => setPosTab(section)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold touch-target inline-flex items-center justify-center gap-2 ${
              posTab === section ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {section === 'cart' && <ShoppingCart className="w-4 h-4" />}
            {section === 'products' ? 'Products' : `Cart${cartCount > 0 ? ` (${cartCount})` : ''}`}
          </button>
        ))}
      </div>

      {/* Sale context: retail/wholesale + unit. One shop per store — no location picker. */}
      <div className="bg-white border-b border-emerald-50 px-3 py-2.5 md:px-4 flex-shrink-0 space-y-2 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        {saleLocations.length > 1 ? (
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
        ) : null}
        <div className="flex flex-wrap gap-2 md:w-auto md:flex-shrink-0">
          <button
            type="button"
            aria-pressed={saleMode === 'retail'}
            aria-label="Use retail pricing for newly added items"
            onClick={() => {
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
            aria-pressed={saleMode === 'wholesale'}
            aria-label="Use wholesale pricing for newly added items"
            disabled={!canWholesale}
            onClick={() => {
              if (!canWholesale) return;
              setSaleMode('wholesale');
            }}
            className={`flex-1 md:flex-none md:px-4 py-2 rounded-lg text-xs font-semibold touch-target disabled:opacity-40 ${
              saleMode === 'wholesale' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
            title={canWholesale ? 'Wholesale / bulk pricing for newly added items' : 'Wholesale disabled for this cashier'}
          >
            Wholesale
          </button>
          <button
            type="button"
            aria-pressed={unitType === 'base'}
            aria-label="Add the next items by unit"
            onClick={() => setUnitType('base')}
            className={`flex-1 md:flex-none md:px-4 py-2 rounded-lg text-xs font-semibold touch-target whitespace-nowrap ${
              unitType === 'base' ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            By unit
          </button>
          <button
            type="button"
            aria-pressed={unitType === 'pack'}
            aria-label="Add the next items by pack"
            onClick={() => setUnitType('pack')}
            className={`flex-1 md:flex-none md:px-4 py-2 rounded-lg text-xs font-semibold touch-target whitespace-nowrap ${
              unitType === 'pack' ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            By pack
          </button>
        </div>
        <p className="text-[10px] leading-snug text-gray-500 md:basis-full">
          Retail, wholesale, and by unit stay in the same sale. Switching only changes the next item
          {cart.items.length > 0 ? ` — ${cart.items.length} selected item${cart.items.length === 1 ? '' : 's'} stay in the cart.` : '.'}
        </p>
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

      {posLayout.topOrder.map((section) =>
        section === 'scanner'
          ? showCameraScanner && (
              <div key={section} className="px-3 md:px-4 pt-3 flex-shrink-0">
                <BarcodeScanner onScan={handleScan} active={scannerActive && !showCheckout} />
              </div>
            )
          : (
              <FrequentItems
                key={section}
                onAddProduct={(product) => handleScan(product.barcode || product.id)}
              />
            )
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Products pane */}
        <section
          style={{ order: posLayout.paneOrder.indexOf('products') }}
          className={`${
            posTab === 'products' ? 'flex' : 'hidden'
          } lg:flex flex-col flex-1 min-w-0 min-h-0 lg:border-r lg:border-emerald-100`}
        >
          <div className="px-3 md:px-4 pt-3 flex-shrink-0 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('pos.search') + '...'}
                aria-label="Search products by name, barcode, or category"
                aria-describedby="pos-search-keyboard-hint"
                data-allow-typing="true"
                className="w-full pl-9 pr-20 py-3 bg-surface-card border border-border rounded-xl text-base outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {voiceSearchAvailable && (
                  <button
                    type="button"
                    onClick={startVoiceSearch}
                    aria-label={voiceSearchActive ? 'Listening for product name' : 'Search products by voice'}
                    title={voiceSearchActive ? 'Listening…' : 'Search by voice'}
                    className={`icon-btn ${voiceSearchActive ? 'text-primary' : ''}`}
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowCameraScanner((v) => !v);
                    if (!showCameraScanner) setScannerActive(true);
                  }}
                  aria-label="Scan product barcode with camera"
                  title="Scan barcode"
                  className="icon-btn-primary"
                >
                  <ScanBarcode className="h-4 w-4" />
                </button>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear product search"
                    className="icon-btn"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <span id="pos-search-keyboard-hint" className="sr-only">
                Press Enter to add the only matching in-stock product. Press Escape to clear the search.
              </span>
            </div>
            {voiceSearchError && <p role="status" className="px-1 text-[11px] text-amber-800">{voiceSearchError}</p>}
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
                  {cat === 'All' ? t('common.all') : cat}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 px-0.5 text-[11px] text-gray-500">
              <p role="status" aria-live="polite">
                {loadingProducts
                  ? 'Loading products…'
                  : searchQuery.trim() || selectedCategory !== 'All'
                    ? `${filteredProducts.length} of ${products.length} products`
                    : `${products.length} products`}
              </p>
              {!loadingProducts &&
                searchQuery.trim() &&
                filteredProducts.length === 1 &&
                (locationStock[filteredProducts[0].id] ?? toQty(filteredProducts[0].stock_level)) > 0 && (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-semibold text-gray-600">Enter</kbd>
                    adds match
                  </span>
                )}
            </div>
          </div>

          <div className={`flex-1 overflow-y-auto px-3 md:px-4 pt-2 no-scrollbar ${cart.items.length > 0 ? 'pb-28 lg:pb-4' : 'pb-4'}`}>
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
                    ? 'No products yet. Scan or import to start.'
                    : 'No close matches. Try another spelling, barcode, or category.'}
                </p>
              </div>
            ) : (
              <div className="pos-product-grid">
                {filteredProducts.map((product) => {
                  const stockHere =
                    locationStock[product.id] !== undefined
                      ? locationStock[product.id]
                      : toQty(product.stock_level);
                  const outOfStock = stockHere <= 0;
                  const reorderLevel = Math.max(0, Number(product.reorder_level) || 0);
                  const lowStock = !outOfStock && reorderLevel > 0 && stockHere <= reorderLevel;
                  const packSize = Math.max(1, Number(product.pack_size) || 1);
                  const modes = getAvailableSaleModes(product);
                  const productSaleMode = saleMode === 'wholesale' && modes.includes('wholesale') ? 'wholesale' : 'retail';
                  const displayUnitType: UnitType = unitType === 'pack' && packSize > 1 ? 'pack' : 'base';
                  const pricePreview = resolveSalePrice({
                    product,
                    saleMode: productSaleMode,
                    quantity: 1,
                    unitType: displayUnitType,
                  });
                  const isWholesalePrice = pricePreview.label.startsWith('Wholesale');
                  const unitLabel = displayUnitType === 'pack' ? 'pack' : 'unit';
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => void handleAddProduct(product)}
                      disabled={outOfStock}
                      aria-label={
                        outOfStock
                          ? `${product.name}, out of stock`
                          : !showStockQty
                          ? `Add ${product.name} to cart for ${money(toMoney(pricePreview.unitPrice))} per ${unitLabel}`
                          : lowStock
                          ? `${product.name}, low stock — ${stockHere} left`
                          : `Add ${product.name} to cart for ${money(toMoney(pricePreview.unitPrice))} per ${unitLabel}`
                      }
                      className="pos-product-card"
                    >
                      <ProductImage src={product.image_url} alt="" size="md" />
                      <span className="flex-1 min-w-0 text-left">
                        <span className="pos-product-name block text-sm font-semibold leading-snug text-gray-900">
                          {product.name}
                        </span>
                        <span className="mt-1 block text-sm font-bold text-primary">
                          {money(toMoney(pricePreview.unitPrice))}
                          <span className="text-[10px] text-gray-500 font-medium"> / {unitLabel}</span>
                        </span>
                        {(product.track_expiry === 1 || isWholesalePrice) && (
                          <span className="mt-1 block text-[10px] leading-4 text-gray-500">
                            {product.track_expiry === 1 ? 'Expiry tracked' : ''}
                            {product.track_expiry === 1 && isWholesalePrice ? ' · ' : ''}
                            {isWholesalePrice ? 'Wholesale price' : ''}
                          </span>
                        )}
                        {(showStockQty || outOfStock) && (
                          <span className={`mt-1 block text-[10px] font-semibold ${outOfStock ? 'text-danger' : lowStock ? 'text-accent' : 'text-gray-500'}`}>
                            {outOfStock ? 'Out of stock' : lowStock ? `Low stock · ${stockHere} left` : `${stockHere} available`}
                          </span>
                        )}
                      </span>
                      <span className="pos-product-add" aria-hidden="true">
                        <Plus className="h-4 w-4" strokeWidth={2.5} />
                        <span>{outOfStock ? 'Wait' : 'Add'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Cart pane */}
        <section
          style={{ order: posLayout.paneOrder.indexOf('cart') }}
          className={`${
            posTab === 'cart' ? 'flex' : 'hidden'
          } ios-pane lg:flex flex-col w-full lg:w-[420px] 2xl:w-[460px] flex-shrink-0 min-h-0 border-l border-white/50`}
        >
          <div className="flex items-center justify-between gap-2 px-3 lg:px-4 py-3 border-b border-emerald-100 flex-shrink-0">
            <h3 className="text-sm font-bold text-gray-800">
              Cart{cartCount > 0 ? ` (${cartCount})` : ''}
            </h3>
            <div className="flex items-center gap-2">
              {cart.parkedCarts.length > 0 && (
                <span className="text-xs text-amber-700 font-medium">
                  {cart.parkedCarts.length} held
                </span>
              )}
              {cart.items.length > 0 && (
                <button
                  type="button"
                  onClick={() => cart.parkCart()}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 touch-target"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Hold sale
                </button>
              )}
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
          </div>

          {isMixedCart && (
            <div role="status" aria-live="polite" className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700">
              Mixed sale · {retailLineCount} retail · {wholesaleLineCount} wholesale
              {packLineCount > 0 ? ` · ${packLineCount} by pack` : ''}
              {unitLineCount > 0 ? ` · ${unitLineCount} by unit` : ''}
            </div>
          )}

          <div className={`flex-1 overflow-y-auto px-3 md:px-4 pt-3 no-scrollbar ${cart.items.length > 0 ? 'pb-28 lg:pb-4' : 'pb-4'}`}>
            {cart.parkedCarts.length > 0 && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-900">
                  Held sales
                </p>
                <div className="space-y-2">
                  {cart.parkedCarts.map((parked) => (
                    <div key={parked.id} className="flex items-center gap-2 rounded-lg bg-white p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-gray-800">
                          {parked.items.length} item{parked.items.length === 1 ? '' : 's'} · {money(parked.total)}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {parked.items.some((item) => item.sale_mode === 'retail') && parked.items.some((item) => item.sale_mode === 'wholesale')
                            ? 'Mixed retail + wholesale'
                            : parked.items.some((item) => item.sale_mode === 'wholesale')
                              ? 'Wholesale'
                              : 'Retail'} · {new Date(parked.parkedAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const context = cart.resumeParkedCart(parked.id);
                          if (!context) return;
                          setSelectedLocationId(context.locationId || '');
                          setSaleMode(context.saleMode);
                          setUnitType(context.unitType || 'base');
                          setPosTab('cart');
                        }}
                        className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-2 text-xs font-semibold text-white touch-target"
                      >
                        <Play className="w-3 h-3" />
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => cart.removeParkedCart(parked.id)}
                        aria-label="Discard held sale"
                        className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 touch-target"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
                {cart.items.length > 0 && (
                  <p className="mt-2 text-[10px] text-amber-800">
                    Resuming a held sale will hold the current cart as well.
                  </p>
                )}
              </div>
            )}
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <ShoppingCart className="w-12 h-12 mb-3" />
                <p className="text-sm font-medium">Cart is empty</p>
                <p className="text-xs mt-1 text-center">Browse products or scan a barcode to begin</p>
                <button
                  type="button"
                  onClick={() => setPosTab('products')}
                  className="mt-4 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold touch-target lg:hidden"
                >
                  Browse products
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2 lg:hidden">
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

                <AlsoBuySuggestions
                  suggestions={alsoBuy}
                  onAdd={(productId) => {
                    const product = products.find((candidate) => candidate.id === productId);
                    if (product) void handleAddProduct(product);
                  }}
                />
                {cart.items.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white lg:bg-[var(--color-surface)] rounded-xl p-3 shadow-sm border border-emerald-50"
                  >
                    <div className="flex items-start gap-3">
                      <ProductImage src={item.image_url} alt="" size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="pos-product-name text-sm font-semibold leading-snug text-gray-900">
                              {item.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <p className="text-xs text-gray-500">
                                {money(item.unit_price)} / {item.unit_type === 'pack' ? 'pack' : 'unit'}
                              </p>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                item.price_label?.startsWith('Wholesale')
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {item.price_label || (item.sale_mode === 'wholesale' ? 'Wholesale' : 'Retail')}
                              </span>
                              <button
                                type="button"
                                onClick={() => void toggleItemSaleMode(item.id)}
                                disabled={!canWholesale && item.sale_mode === 'retail'}
                                aria-label={`Switch ${item.name} to ${item.sale_mode === 'retail' ? 'wholesale' : 'retail'} pricing`}
                                title={item.sale_mode === 'retail'
                                  ? canWholesale ? 'Switch this line to wholesale pricing' : 'Wholesale is disabled for this cashier'
                                  : 'Switch this line to retail pricing'}
                                className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Use {item.sale_mode === 'retail' ? 'wholesale' : 'retail'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleItemUnitType(item.id)}
                                aria-label={`Sell ${item.name} ${item.unit_type === 'pack' ? 'by unit' : 'by pack'}`}
                                className="rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
                              >
                                {item.unit_type === 'pack' ? 'By unit' : 'By pack'}
                              </button>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => cart.removeItem(item.id)}
                            aria-label={`Remove ${item.name} from cart`}
                            className="touch-target flex-shrink-0 rounded-lg p-1.5 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div role="group" aria-label={`Quantity for ${item.name}`} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDecrement(item.id)}
                              aria-label={`Remove or decrease ${item.name}`}
                              className="w-8 h-8 rounded-lg bg-surface-muted flex items-center justify-center touch-target hover:bg-border/60 transition-colors"
                            >
                              <Minus className="w-3.5 h-3.5 text-ink" />
                            </button>
                            <input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => void handleUpdateQuantity(item.id, parseInt(e.target.value) || 1)}
                              aria-label={`Quantity of ${item.name}`}
                              inputMode="numeric"
                              className="w-10 text-sm font-bold text-center bg-transparent border-b border-border focus:border-primary outline-none"
                              min="1"
                            />
                            <button
                              type="button"
                              onClick={() => void handleIncrement(item.id)}
                              aria-label={`Increase quantity of ${item.name}`}
                              className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center touch-target disabled:opacity-40"
                            >
                              <Plus className="w-3.5 h-3.5 text-primary" />
                            </button>
                          </div>
                          <div className="text-right min-w-[70px]">
                            <p className="text-[10px] font-medium text-gray-500">Line total</p>
                            <p className="text-sm font-bold text-gray-900">{money(item.subtotal)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desktop checkout docked in cart column */}
          {cart.items.length > 0 && (
            <div className="hidden lg:block flex-shrink-0 border-t border-emerald-100 p-4 bg-white">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                <span>{cartCount} item{cartCount === 1 ? '' : 's'} in this sale</span>
                {cart.discountAmount > 0 && (
                  <span className="font-semibold text-emerald-700">Saved {money(cart.discountAmount)}</span>
                )}
              </div>
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
                  <span className="font-bold text-base">{t('pos.checkout')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{money(cart.total)}</span>
                  <ChevronRight className="w-5 h-5" />
                </div>
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Mobile checkout bar — sits above bottom nav */}
      {cart.items.length > 0 && (
        <div className="lg:hidden absolute bottom-0 left-0 right-0 px-4 pb-3 bg-gradient-to-t from-[var(--color-surface)] via-[var(--color-surface)] to-transparent pt-4 z-30 pointer-events-none">
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
              <span className="font-bold text-lg">{t('pos.checkout')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">{money(cart.total)}</span>
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
        onConnectPrinter={() => onNavigate?.('devices')}
      />
    </div>
  );
}
