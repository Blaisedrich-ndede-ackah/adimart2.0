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
}

interface CartState {
  items: CartItem[];
  discountPercent: number;
  discountAmount: number;
  subtotal: number;
  total: number;

  addItemByBarcode: (barcode: string) => Promise<{ success: boolean; product?: LocalProduct; error?: string }>;
  addItem: (product: LocalProduct) => { success: boolean; error?: string };
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => { success: boolean; error?: string };
  incrementItem: (itemId: string) => { success: boolean; error?: string };
  decrementItem: (itemId: string) => void;
  setDiscount: (percent: number) => void;
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

function recalculate(items: CartItem[], discountPercent: number) {
  const subtotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  const discountAmount = Math.round((subtotal * discountPercent) / 100 * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  return { subtotal, discountAmount, total };
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  discountPercent: 0,
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
              available_stock: product.stock_level
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
        },
      ];
    }

    const calcs = recalculate(newItems, state.discountPercent);
    set({ items: newItems, ...calcs });
    return { success: true };
  },

  removeItem: (itemId: string) => {
    set(state => {
      const newItems = state.items.filter(i => i.id !== itemId);
      const calcs = recalculate(newItems, state.discountPercent);
      return { items: newItems, ...calcs };
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
    const calcs = recalculate(newItems, state.discountPercent);
    set({ items: newItems, ...calcs });
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
    const calcs = recalculate(newItems, state.discountPercent);
    set({ items: newItems, ...calcs });
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
      const calcs = recalculate(newItems, state.discountPercent);
      return { items: newItems, ...calcs };
    });
  },

  setDiscount: (percent: number) => {
    set(state => {
      const clampedPercent = Math.max(0, Math.min(100, percent));
      const calcs = recalculate(state.items, clampedPercent);
      return { discountPercent: clampedPercent, ...calcs };
    });
  },

  clearCart: () => {
    set({
      items: [],
      discountPercent: 0,
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

    // Verify stock is still available before completing sale
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

    // Save transaction
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

    // Save transaction items
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

    // DEDUCT STOCK
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

    // Capture current state for receipt before clearing
    const saleData = {
      receiptNumber,
      items: [...state.items],
      subtotal: state.subtotal,
      discount: state.discountAmount,
      total: state.total,
    };

    // Clear cart
    set({
      items: [],
      discountPercent: 0,
      discountAmount: 0,
      subtotal: 0,
      total: 0,
    });

    void triggerAutoSync('sale');

    return saleData;
  },
}));
