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
import { getAvailableSaleModes, resolveSalePrice, type SaleMode, type UnitType } from '@/lib/bulkPricing';
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
import { productAllowsDecimal, quantityForProduct, roundStockQtyAllowZero } from '@/lib/measure';
import { applyPromotionPricing } from '@/lib/promotions';
import { capRedeemPoints, pointsEarned, pointsValue } from '@/lib/loyaltyMath';
import { creditDueDate, evaluateCreditLimit, normalizeCreditLimitAction } from '@/lib/creditMath';
import { isCountedSale } from '@/lib/saleStatus';
import { findVariantByCode, variantLabel, variantSellingPrice } from '@/lib/variants';
import type { LocalProductVariant } from '@/lib/dexie';
import { recordActivity } from '@/lib/activityLog';

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
  variant_id?: string;
  measure_unit?: string;
  allow_decimal?: number;
  category?: string;
  list_unit_price?: number;
  promotion_label?: string;
  promotion_discount?: number;
}

export type CartDiscountKind = 'none' | 'percentage' | 'fixed';

export interface ParkedCart {
  id: string;
  items: CartItem[];
  locationId: string | null;
  saleMode: SaleMode;
  /** Unit choice for the next item. Existing lines keep their own unit type. */
  unitType?: UnitType;
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
  /** Applies only to items added after this point. */
  unitType: UnitType;
  discountKind: CartDiscountKind;
  discountPercent: number;
  discountFixed: number;
  discountAmount: number;
  otherCharges: OtherCharge[];
  otherChargesTotal: number;
  subtotal: number;
  total: number;
  couponCode: string;
  pointsToRedeem: number;
  loyaltyCustomerId: string;
  loyaltyRedeemValue: number;
  promotionDiscount: number;
  promotionSummary: string;

  setSaleContext: (locationId: string | null, saleMode: SaleMode, unitType?: UnitType) => void;
  setCouponCode: (code: string) => Promise<string | null>;
  setLoyaltySelection: (customerId: string, points: number) => Promise<void>;
  addItemByBarcode: (
    barcode: string,
    opts?: { unitType?: UnitType; saleMode?: SaleMode }
  ) => Promise<{ success: boolean; product?: LocalProduct; error?: string }>;
  addItem: (
    product: LocalProduct,
    opts?: { unitType?: UnitType; quantity?: number; saleMode?: SaleMode; variant?: LocalProductVariant }
  ) => Promise<{ success: boolean; error?: string }>;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => Promise<{ success: boolean; error?: string }>;
  incrementItem: (itemId: string) => Promise<{ success: boolean; error?: string }>;
  decrementItem: (itemId: string) => void;
  setItemSaleMode: (itemId: string, saleMode: SaleMode) => Promise<{ success: boolean; error?: string }>;
  setItemUnitType: (itemId: string, unitType: UnitType) => Promise<{ success: boolean; error?: string }>;
  setDiscount: (percent: number) => void;
  setDiscountPercent: (percent: number) => void;
  setDiscountFixed: (amount: number) => void;
  clearDiscount: () => void;
  setOtherCharge: (categoryId: OtherChargeCategoryId, amount: number, customLabel?: string) => void;
  removeOtherCharge: (categoryId: OtherChargeCategoryId) => void;
  clearOtherCharges: () => void;
  clearCart: () => void;
  parkCart: () => void;
  resumeParkedCart: (id: string) => { locationId: string | null; saleMode: SaleMode; unitType: UnitType } | null;
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
    promotionDiscount?: number;
    promotionSummary?: string;
    couponCode?: string;
    loyaltyPointsEarned?: number;
    loyaltyPointsRedeemed?: number;
    loyaltyRedeemAmount?: number;
  }>;
}

function recalculate(
  items: CartItem[],
  discountKind: CartDiscountKind,
  discountPercent: number,
  discountFixed: number,
  otherCharges: OtherCharge[],
  loyaltyDiscount = 0
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
  const beforeLoyalty = roundMoney(subtotal - discountAmount);
  const loyalty = Math.min(roundMoney(Math.max(0, loyaltyDiscount)), Math.max(0, beforeLoyalty));
  const total = roundMoney(subtotal - discountAmount - loyalty + chargesTotal);
  return {
    subtotal,
    discountAmount,
    loyaltyDiscount: loyalty,
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
    state.otherCharges,
    pointsValue(state.pointsToRedeem || 0, state.loyaltyRedeemValue || 0)
  );
}

async function applyDeals(items: CartItem[], couponCode: string): Promise<{
  items: CartItem[];
  promotionDiscount: number;
  promotionSummary: string;
}> {
  const storeId = await getCurrentStoreId();
  if (!storeId || items.length === 0) {
    return { items, promotionDiscount: 0, promotionSummary: '' };
  }
  const promos = await db.store_promotions.where('store_id').equals(storeId).and((row) => row.is_active === 1).toArray();
  const applied = applyPromotionPricing(
    items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      category: item.category,
      quantity: item.quantity,
      list_unit_price: item.list_unit_price ?? item.unit_price,
    })),
    promos,
    couponCode
  );
  const byId = new Map(applied.lines.map((line) => [line.id, line]));
  return {
    promotionDiscount: applied.promotionDiscount,
    promotionSummary: applied.promotionSummary,
    items: items.map((item) => {
      const priced = byId.get(item.id);
      if (!priced) return item;
      return {
        ...item,
        list_unit_price: priced.list_unit_price,
        unit_price: priced.unit_price,
        subtotal: priced.subtotal,
        promotion_discount: priced.promotion_discount,
        promotion_label: priced.promotion_label,
      };
    }),
  };
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
    measure_unit: product.unit || 'pcs',
    allow_decimal: productAllowsDecimal(product) ? 1 : 0,
    category: product.category || '',
    list_unit_price: unitPrice,
    promotion_discount: 0,
    promotion_label: '',
  };
}

function saleModeForProduct(product: LocalProduct, requested: SaleMode): SaleMode {
  return requested === 'wholesale' && getAvailableSaleModes(product).includes('wholesale')
    ? 'wholesale'
    : 'retail';
}

function unitTypeForProduct(product: LocalProduct, requested: UnitType): UnitType {
  const packSize = Math.max(1, Number(product.pack_size) || 1);
  return requested === 'pack' && packSize > 1 ? 'pack' : 'base';
}

async function changeCartLine(
  get: () => CartState,
  set: (partial: Partial<CartState>) => void,
  itemId: string,
  change: { saleMode?: SaleMode; unitType?: UnitType }
): Promise<{ success: boolean; error?: string }> {
  const state = get();
  const item = state.items.find((current) => current.id === itemId);
  if (!item) return { success: false, error: 'Item not found' };
  const product = await db.products.get(item.product_id);
  if (!product) return { success: false, error: 'Product not found' };

  const saleMode = change.saleMode
    ? saleModeForProduct(product, change.saleMode)
    : item.sale_mode;
  const unitType = change.unitType
    ? unitTypeForProduct(product, change.unitType)
    : item.unit_type;
  if (change.saleMode === 'wholesale' && saleMode !== 'wholesale') {
    return { success: false, error: `No wholesale pricing is configured for ${item.name}.` };
  }
  if (change.unitType === 'pack' && unitType !== 'pack') {
    return { success: false, error: `${item.name} is sold by unit only.` };
  }
  if (saleMode === item.sale_mode && unitType === item.unit_type) return { success: true };

  const latest = get();
  const source = latest.items.find((current) => current.id === itemId);
  if (!source) return { success: false, error: 'Item not found' };
  const sibling = latest.items.find(
    (current) =>
      current.id !== source.id &&
      current.product_id === source.product_id &&
      current.sale_mode === saleMode &&
      current.unit_type === unitType
  );
  const quantity = source.quantity + (sibling?.quantity || 0);
  const line = buildCartLine(product, saleMode, unitType, quantity, sibling?.id || source.id);
  const available = await stockAtContext(product.id, latest.locationId);
  const otherBase = latest.items
    .filter(
      (current) =>
        current.product_id === product.id &&
        current.id !== source.id &&
        current.id !== sibling?.id
    )
    .reduce((sum, current) => sum + current.base_quantity, 0);
  if (otherBase + line.base_quantity > available) {
    return { success: false, error: `Not enough stock of ${item.name} for that unit or price.` };
  }

  const items = latest.items.flatMap((current) => {
    if (sibling && current.id === sibling.id) return [line];
    if (current.id === source.id) return sibling ? [] : [line];
    return [current];
  });
  set({ ...withDiscount(latest, items), items });
  return { success: true };
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
  unitType: 'base',
  discountKind: 'none',
  discountPercent: 0,
  discountFixed: 0,
  discountAmount: 0,
  otherCharges: [],
  otherChargesTotal: 0,
  subtotal: 0,
  total: 0,
  couponCode: '',
  pointsToRedeem: 0,
  loyaltyCustomerId: '',
  loyaltyRedeemValue: 0,
  promotionDiscount: 0,
  promotionSummary: '',

  setCouponCode: async (code) => {
    const couponCode = code.trim();
    const state = get();
    const dealt = await applyDeals(state.items, couponCode);
    const storeId = await getCurrentStoreId();
    const promos = storeId
      ? await db.store_promotions.where('store_id').equals(storeId).and((row) => row.is_active === 1).toArray()
      : [];
    const known = !couponCode || promos.some((promo) => (promo.coupon_code || '').trim().toLowerCase() === couponCode.toLowerCase());
    set((current) => ({
      couponCode,
      items: dealt.items,
      promotionDiscount: dealt.promotionDiscount,
      promotionSummary: dealt.promotionSummary,
      ...withDiscount({ ...current, couponCode }, dealt.items),
    }));
    return known ? null : 'That coupon code is not active.';
  },

  setLoyaltySelection: async (customerId, points) => {
    const storeId = await getCurrentStoreId();
    const store = storeId ? await db.stores.get(storeId) : undefined;
    const customer = customerId ? await db.customers.get(customerId) : undefined;
    const redeemValue = Number(store?.loyalty_redeem_value) || 0;
    const state = get();
    const payable = roundMoney(state.subtotal - state.discountAmount);
    const capped = customer
      ? capRedeemPoints(points, customer.loyalty_points_balance || 0, redeemValue, payable)
      : 0;
    set((current) => ({
      loyaltyCustomerId: customer && customer.is_active === 1 ? customer.id : '',
      pointsToRedeem: capped,
      loyaltyRedeemValue: redeemValue,
      ...withDiscount({ ...current, pointsToRedeem: capped, loyaltyRedeemValue: redeemValue }, current.items),
    }));
  },

  setSaleContext: (locationId, saleMode, unitType) => {
    const state = get();
    const nextUnit = unitType ?? state.unitType;
    if (state.locationId === locationId && state.saleMode === saleMode && state.unitType === nextUnit) return;
    // Price and unit choices apply to the next item. Lines already in the sale stay as they are.
    set({ locationId, saleMode, unitType: nextUnit });
  },

  addItemByBarcode: async (barcode, opts) => {
    const storeId = await getCurrentStoreId();
    const variant = storeId ? await findVariantByCode(storeId, barcode) : null;
    const product = variant
      ? await db.products.get(variant.product_id)
      : await getProductByBarcode(barcode);
    if (!product || product.is_active !== 1) {
      return { success: false, error: `No product found with barcode: ${barcode}` };
    }
    const state = get();
    const result = await get().addItem(product, {
      unitType: opts?.unitType || state.unitType,
      saleMode: opts?.saleMode || state.saleMode,
      variant: variant || undefined,
    });
    if (result.success) return { success: true, product };
    return { success: false, error: result.error, product };
  },

  addItem: async (product, opts = {}) => {
    const state = get();
    const unitType = unitTypeForProduct(product, opts.unitType || state.unitType || 'base');
    const activeVariants = await db.product_variants
      .where('product_id')
      .equals(product.id)
      .and((row) => row.is_active === 1)
      .toArray();
    if (activeVariants.length > 0 && !opts.variant) {
      return { success: false, error: `Choose an option for ${product.name}.` };
    }
    const allowDecimal = productAllowsDecimal(product) && unitType !== 'pack';
    const addQty = quantityForProduct(opts.quantity || 1, allowDecimal);
    if (addQty <= 0) return { success: false, error: 'Enter a quantity greater than zero.' };
    const packSize = Math.max(1, Number(product.pack_size) || 1);
    const itemSaleMode = saleModeForProduct(product, opts.saleMode || state.saleMode);
    let available = await stockAtContext(product.id, state.locationId);
    if (opts.variant) {
      available = Math.min(available, roundStockQtyAllowZero(opts.variant.stock_level));
    }

    const variantId = opts.variant?.id || '';
    const existing = state.items.find(
      (i) =>
        i.product_id === product.id &&
        (i.variant_id || '') === variantId &&
        i.unit_type === unitType &&
        i.sale_mode === itemSaleMode
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

    const draft = (existingItem?: CartItem): CartItem => {
      const line = buildCartLine(product, itemSaleMode, unitType, existingItem ? nextQty : addQty, existingItem?.id);
      if (!opts.variant) return line;
      const price = variantSellingPrice(product, opts.variant);
      const qty = line.quantity;
      return {
        ...line,
        name: `${product.name} (${variantLabel(opts.variant)})`,
        variant_id: opts.variant.id,
        unit_price: price,
        list_unit_price: price,
        subtotal: roundMoney(price * qty),
      };
    };
    let items: CartItem[];
    if (existing) {
      items = state.items.map((item) => (item.id === existing.id ? draft(existing) : item));
    } else {
      items = [...state.items, draft()];
    }
    const dealt = await applyDeals(items, state.couponCode);
    set((current) => ({
      ...withDiscount(current, dealt.items),
      items: dealt.items,
      promotionDiscount: dealt.promotionDiscount,
      promotionSummary: dealt.promotionSummary,
    }));
    return { success: true };
  },

  removeItem: (itemId) => {
    const state = get();
    const items = state.items.filter((item) => item.id !== itemId);
    void applyDeals(items, state.couponCode).then((dealt) => {
      set((current) => ({
        ...withDiscount(current, dealt.items),
        items: dealt.items,
        promotionDiscount: dealt.promotionDiscount,
        promotionSummary: dealt.promotionSummary,
      }));
    });
  },

  updateQuantity: async (itemId, quantity) => {
    const currentItem = get().items.find((item) => item.id === itemId);
    const qty = quantityForProduct(quantity, currentItem?.allow_decimal === 1);
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

    const draft = state.items.map((item) => {
      if (item.id !== itemId) return item;
      const line = buildCartLine(product, item.sale_mode, item.unit_type, qty, item.id);
      if (!item.variant_id) return { ...line, variant_id: item.variant_id };
      return {
        ...line,
        name: item.name,
        variant_id: item.variant_id,
        unit_price: item.list_unit_price || item.unit_price,
        list_unit_price: item.list_unit_price || item.unit_price,
        subtotal: roundMoney((item.list_unit_price || item.unit_price) * qty),
      };
    });
    const variant = item.variant_id ? await db.product_variants.get(item.variant_id) : undefined;
    if (variant && roundStockQtyAllowZero(variant.stock_level) < (item.unit_type === 'pack' ? qty * packSize : qty)) {
      return { success: false, error: 'Not enough of that option in stock.' };
    }
    const dealt = await applyDeals(draft, state.couponCode);
    set((current) => ({
      ...withDiscount(current, dealt.items),
      items: dealt.items,
      promotionDiscount: dealt.promotionDiscount,
      promotionSummary: dealt.promotionSummary,
    }));
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
    if (item.allow_decimal === 1) {
      const step = item.quantity > 1 ? 1 : 0.1;
      const next = Math.round((item.quantity - step) * 1000) / 1000;
      if (next <= 0) {
        get().removeItem(itemId);
        return;
      }
      void get().updateQuantity(itemId, next);
      return;
    }
    if (item.quantity <= 1) {
      get().removeItem(itemId);
      return;
    }
    void get().updateQuantity(itemId, item.quantity - 1);
  },

  setItemSaleMode: (itemId, saleMode) => changeCartLine(get, set, itemId, { saleMode }),

  setItemUnitType: (itemId, unitType) => changeCartLine(get, set, itemId, { unitType }),

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
      couponCode: '',
      pointsToRedeem: 0,
      loyaltyCustomerId: '',
      loyaltyRedeemValue: 0,
      promotionDiscount: 0,
      promotionSummary: '',
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
      unitType: state.unitType,
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
        unitType: state.unitType,
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
      unitType: parked.unitType || 'base',
      parkedCarts,
    });
    return {
      locationId: parked.locationId,
      saleMode: parked.saleMode,
      unitType: parked.unitType || 'base',
    };
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
    let priced = recalculate(
      state.items,
      state.discountKind,
      state.discountPercent,
      state.discountFixed,
      state.otherCharges,
      0
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

    const attachedCustomerId = customerId || state.loyaltyCustomerId;
    const redeemValue = Number(store?.loyalty_redeem_value) || 0;
    let redeemPoints = 0;
    let redeemAmount = 0;
    if (attachedCustomerId && state.pointsToRedeem > 0) {
      const loyaltyCustomer = await db.customers.get(attachedCustomerId);
      redeemPoints = capRedeemPoints(
        state.pointsToRedeem,
        loyaltyCustomer?.loyalty_points_balance || 0,
        redeemValue,
        roundMoney(priced.subtotal - priced.discountAmount)
      );
      redeemAmount = pointsValue(redeemPoints, redeemValue);
    }
    priced = recalculate(
      state.items,
      state.discountKind,
      state.discountPercent,
      state.discountFixed,
      state.otherCharges,
      redeemAmount
    );
    const earnedPoints = attachedCustomerId
      ? pointsEarned(priced.total, Number(store?.loyalty_earn_rate) || 0)
      : 0;

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

    if (paymentMethod === 'credit' && attachedCustomerId) {
      const creditCustomer = await db.customers.get(attachedCustomerId);
      if (creditCustomer && creditCustomer.store_id === storeId) {
        const existingCredit = await db.transactions.where('customer_id').equals(creditCustomer.id).toArray();
        const currentDebt = toMoneyAmount(
          (creditCustomer.opening_balance_remaining || 0) +
          existingCredit.reduce((sum, sale) => (
            sale.payment_method === 'credit' && isCountedSale(sale)
              ? sum + toMoneyAmount(sale.credit_balance || 0)
              : sum
          ), 0)
        );
        const decision = evaluateCreditLimit({
          currentDebt,
          saleAmount: priced.total,
          creditLimit: creditCustomer.credit_limit,
          action: normalizeCreditLimitAction(store?.credit_limit_action),
        });
        if (decision.blocked) {
          throw new Error(`${decision.message} The store blocks credit sales over the limit.`);
        }
      }
    }

    await db.transaction(
      'rw',
      [
        db.transactions,
        db.transaction_items,
        db.customers,
        db.customer_wallet_transactions,
        db.customer_loyalty_transactions,
        db.product_variants,
      ],
      async () => {
        let creditCustomer: LocalCustomer | undefined;
        let payingCustomer: LocalCustomer | undefined;
        if (attachedCustomerId && (paymentMethod === 'credit' || wallet > 0 || redeemPoints > 0 || earnedPoints > 0)) {
          creditCustomer = await db.customers.get(attachedCustomerId);
          if ((paymentMethod === 'credit' || wallet > 0) && (!creditCustomer || creditCustomer.store_id !== storeId || creditCustomer.is_active !== 1)) {
            throw new Error('Select an active registered customer for this payment.');
          }
          if (creditCustomer && creditCustomer.store_id === storeId && creditCustomer.is_active === 1) {
            payingCustomer = creditCustomer;
          }
        }
        if (paymentMethod === 'credit' || wallet > 0) {
          if (wallet > 0) {
            if (!creditCustomer) throw new Error('Select an active registered customer for this payment.');
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
          credit_due_date: paymentMethod === 'credit'
            ? creditDueDate(payingCustomer?.credit_terms_days)
            : null,
          void_status: 'none',
          loyalty_points_earned: payingCustomer ? earnedPoints : 0,
          loyalty_points_redeemed: payingCustomer ? redeemPoints : 0,
          loyalty_redeem_amount: payingCustomer ? redeemAmount : 0,
          promotion_discount: state.promotionDiscount,
          promotion_summary: state.promotionSummary,
          coupon_code: state.couponCode,
          status: 'completed',
          location_id: locationId,
          sale_mode:
            state.items.length > 0 &&
            state.items.every((i) => i.sale_mode === state.items[0]!.sale_mode)
              ? state.items[0]!.sale_mode
              : 'mixed',
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
            sale_mode: item.sale_mode,
            variant_id: item.variant_id || null,
            measure_unit: item.measure_unit || '',
            list_unit_price: item.list_unit_price ?? item.unit_price,
            promotion_label: item.promotion_label || '',
            synced: 0,
          }))
        );
        if (payingCustomer && (redeemPoints > 0 || earnedPoints > 0)) {
          let pointsBalance = Math.max(0, Math.floor(Number(payingCustomer.loyalty_points_balance) || 0));
          if (redeemPoints > 0) {
            if (pointsBalance < redeemPoints) throw new Error('Not enough loyalty points to redeem.');
            pointsBalance -= redeemPoints;
            await db.customer_loyalty_transactions.add({
              id: generateId(),
              store_id: storeId,
              customer_id: payingCustomer.id,
              transaction_id: txnId,
              type: 'redeem',
              points: redeemPoints,
              balance_after: pointsBalance,
              reason: `Redeemed on ${receiptNumber}`,
              created_at: now,
              synced: 0,
            });
          }
          if (earnedPoints > 0) {
            pointsBalance += earnedPoints;
            await db.customer_loyalty_transactions.add({
              id: generateId(),
              store_id: storeId,
              customer_id: payingCustomer.id,
              transaction_id: txnId,
              type: 'earn',
              points: earnedPoints,
              balance_after: pointsBalance,
              reason: `Earned on ${receiptNumber}`,
              created_at: now,
              synced: 0,
            });
          }
          await db.customers.update(payingCustomer.id, {
            loyalty_points_balance: pointsBalance,
            updated_at: now,
            synced: 0,
          });
        }
        for (const item of state.items) {
          if (!item.variant_id) continue;
          const variant = await db.product_variants.get(item.variant_id);
          if (!variant || variant.store_id !== storeId) {
            throw new Error(`${item.name} is no longer available.`);
          }
          if (roundStockQtyAllowZero(variant.stock_level) + 0.0001 < item.base_quantity) {
            throw new Error(`Not enough stock for "${item.name}".`);
          }
          await db.product_variants.update(variant.id, {
            stock_level: roundStockQtyAllowZero(variant.stock_level - item.base_quantity),
            updated_at: now,
            synced: 0,
          });
        }
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
        [db.transaction_items, db.transactions, db.customer_wallet_transactions, db.customers, db.customer_loyalty_transactions, db.product_variants],
        async () => {
          await Promise.all(items.map((item) => db.transaction_items.delete(item.id)));
          await db.transactions.delete(txnId);
          for (const item of state.items) {
            if (!item.variant_id) continue;
            const variant = await db.product_variants.get(item.variant_id);
            if (!variant) continue;
            await db.product_variants.update(variant.id, {
              stock_level: roundStockQtyAllowZero(variant.stock_level + item.base_quantity),
              updated_at: new Date().toISOString(),
              synced: 0,
            });
          }
          if (attachedCustomerId) {
            const loyaltyRows = await db.customer_loyalty_transactions.where('transaction_id').equals(txnId).toArray();
            const customer = await db.customers.get(attachedCustomerId);
            if (customer && loyaltyRows.length > 0) {
              let pointsBalance = Math.max(0, Math.floor(Number(customer.loyalty_points_balance) || 0));
              for (const row of [...loyaltyRows].reverse()) {
                pointsBalance = row.type === 'earn'
                  ? Math.max(0, pointsBalance - row.points)
                  : pointsBalance + row.points;
              }
              await db.customers.update(customer.id, {
                loyalty_points_balance: pointsBalance,
                updated_at: new Date().toISOString(),
                synced: 0,
              });
            }
            await Promise.all(loyaltyRows.map((row) => db.customer_loyalty_transactions.delete(row.id)));
          }
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
      promotionDiscount: state.promotionDiscount,
      promotionSummary: state.promotionSummary,
      couponCode: state.couponCode,
      loyaltyPointsEarned: attachedCustomerId ? earnedPoints : 0,
      loyaltyPointsRedeemed: redeemPoints,
      loyaltyRedeemAmount: redeemAmount,
    };

    if (priced.discountAmount > 0) {
      recordActivity({
        storeId,
        storeName: store?.name,
        userId: cashierId,
        username: cashierName,
        role: isOwner ? 'owner' : 'cashier',
        activityType: 'discount',
        summary: `${cashierName} discounted ${receiptNumber} by ${priced.discountAmount.toFixed(2)}`,
        details: `${state.discountKind} discount. Subtotal ${priced.subtotal.toFixed(2)} → total ${priced.total.toFixed(2)}.`,
      });
    }

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
      couponCode: '',
      pointsToRedeem: 0,
      loyaltyCustomerId: '',
      loyaltyRedeemValue: 0,
      promotionDiscount: 0,
      promotionSummary: '',
    });

    // Push-only sync (no cloud pull) so checkout stays snappy
    window.setTimeout(() => {
      void triggerPushSync('sale');
    }, 0);
    return saleData;
  },
}));

export type { LocalLocation };
