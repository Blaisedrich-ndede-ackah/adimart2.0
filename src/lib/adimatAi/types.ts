/** Plain records the heuristics read. No database types, so tests stay offline. */

export type Confidence = 'low' | 'medium' | 'high';

export interface AiSettings {
  expiryDays: number;
  deadStockWeeks: number;
  restockWeeks: number;
  leadTimeDays: number;
  coverDays: number;
  openingHour: number;
  closingHour: number;
}

export interface AiProduct {
  id: string;
  name: string;
  category: string;
  barcode: string;
  sellingPrice: number;
  costPrice: number;
  stock: number;
  reorderLevel: number;
  active: boolean;
}

export interface AiSale {
  id: string;
  createdAt: string;
  cashierId: string;
  cashierName: string;
  total: number;
  discount: number;
  status: 'completed' | 'pending';
  locationId: string | null;
  customerId: string | null;
  creditBalance: number;
}

export interface AiSaleItem {
  transactionId: string;
  productId: string;
  quantity: number;
  subtotal: number;
}

export interface AiBatch {
  id: string;
  productId: string;
  locationId: string;
  expiryDate: string | null;
  quantity: number;
  costPrice: number;
  createdAt: string;
}

export interface AiLocation {
  id: string;
  name: string;
}

export interface AiMovement {
  productId: string;
  type: 'receive' | 'transfer' | 'sale' | 'adjust' | 'return';
  quantity: number;
  userId: string | null;
  createdAt: string;
}

export interface AiReturn {
  createdBy: string;
  createdAt: string;
  quantity: number;
}

export interface AiCustomer {
  id: string;
  name: string;
  phone: string;
  openingRemaining: number;
  createdAt: string;
  optOut: boolean;
}

export interface AiCreditPayment {
  customerId: string;
  amount: number;
  createdAt: string;
}

export interface AiReminder {
  customerId: string;
  sentAt: string;
}

export interface AiPurchaseOrder {
  supplierId: string;
  status: 'ordered' | 'partially_received' | 'received' | 'cancelled';
  createdAt: string;
  lines: { productId: string; quantity: number; received: number; unitCost: number }[];
}

export interface AiSupplier {
  id: string;
  name: string;
}

export interface AiSnapshot {
  now: string;
  storeName: string;
  locationId: string | null;
  /** When set, these batch ids came from getExpiringBatches and are trusted. */
  expiringBatchIds?: string[];
  debtTemplate: string;
  settings: AiSettings;
  products: AiProduct[];
  sales: AiSale[];
  items: AiSaleItem[];
  batches: AiBatch[];
  locations: AiLocation[];
  movements: AiMovement[];
  returns: AiReturn[];
  customers: AiCustomer[];
  payments: AiCreditPayment[];
  reminders: AiReminder[];
  orders: AiPurchaseOrder[];
  suppliers: AiSupplier[];
}

export interface Why {
  whyKey: string;
  whyVars: Record<string, string | number>;
}

export interface TransferSuggestion extends Why {
  toLocationId: string;
  toLocationName: string;
  quantity: number;
}

export interface ExpiryAlert extends Why {
  id: string;
  kind: 'expiring' | 'dead';
  productId: string;
  productName: string;
  quantity: number;
  markdownPercent: number;
  daysToExpiry: number | null;
  confidence: Confidence;
  transfer?: TransferSuggestion;
}

export interface RestockLine extends Why {
  productId: string;
  productName: string;
  onHand: number;
  reorderLevel: number;
  openPoQty: number;
  weightedDaily: number;
  daysOfStock: number | null;
  suggestedQty: number;
  unitCost: number;
  confidence: Confidence;
}

export interface RestockGroup {
  supplierId: string;
  supplierName: string;
  lines: RestockLine[];
}

export interface Brief extends Why {
  enoughHistory: boolean;
  sales: number;
  saleCount: number;
  profit: number | null;
  topItems: { productId: string; name: string; qty: number; sales: number }[];
  lowStock: number;
  expiring: number;
  topDebtors: { customerId: string; name: string; owed: number }[];
  previousDaySales: number;
  weekAverageSales: number;
  confidence: Confidence;
}

export interface DebtPriority extends Why {
  customerId: string;
  name: string;
  phone: string;
  owed: number;
  daysSincePayment: number;
  score: number;
  message: string;
  optOut: boolean;
  confidence: Confidence;
}

export interface CashierFlag extends Why {
  id: string;
  cashierId: string;
  cashierName: string;
  kind: 'discount' | 'refund' | 'adjustment' | 'hours';
  confidence: Confidence;
}

export interface MarginAlert extends Why {
  productId: string;
  productName: string;
  previousCost: number;
  latestCost: number;
  sellingPrice: number;
  marginBefore: number;
  marginAfter: number;
  suggestedPrice: number;
  confidence: Confidence;
}

export interface HeatCell {
  weekday: number;
  hour: number;
  total: number;
  count: number;
}

export interface HeatmapResult extends Why {
  cells: HeatCell[];
  busiest: { weekday: number; hour: number; total: number }[];
  slowest: { weekday: number; hour: number; total: number }[];
  enough: boolean;
  confidence: Confidence;
}

export interface Pair {
  a: string;
  b: string;
  count: number;
}

export interface AiReport {
  generatedAt: string;
  lowHistory: boolean;
  brief: Brief;
  expiry: ExpiryAlert[];
  deadStock: ExpiryAlert[];
  restock: RestockGroup[];
  debt: DebtPriority[];
  cashierFlags: CashierFlag[];
  margins: MarginAlert[];
  heatmap: HeatmapResult;
  pairs: Pair[];
  productNames: Record<string, string>;
}
