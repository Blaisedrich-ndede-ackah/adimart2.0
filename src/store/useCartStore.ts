import { create } from 'zustand';
import {
  db,
  generateId,
  generateReceiptNumber,
  LocalProduct,
  getProductByBarcode,
  getCurrentStoreId,
  type LocalLocation,
} from '@/lib/dexie';
import { triggerAutoSync } from '@/lib/sync';
import { resolveSalePrice, type SaleMode, type UnitType } from '@/lib/bulkPricing';
import { deductSaleStock, getLocationStock, reconcileProductStockBatches } from '@/lib/warehouse';

export interface CartItem {
  id: string;
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  /** Quantity in base units for stock deduction */
  base_quantity: number;
  unit_type: UnitType;
  sale_mode: SaleMode;
  pack_size: number;
  subtotal: number;
  available_stock: number;
  image_url?: string;
  price_label?: string;
}

export type CartDiscountKind = 'none' | 'percentage' | 'fixed';

interface CartState {
  items: CartItem[];
  locationId: string | null;
  saleMode: SaleMode;
  discountKind: CartDiscountKind;
  discountPercent: number;
  discountFixed: number;
  discountAmount: number;
  subtotal: number;
  total: number;

  setSaleContext: (locationId: string | null, saleMode: SaleMode) => void;
  addItemByBarcode: (barcode: string) => Promise<{ success: boolean; product?: LocalProduct; error?: string }>;
  addItem: (
    product: LocalProduct,
    opts?: { unitType?: UnitType; quantity?: number }
  ) => Promise<{ success: boolean; error?: string }>;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => Promise<{ success: boolean; error?: string }>;
  incrementItem: (itemId: string) => Promise<{ success: boolean; error?: string }>;
  decrementItem: (itemId: string) => void;
  setDiscount: (percent: number) => void;
  setDiscountPercent: (percent: number) => void;
  setDiscountFixed: (amount: number) => void;
  clearDiscount: () => void;
  clearCart: () => void;

  completeSale: (
    cashierId: string,
    cashierName: string,
    paymentMethod: 'cash' | 'split' | 'paystack',
    cashAmount?: number,
    paystackAmount?: number,
    paystackReference?: string
  ) => Promise<{ receiptNumber: string; items: CartItem[]; subtotal: number; discount: number; total: number }>;
}

function recalculate(
  items: CartItem[],
  discountKind: CartDiscountKind,
  discountPercent: number,
  discountFixed: number
) {
  const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  let kind = discountKind;
  let percent = Math.max(0, Math.min(100, discountPercent));
  let fixed = Math.max(0, discountFixed);
  let discountAmount = 0;

  if (kind === 'percentage') {
    discountAmount = Math.round((subtotal * percent) / 100 * 100) / 100;
  } else if (kind === 'fixed') {
    discountAmount = Math.min(Math.round(fixed * 100) / 100, subtotal);
    fixed = discountAmount;
    percent = subtotal > 0 ? Math.round((discountAmount / subtotal) * 10000) / 100 : 0;
  } else {
    percent = 0;
    fixed = 0;
    discountAmount = 0;
  }

  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  return {
    subtotal,
    discountAmount,
    total,
    discountKind: kind,
    discountPercent: percent,
    discountFixed: fixed,
  };
}

function withDiscount(state: CartState, items: CartItem[]) {
  return recalculate(items, state.discountKind, state.discountPercent, state.discountFixed);
}

function buildCartLine(
  product: LocalProduct,
  saleMode: SaleMode,
  unitType: UnitType,
  quantity: number,
  availableStock: number,
  existingId?: string
): CartItem {
  const priced = resolveSalePrice({ product, saleMode, quantity, unitType });
  const unitPrice = Math.round(priced.unitPrice * 100) / 100;
  return {
    id: existingId || generateId(),
    product_id: product.id,
    name: product.name,
    unit_price: unitPrice,
    quantity,
    base_quantity: priced.baseQuantity,
    unit_type: unitType,
    sale_mode: saleMode,
    pack_size: Math.max(1, Number(product.pack_size) || 1),
    subtotal: Math.round(unitPrice * quantity * 100) / 100,
    available_stock: availableStock,
    image_url: product.image_url,
    price_label: priced.label,
  };
}

async function stockAtContext(productId: string, locationId: string | null): Promise<number> {
  if (locationId) {
    return getLocationStock(productId, locationId);
  }
  const product = await db.products.get(productId);
  return product?.stock_level ?? 0;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  locationId: null,
  saleMode: 'retail',
  discountKind: 'none',
  discountPercent: 0,
  discountFixed: 0,
  discountAmount: 0,
  subtotal: 0,
  total: 0,

  setSaleContext: (locationId, saleMode) => {
    const state = get();
    if (state.locationId === locationId && state.saleMode === saleMode) return;
    set({ locationId, saleMode });
  },

  addItemByBarcode: async (barcode: string) => {
    const product = await getProductByBarcode(barcode);
    if (!product) {
      return { success: false, error: `No product found with barcode: ${barcode}` };
    }
    const result = await get().addItem(product);
    if (result.success) return { success: true, product };
    return { success: false, error: result.error, product };
  },

  addItem: async (product, opts = {}) => {
    const state = get();
    const unitType: UnitType = opts.unitType || 'base';
    const addQty = Math.max(1, Math.floor(opts.quantity || 1));
    const packSize = Math.max(1, Number(product.pack_size) || 1);
    const available = await stockAtContext(product.id, state.locationId);

    const existing = state.items.find(
      (i) =>
        i.product_id === product.id &&
        i.unit_type === unitType &&
        i.sale_mode === state.saleMode
    );
    const nextQty = (existing?.quantity || 0) + addQty;
    const nextBase =
      unitType === 'pack' ? nextQty * packSize : nextQty;

    if (available <= 0) {
      return { success: false, error: `${product.name} is out of stock at this location` };
    }
    if (nextBase > available) {
      return {
        success: false,
        error: `Only ${available} unit(s) of ${product.name} available here`,
      };
    }

    set((s) => {
      let items: CartItem[];
      if (existing) {
        const line = buildCartLine(
          product,
          s.saleMode,
          unitType,
          nextQty,
          available,
          existing.id
        );
        items = s.items.map((i) => (i.id === existing.id ? line : i));
      } else {
        items = [
          ...s.items,
          buildCartLine(product, s.saleMode, unitType, addQty, available),
        ];
      }
      return { ...withDiscount(s, items), items };
    });
    return { success: true };
  },

  removeItem: (itemId) => {
    set((state) => {
      const items = state.items.filter((i) => i.id !== itemId);
      return { ...withDiscount(state, items), items };
    });
  },

  updateQuantity: async (itemId, quantity) => {
    const qty = Math.floor(quantity);
    if (qty <= 0) {
      get().removeItem(itemId);
      return { success: true };
    }
    const state = get();
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return { success: false, error: 'Item not found' };
    const product = await db.products.get(item.product_id);
    if (!product) return { success: false, error: 'Product not found' };

    const available = await stockAtContext(product.id, state.locationId);
    const packSize = Math.max(1, Number(product.pack_size) || 1);
    const baseQty = item.unit_type === 'pack' ? qty * packSize : qty;
    if (baseQty > available) {
      return { success: false, error: `Only ${available} unit(s) available` };
    }

    set((s) => {
      const items = s.items.map((i) =>
        i.id === itemId
          ? buildCartLine(product, i.sale_mode, i.unit_type, qty, available, i.id)
          : i
      );
      return { ...withDiscount(s, items), items };
    });
    return { success: true };
  },

  incrementItem: async (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return { success: false, error: 'Item not found' };
    return get().updateQuantity(itemId, item.quantity + 1);
  },

  decrementItem: (itemId) => {
    const item = get().items.find((i) => i.id === itemId);
    if (!item) return;
    if (item.quantity <= 1) {
      get().removeItem(itemId);
      return;
    }
    void get().updateQuantity(itemId, item.quantity - 1);
  },

  setDiscount: (percent) => {
    get().setDiscountPercent(percent);
  },

  setDiscountPercent: (percent) => {
    set((state) => {
      const calcs = recalculate(state.items, 'percentage', percent, 0);
      return calcs;
    });
  },

  setDiscountFixed: (amount) => {
    set((state) => {
      const calcs = recalculate(state.items, 'fixed', 0, amount);
      return calcs;
    });
  },

  clearDiscount: () => {
    set((state) => {
      const calcs = recalculate(state.items, 'none', 0, 0);
      return calcs;
    });
  },

  clearCart: () => {
    set({
      items: [],
      discountKind: 'none',
      discountPercent: 0,
      discountFixed: 0,
      discountAmount: 0,
      subtotal: 0,
      total: 0,
    });
  },

  completeSale: async (
    cashierId,
    cashierName,
    paymentMethod,
    cashAmount = 0,
    paystackAmount = 0,
    paystackReference = ''
  ) => {
    const state = get();
    if (state.items.length === 0) throw new Error('Cart is empty');

    const storeId = await getCurrentStoreId();
    if (!storeId) throw new Error('No store selected');

    let locationId = state.locationId;
    if (!locationId) {
      const locations = await db.locations.where('store_id').equals(storeId).toArray();
      locationId =
        locations.find((l) => l.is_default === 1)?.id ||
        locations.find((l) => l.location_type === 'shop')?.id ||
        locations[0]?.id ||
        null;
    }
    if (!locationId) throw new Error('No sale location configured');

    // Inventory may have stock_level without matching batches (legacy edits).
    // Reconcile first so FEFO deduction and product.stock_level stay in sync.
    for (const item of state.items) {
      await reconcileProductStockBatches(storeId, item.product_id, locationId);
    }

    for (const item of state.items) {
      const available = await getLocationStock(item.product_id, locationId);
      if (available < item.base_quantity) {
        throw new Error(
          `Insufficient stock for "${item.name}". Only ${available} available at this location.`
        );
      }
    }

    const txnId = generateId();
    const receiptNumber = generateReceiptNumber();
    const now = new Date().toISOString();

    await db.transactions.add({
      id: txnId,
      store_id: storeId,
      receipt_number: receiptNumber,
      cashier_id: cashierId,
      cashier_name: cashierName,
      total_amount: state.total,
      discount_applied: state.discountAmount,
      payment_method: paymentMethod,
      cash_amount: paymentMethod === 'cash' ? state.total : cashAmount,
      paystack_amount: paymentMethod === 'paystack' ? state.total : paystackAmount,
      paystack_reference: paystackReference,
      status: 'completed',
      location_id: locationId,
      sale_mode: state.saleMode,
      created_at: now,
      synced: 0,
    });

    const txnItems = state.items.map((item) => ({
      id: generateId(),
      store_id: storeId,
      transaction_id: txnId,
      product_id: item.product_id,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      unit_type: item.unit_type,
      pack_size: item.pack_size,
      base_quantity: item.base_quantity,
      synced: 0,
    }));

    await db.transaction_items.bulkAdd(txnItems);

    for (const item of state.items) {
      await deductSaleStock({
        storeId,
        productId: item.product_id,
        locationId,
        baseQty: item.base_quantity,
        userId: cashierId,
        transactionId: txnId,
      });
    }

    const saleData = {
      receiptNumber,
      items: [...state.items],
      subtotal: state.subtotal,
      discount: state.discountAmount,
      total: state.total,
    };

    set({
      items: [],
      discountKind: 'none',
      discountPercent: 0,
      discountFixed: 0,
      discountAmount: 0,
      subtotal: 0,
      total: 0,
    });

    void triggerAutoSync('sale');
    return saleData;
  },
}));

export type { LocalLocation };
