import { create } from 'zustand';
import { db, generateId, generateReceiptNumber, LocalProduct, getProductByBarcode, getCurrentStoreId } from '@/lib/dexie';
import { triggerAutoSync } from '@/lib/sync';

export interface CartItem {
  id: string;
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  available_stock: number;
  image_url?: string;
}

export type CartDiscountKind = 'none' | 'percentage' | 'fixed';

interface CartState {
  items: CartItem[];
  discountKind: CartDiscountKind;
  discountPercent: number;
  discountFixed: number;
  discountAmount: number;
  subtotal: number;
  total: number;

  addItemByBarcode: (barcode: string) => Promise<{ success: boolean; product?: LocalProduct; error?: string }>;
  addItem: (product: LocalProduct) => { success: boolean; error?: string };
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => { success: boolean; error?: string };
  incrementItem: (itemId: string) => { success: boolean; error?: string };
  decrementItem: (itemId: string) => void;
  /** @deprecated Prefer setDiscountPercent — kept for call-site compatibility */
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

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  discountKind: 'none',
  discountPercent: 0,
  discountFixed: 0,
  discountAmount: 0,
  subtotal: 0,
  total: 0,

  addItemByBarcode: async (barcode: string) => {
    const product = await getProductByBarcode(barcode);

    if (!product) {
      return { success: false, error: `No product found with barcode: ${barcode}` };
    }

    const existingItem = get().items.find(i => i.product_id === product.id);
    const currentQtyInCart = existingItem?.quantity || 0;

    if (product.stock_level <= 0) {
      return { success: false, error: `${product.name} is out of stock`, product };
    }

    if (currentQtyInCart >= product.stock_level) {
      return { success: false, error: `Only ${product.stock_level} ${product.name} available in stock`, product };
    }

    const result = get().addItem(product);
    if (result.success) {
      return { success: true, product };
    }
    return { success: false, error: result.error, product };
  },

  addItem: (product: LocalProduct) => {
    const state = get();
    const existing = state.items.find(i => i.product_id === product.id);
    const currentQtyInCart = existing?.quantity || 0;

    if (product.stock_level <= 0) {
      return { success: false, error: `${product.name} is out of stock` };
    }

    if (currentQtyInCart >= product.stock_level) {
      return { success: false, error: `Only ${product.stock_level} ${product.name} available` };
    }

    let newItems: CartItem[];

    if (existing) {
      newItems = state.items.map(i =>
        i.product_id === product.id
          ? {
              ...i,
              quantity: i.quantity + 1,
              subtotal: (i.quantity + 1) * i.unit_price,
              available_stock: product.stock_level,
              image_url: product.image_url || i.image_url || '',
            }
          : i
      );
    } else {
      newItems = [
        ...state.items,
        {
          id: generateId(),
          product_id: product.id,
          name: product.name,
          unit_price: product.selling_price,
          quantity: 1,
          subtotal: product.selling_price,
          available_stock: product.stock_level,
          image_url: product.image_url || '',
        },
      ];
    }

    set({ items: newItems, ...withDiscount(state, newItems) });
    return { success: true };
  },

  removeItem: (itemId: string) => {
    set(state => {
      const newItems = state.items.filter(i => i.id !== itemId);
      return { items: newItems, ...withDiscount(state, newItems) };
    });
  },

  updateQuantity: (itemId: string, quantity: number) => {
    if (quantity < 1) {
      return { success: false, error: 'Quantity must be at least 1' };
    }

    const state = get();
    const item = state.items.find(i => i.id === itemId);

    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    if (quantity > item.available_stock) {
      return { success: false, error: `Only ${item.available_stock} available in stock` };
    }

    const newItems = state.items.map(i =>
      i.id === itemId
        ? { ...i, quantity, subtotal: quantity * i.unit_price }
        : i
    );
    set({ items: newItems, ...withDiscount(state, newItems) });
    return { success: true };
  },

  incrementItem: (itemId: string) => {
    const state = get();
    const item = state.items.find(i => i.id === itemId);

    if (!item) {
      return { success: false, error: 'Item not found' };
    }

    if (item.quantity >= item.available_stock) {
      return { success: false, error: `Only ${item.available_stock} available in stock` };
    }

    const newItems = state.items.map(i =>
      i.id === itemId
        ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unit_price }
        : i
    );
    set({ items: newItems, ...withDiscount(state, newItems) });
    return { success: true };
  },

  decrementItem: (itemId: string) => {
    set(state => {
      const item = state.items.find(i => i.id === itemId);
      if (!item || item.quantity <= 1) return state;

      const newItems = state.items.map(i =>
        i.id === itemId
          ? { ...i, quantity: i.quantity - 1, subtotal: (i.quantity - 1) * i.unit_price }
          : i
      );
      return { items: newItems, ...withDiscount(state, newItems) };
    });
  },

  setDiscount: (percent: number) => {
    get().setDiscountPercent(percent);
  },

  setDiscountPercent: (percent: number) => {
    set(state => {
      const calcs = recalculate(state.items, 'percentage', percent, 0);
      return calcs;
    });
  },

  setDiscountFixed: (amount: number) => {
    set(state => {
      const calcs = recalculate(state.items, 'fixed', 0, amount);
      return calcs;
    });
  },

  clearDiscount: () => {
    set(state => {
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

  completeSale: async (cashierId, cashierName, paymentMethod, cashAmount = 0, paystackAmount = 0, paystackReference = '') => {
    const state = get();
    if (state.items.length === 0) throw new Error('Cart is empty');

    const storeId = await getCurrentStoreId();
    if (!storeId) throw new Error('No store selected');

    for (const item of state.items) {
      const product = await db.products.get(item.product_id);
      if (!product) {
        throw new Error(`Product "${item.name}" no longer exists`);
      }
      if (product.stock_level < item.quantity) {
        throw new Error(`Insufficient stock for "${item.name}". Only ${product.stock_level} available.`);
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
      created_at: now,
      synced: 0,
    });

    const txnItems = state.items.map(item => ({
      id: generateId(),
      store_id: storeId,
      transaction_id: txnId,
      product_id: item.product_id,
      product_name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      synced: 0,
    }));

    await db.transaction_items.bulkAdd(txnItems);

    for (const item of state.items) {
      const product = await db.products.get(item.product_id);
      if (product) {
        const newStock = Math.max(0, product.stock_level - item.quantity);
        await db.products.update(item.product_id, {
          stock_level: newStock,
          updated_at: now,
          synced: 0,
        });
      }
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
