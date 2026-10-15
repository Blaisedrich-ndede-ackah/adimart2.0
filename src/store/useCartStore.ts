import { create } from 'zustand';
import {
  db,
  generateId,
  generateReceiptNumber,
  LocalProduct,
  getProductByBarcode,
  getCurrentStoreId,
  type LocalLocation,
  type LocalCustomer,
} from '@/lib/dexie';
import { triggerPushSync } from '@/lib/sync';
import { resolveSalePrice, type SaleMode, type UnitType } from '@/lib/bulkPricing';
import type { StockChange } from '@/lib/stockEvents';
import { moneyEquals, roundMoney, toMoneyAmount } from '@/lib/money';
import { formatStoreMoneyNow } from '@/lib/currency';
import {
  deductSaleStockForItems,
  getLocationStock,
  getLocationStockMap,
  getStoreBatchStockMap,
  isWarehouseLocation,
  reconcileProductStockBatches,
  toQty,
} from '@/lib/warehouse';
import {
  getOtherChargeCategory,
  otherChargesTotal,
  serializeOtherCharges,
  type OtherCharge,
  type OtherChargeCategoryId,
} from '@/lib/otherCharges';
import { isManualPaymentMethod, type PaymentMethod } from '@/lib/paymentMethods';

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
  image_url?: string;
  price_label?: string;
}

export type CartDiscountKind = 'none' | 'percentage' | 'fixed';

export interface ParkedCart {
  id: string;
  items: CartItem[];
  locationId: string | null;
  saleMode: SaleMode;
  discountKind: CartDiscountKind;
  discountPercent: number;
  discountFixed: number;
  discountAmount: number;
  otherCharges: OtherCharge[];
  otherChargesTotal: number;
  subtotal: number;
  total: number;
  parkedAt: string;
}

interface CartState {
  items: CartItem[];
  parkedCarts: ParkedCart[];
  locationId: string | null;
  saleMode: SaleMode;
  discountKind: CartDiscountKind;
  discountPercent: number;
  discountFixed: number;
  discountAmount: number;
  otherCharges: OtherCharge[];
  otherChargesTotal: number;
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
  setOtherCharge: (categoryId: OtherChargeCategoryId, amount: number, customLabel?: string) => void;
  removeOtherCharge: (categoryId: OtherChargeCategoryId) => void;
  clearOtherCharges: () => void;
  clearCart: () => void;
  parkCart: () => void;
  resumeParkedCart: (id: string) => { locationId: string | null; saleMode: SaleMode } | null;
  removeParkedCart: (id: string) => void;
  clearParkedCarts: () => void;

  completeSale: (
    cashierId: string,
    cashierName: string,
    paymentMethod: PaymentMethod,
    cashAmount?: number,
    paystackAmount?: number,
    paystackReference?: string,
    paymentReference?: string,
    customerId?: string,
    walletAmount?: number
  ) => Promise<{
    receiptNumber: string;
    items: CartItem[];
    subtotal: number;
    discount: number;
    otherCharges: OtherCharge[];
    otherChargesTotal: number;
    total: number;
    customerBalance: number;
    stockChanges: StockChange[];
    locationId: string;
  }>;
}

function recalculate(
  items: CartItem[],
  discountKind: CartDiscountKind,
  discountPercent: number,
  discountFixed: number,
  otherCharges: OtherCharge[]
) {
  const subtotal = roundMoney(items.reduce((sum, i) => sum + i.subtotal, 0));
  let kind = discountKind;
  let percent = Math.max(0, Math.min(100, discountPercent));
  let fixed = Math.max(0, discountFixed);
  let discountAmount = 0;

  if (kind === 'percentage') {
    discountAmount = roundMoney((subtotal * percent) / 100);
  } else if (kind === 'fixed') {
    discountAmount = Math.min(roundMoney(fixed), subtotal);
    fixed = discountAmount;
    percent = subtotal > 0 ? roundMoney((discountAmount / subtotal) * 100) : 0;
  } else {
    percent = 0;
    fixed = 0;
    discountAmount = 0;
  }

  const chargesTotal = otherChargesTotal(otherCharges);
  const total = roundMoney(subtotal - discountAmount + chargesTotal);
  return {
    subtotal,
    discountAmount,
    otherCharges,
    otherChargesTotal: chargesTotal,
    total,
    discountKind: kind,
    discountPercent: percent,
    discountFixed: fixed,
  };
}

function withDiscount(state: CartState, items: CartItem[]) {
  return recalculate(
    items,
    state.discountKind,
    state.discountPercent,
    state.discountFixed,
    state.otherCharges
  );
}

function buildCartLine(
  product: LocalProduct,
  saleMode: SaleMode,
  unitType: UnitType,
  quantity: number,
  existingId?: string
): CartItem {
  const priced = resolveSalePrice({ product, saleMode, quantity, unitType });
  const unitPrice = roundMoney(priced.unitPrice);
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
    subtotal: roundMoney(unitPrice * quantity),
    image_url: product.image_url,
    price_label: priced.label,
  };
}

async function stockAtContext(productId: string, locationId: string | null): Promise<number> {
  const product = await db.products.get(productId);
  if (!product) return 0;

  if (locationId && (await isWarehouseLocation(locationId))) {
    return getLocationStock(productId, locationId);
  }

  const shopMap = await getStoreBatchStockMap(product.store_id);
  const shopQty = shopMap[productId];
  if (typeof shopQty === 'number' && shopQty > 0) return shopQty;

  const allBatches = await db.stock_batches.where('product_id').equals(productId).toArray();
  const batchTotal = allBatches.reduce((sum, b) => sum + toQty(b.quantity), 0);
  if (batchTotal > 0) return shopQty || 0;

  if (allBatches.length === 0 && toQty(product.stock_level) > 0) {
    await reconcileProductStockBatches(product.store_id, productId, locationId);
    const after = await getStoreBatchStockMap(product.store_id);
    return after[productId] || toQty(product.stock_level);
  }

  return shopQty || 0;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  parkedCarts: [],
  locationId: null,
  saleMode: 'retail',
  discountKind: 'none',
  discountPercent: 0,
  discountFixed: 0,
  discountAmount: 0,
  otherCharges: [],
  otherChargesTotal: 0,
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
      return { success: false, error: `${product.name} is out of stock` };
    }
    if (nextBase > available) {
      return {
        success: false,
        error: `Not enough stock of ${product.name} to add more`,
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
          existing.id
        );
        items = s.items.map((i) => (i.id === existing.id ? line : i));
      } else {
        items = [
          ...s.items,
          buildCartLine(product, s.saleMode, unitType, addQty),
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
      return { success: false, error: 'Not enough stock to add more of this item' };
    }

    set((s) => {
      const items = s.items.map((i) =>
        i.id === itemId
          ? buildCartLine(product, i.sale_mode, i.unit_type, qty, i.id)
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
      const calcs = recalculate(state.items, 'percentage', percent, 0, state.otherCharges);
      return calcs;
    });
  },

  setDiscountFixed: (amount) => {
    set((state) => {
      const calcs = recalculate(state.items, 'fixed', 0, amount, state.otherCharges);
      return calcs;
    });
  },

  clearDiscount: () => {
    set((state) => {
      const calcs = recalculate(state.items, 'none', 0, 0, state.otherCharges);
      return calcs;
    });
  },

  setOtherCharge: (categoryId, amount, customLabel) => {
    const category = getOtherChargeCategory(categoryId);
    if (!category) return;
    const value = toMoneyAmount(amount);
    set((state) => {
      const without = state.otherCharges.filter((c) => c.id !== categoryId);
      const nextCharges =
        value > 0
          ? [
              ...without,
              {
                id: category.id,
                label:
                  category.id === 'other'
                    ? (customLabel || '').trim() || category.label
                    : category.label,
                amount: roundMoney(value),
              },
            ]
          : without;
      return recalculate(
        state.items,
        state.discountKind,
        state.discountPercent,
        state.discountFixed,
        nextCharges
      );
    });
  },

  removeOtherCharge: (categoryId) => {
    set((state) => {
      const nextCharges = state.otherCharges.filter((c) => c.id !== categoryId);
      return recalculate(
        state.items,
        state.discountKind,
        state.discountPercent,
        state.discountFixed,
        nextCharges
      );
    });
  },

  clearOtherCharges: () => {
    set((state) =>
      recalculate(
        state.items,
        state.discountKind,
        state.discountPercent,
        state.discountFixed,
        []
      )
    );
  },

  clearCart: () => {
    set({
      items: [],
      discountKind: 'none',
      discountPercent: 0,
      discountFixed: 0,
      discountAmount: 0,
      otherCharges: [],
      otherChargesTotal: 0,
      subtotal: 0,
      total: 0,
    });
  },

  parkCart: () => {
    const state = get();
    if (state.items.length === 0) return;
    const parked: ParkedCart = {
      id: generateId(),
      items: state.items,
      locationId: state.locationId,
      saleMode: state.saleMode,
      discountKind: state.discountKind,
      discountPercent: state.discountPercent,
      discountFixed: state.discountFixed,
      discountAmount: state.discountAmount,
      otherCharges: state.otherCharges,
      otherChargesTotal: state.otherChargesTotal,
      subtotal: state.subtotal,
      total: state.total,
      parkedAt: new Date().toISOString(),
    };
    set((current) => ({ parkedCarts: [...current.parkedCarts, parked] }));
    get().clearCart();
  },

  resumeParkedCart: (id) => {
    const state = get();
    const parked = state.parkedCarts.find((cart) => cart.id === id);
    if (!parked) return null;

    const parkedCarts = state.parkedCarts.filter((cart) => cart.id !== id);
    if (state.items.length > 0) {
      parkedCarts.push({
        id: generateId(),
        items: state.items,
        locationId: state.locationId,
        saleMode: state.saleMode,
        discountKind: state.discountKind,
        discountPercent: state.discountPercent,
        discountFixed: state.discountFixed,
        discountAmount: state.discountAmount,
        otherCharges: state.otherCharges,
        otherChargesTotal: state.otherChargesTotal,
        subtotal: state.subtotal,
        total: state.total,
        parkedAt: new Date().toISOString(),
      });
    }

    set({
      ...recalculate(
        parked.items,
        parked.discountKind,
        parked.discountPercent,
        parked.discountFixed,
        parked.otherCharges
      ),
      items: parked.items,
      locationId: parked.locationId,
      saleMode: parked.saleMode,
      parkedCarts,
    });
    return { locationId: parked.locationId, saleMode: parked.saleMode };
  },

  removeParkedCart: (id) => {
    set((state) => ({ parkedCarts: state.parkedCarts.filter((cart) => cart.id !== id) }));
  },

  clearParkedCarts: () => set({ parkedCarts: [] }),

  completeSale: async (
    cashierId,
    cashierName,
    paymentMethod,
    cashAmount = 0,
    paystackAmount = 0,
    paystackReference = '',
    paymentReference = '',
    customerId = '',
    walletAmount = 0
  ) => {
    const state = get();
    if (state.items.length === 0) throw new Error('Cart is empty');

    const storeId = await getCurrentStoreId();
    if (!storeId) throw new Error('No store selected');

    const store = await db.stores.get(storeId);
    const discountCap = store?.discount_cap_percentage ?? 10;
    const cashierCanDiscount = (store?.cashier_can_discount ?? 1) === 1;
    const cashier = await db.users.get(cashierId);
    const isOwner = cashier?.role === 'owner';

    // Recompute totals from lines so persisted sale matches cart math
    const priced = recalculate(
      state.items,
      state.discountKind,
      state.discountPercent,
      state.discountFixed,
      state.otherCharges
    );

    if (!isOwner && !cashierCanDiscount && priced.discountAmount > 0) {
      throw new Error('Discount is disabled for cashiers. Ask the store owner.');
    }
    if (priced.discountAmount > 0) {
      const capAmount = roundMoney((priced.subtotal * discountCap) / 100);
      if (priced.discountAmount > capAmount + 0.009 && !isOwner) {
        throw new Error(
          `Discount exceeds the store cap of ${discountCap}% (max ${formatStoreMoneyNow(capAmount)}).`
        );
      }
    }

    let cash = toMoneyAmount(cashAmount);
    let paystack = toMoneyAmount(paystackAmount);
    const wallet = toMoneyAmount(walletAmount || 0);
    let manualPayment = 0;
    const recordedPaymentReference = paymentReference.trim();
    if (paymentMethod === 'cash') {
      cash = priced.total;
      paystack = 0;
    } else if (paymentMethod === 'paystack') {
      cash = 0;
      paystack = priced.total;
    } else if (isManualPaymentMethod(paymentMethod)) {
      cash = 0;
      paystack = 0;
      manualPayment = priced.total;
    } else if (paymentMethod === 'credit') {
      cash = 0;
      paystack = 0;
      manualPayment = 0;
      if (!customerId) throw new Error('Select a registered customer for a credit sale.');
    } else if (paymentMethod === 'wallet') {
      cash = 0;
      paystack = 0;
      if (!customerId) throw new Error('Select a registered customer to use store credit.');
      if (!moneyEquals(wallet, priced.total)) {
        throw new Error('Store credit must cover the full sale. Use wallet plus cash for a partial balance.');
      }
    } else {
      // split
      if (wallet > 0 && !customerId) throw new Error('Select a registered customer to use store credit.');
      if (!moneyEquals(cash + paystack + wallet, priced.total)) {
        throw new Error(
          `Split payment must equal total. Cash ${formatStoreMoneyNow(cash)} + MoMo ${formatStoreMoneyNow(paystack)} + store credit ${formatStoreMoneyNow(wallet)} ≠ ${formatStoreMoneyNow(priced.total)}.`
        );
      }
    }
    if (isManualPaymentMethod(paymentMethod)) {
      if (!recordedPaymentReference) throw new Error('Payment reference is required for manual payments.');
      if (recordedPaymentReference.length > 100) throw new Error('Payment reference must be 100 characters or fewer.');
    }
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

    // Aggregate needed qty per product (packs + duplicate lines)
    const needByProduct = new Map<string, { qty: number; name: string }>();
    for (const item of state.items) {
      const prev = needByProduct.get(item.product_id);
      needByProduct.set(item.product_id, {
        qty: (prev?.qty || 0) + item.base_quantity,
        name: item.name,
      });
    }

    // Verify location stock — do not invent units from a stale catalog
    const stockMap = await getLocationStockMap(storeId, locationId);
    for (const [productId, need] of needByProduct) {
      const available = stockMap[productId] || 0;
      if (available >= need.qty) continue;
      // Only migrates when the product has zero batch rows; otherwise syncs catalog down
      await reconcileProductStockBatches(storeId, productId, locationId);
      const afterMap = await getLocationStockMap(storeId, locationId);
      const after = afterMap[productId] || 0;
      if (after < need.qty) {
        throw new Error(`Insufficient stock for "${need.name}".`);
      }
    }

    const txnId = generateId();
    const receiptNumber = generateReceiptNumber();
    const now = new Date().toISOString();
    let customerBalance = priced.total;

    await db.transaction(
      'rw',
      db.transactions,
      db.transaction_items,
      db.customers,
      db.customer_wallet_transactions,
      async () => {
        let creditCustomer: LocalCustomer | undefined;
        let payingCustomer: LocalCustomer | undefined;
        if (paymentMethod === 'credit' || wallet > 0) {
          creditCustomer = await db.customers.get(customerId || '');
          if (!creditCustomer || creditCustomer.store_id !== storeId || creditCustomer.is_active !== 1) {
            throw new Error('Select an active registered customer for this payment.');
          }
          payingCustomer = creditCustomer;
          if (wallet > 0) {
            const availableWallet = toMoneyAmount(creditCustomer.wallet_balance || 0);
            if (wallet > availableWallet) {
              throw new Error(`Customer store credit is ${formatStoreMoneyNow(availableWallet)}.`);
            }
            const balanceAfter = toMoneyAmount(availableWallet - wallet);
            await db.customers.update(creditCustomer.id, {
              wallet_balance: balanceAfter,
              updated_at: now,
              synced: 0,
            });
            await db.customer_wallet_transactions.add({
              id: generateId(),
              store_id: storeId,
              customer_id: creditCustomer.id,
              type: 'sale_debit',
              amount: wallet,
              balance_after: balanceAfter,
              transaction_id: txnId,
              description: `Store credit used for sale ${receiptNumber}`,
              created_by: cashierName,
              created_at: now,
              synced: 0,
            });
          }
        }
        await db.transactions.add({
          id: txnId,
          store_id: storeId,
          receipt_number: receiptNumber,
          cashier_id: cashierId,
          cashier_name: cashierName,
          total_amount: priced.total,
          discount_applied: priced.discountAmount,
          other_charges_json: serializeOtherCharges(priced.otherCharges),
          other_charges_total: priced.otherChargesTotal,
          payment_method: paymentMethod,
          cash_amount: cash,
          paystack_amount: paystack,
          paystack_reference: paymentMethod === 'paystack' || paymentMethod === 'split' ? paystackReference : '',
          manual_payment_amount: manualPayment,
          wallet_amount: wallet,
          payment_reference: isManualPaymentMethod(paymentMethod) ? recordedPaymentReference : '',
          customer_id: payingCustomer?.id || null,
          customer_name: payingCustomer?.name || '',
          customer_phone: payingCustomer?.phone || '',
          credit_paid_amount: 0,
          credit_balance: paymentMethod === 'credit' ? priced.total : 0,
          status: 'completed',
          location_id: locationId,
          sale_mode: state.saleMode,
          created_at: now,
          updated_at: now,
          synced: 0,
        });

        await db.transaction_items.bulkAdd(
          state.items.map((item) => ({
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
          }))
        );
        if (paymentMethod === 'credit' && creditCustomer) {
          const existingCreditSales = await db.transactions
            .where('customer_id')
            .equals(creditCustomer.id)
            .toArray();
          customerBalance = toMoneyAmount(
            creditCustomer.opening_balance_remaining +
            existingCreditSales.reduce(
              (sum, transaction) => sum + toMoneyAmount(transaction.credit_balance || 0),
              0
            )
          );
        }
      }
    );

    let stockChanges;
    try {
      stockChanges = await deductSaleStockForItems({
        storeId,
        locationId,
        userId: cashierId,
        transactionId: txnId,
        reason: 'sale',
        items: state.items.map((item) => ({
          productId: item.product_id,
          baseQty: item.base_quantity,
          name: item.name,
        })),
      });
    } catch (err) {
      // Roll back the sale so we never sync revenue without a stock movement
      const items = await db.transaction_items.where('transaction_id').equals(txnId).toArray();
      await db.transaction(
        'rw',
        [db.transaction_items, db.transactions, db.customer_wallet_transactions, db.customers],
        async () => {
          await Promise.all(items.map((item) => db.transaction_items.delete(item.id)));
          await db.transactions.delete(txnId);
          if (wallet > 0 && customerId) {
            const walletEntries = await db.customer_wallet_transactions
              .where('transaction_id')
              .equals(txnId)
              .toArray();
            const restoredAmount = walletEntries.reduce((sum, entry) => sum + entry.amount, 0);
            const customer = await db.customers.get(customerId);
            if (customer) {
              await db.customers.update(customer.id, {
                wallet_balance: toMoneyAmount((customer.wallet_balance || 0) + restoredAmount),
                updated_at: new Date().toISOString(),
                synced: 0,
              });
            }
            await Promise.all(walletEntries.map((entry) => db.customer_wallet_transactions.delete(entry.id)));
          }
        }
      );
      throw err;
    }

    const saleData = {
      receiptNumber,
      items: [...state.items],
      subtotal: priced.subtotal,
      discount: priced.discountAmount,
      otherCharges: [...priced.otherCharges],
      otherChargesTotal: priced.otherChargesTotal,
      total: priced.total,
      customerBalance,
      stockChanges,
      locationId,
    };

    set({
      items: [],
      discountKind: 'none',
      discountPercent: 0,
      discountFixed: 0,
      discountAmount: 0,
      otherCharges: [],
      otherChargesTotal: 0,
      subtotal: 0,
      total: 0,
    });

    // Push-only sync (no cloud pull) so checkout stays snappy
    window.setTimeout(() => {
      void triggerPushSync('sale');
    }, 0);
    return saleData;
  },
}));

export type { LocalLocation };
