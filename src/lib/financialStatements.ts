/**
 * Store financial statements from POS sales, expenses, cash book, and inventory.
 * These are management statements for SMEs — not a full double-entry ledger.
 */

import jsPDF from 'jspdf';
import {
  db,
  getCurrentStoreCashBookEntries,
  getCurrentStoreExpenses,
  getCurrentStoreId,
  type LocalCashBookEntry,
  type LocalExpense,
  type LocalTransaction,
} from './dexie';
import { lineBaseQty, roundMoney } from './money';
import { toMoney, toQty } from './warehouse';

const EQUITY_INCOME = new Set(['capital']);
const LIABILITY_INCOME = new Set(['loan']);
const POS_SALES_INCOME = new Set(['cash sales']);
const DRAWINGS = new Set(['withdrawal']);

export interface StatementLine {
  label: string;
  amount: number;
  emphasis?: 'total' | 'subtotal' | 'muted';
}

export interface IncomeStatement {
  periodLabel: string;
  fromDate: string;
  toDate: string;
  sales: number;
  costOfGoods: number;
  grossProfit: number;
  otherIncome: number;
  operatingExpenses: number;
  cashBookOperatingExpenses: number;
  totalExpenses: number;
  netProfit: number;
  drawings: number;
  lines: StatementLine[];
  otherIncomeByCategory: { category: string; amount: number }[];
  expenseByCategory: { category: string; amount: number }[];
}

export interface FinancialPosition {
  asOfDate: string;
  inventory: number;
  cash: number;
  digitalCollections: number;
  totalAssets: number;
  loans: number;
  totalLiabilities: number;
  capital: number;
  retainedEarnings: number;
  drawings: number;
  equity: number;
  balancingDifference: number;
  lines: StatementLine[];
}

export interface StoreFinancialStatements {
  storeName: string;
  incomeStatement: IncomeStatement;
  financialPosition: FinancialPosition;
}

function normCat(value: string): string {
  return value.trim().toLowerCase();
}

function dateOnlyFromIso(iso: string): string {
  return iso.slice(0, 10);
}

function inRange(dateOnly: string, fromDate: string, toDate: string): boolean {
  return dateOnly >= fromDate && dateOnly <= toDate;
}

function groupAmounts(
  rows: { category: string; amount: number }[]
): { category: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.category.trim() || 'Other';
    map.set(key, roundMoney((map.get(key) || 0) + row.amount));
  }
  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function money(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `(GH₵${abs})` : `GH₵${abs}`;
}

export async function buildStoreFinancialStatements(
  fromDate: string,
  toDate: string,
  periodLabel: string
): Promise<StoreFinancialStatements> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const [store, transactions, items, products, expenses, cashBook] = await Promise.all([
    db.stores.get(storeId),
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.transaction_items.where('store_id').equals(storeId).toArray(),
    db.products.where('store_id').equals(storeId).toArray(),
    getCurrentStoreExpenses(),
    getCurrentStoreCashBookEntries(),
  ]);

  const storeName = store?.name?.trim() || 'Store';
  const productMap = new Map(products.map((p) => [p.id, p]));

  const completed = transactions.filter((t) => t.status === 'completed');
  const periodTxns = completed.filter((t) => inRange(dateOnlyFromIso(t.created_at), fromDate, toDate));
  const toDateTxns = completed.filter((t) => dateOnlyFromIso(t.created_at) <= toDate);

  const periodTxnIds = new Set(periodTxns.map((t) => t.id));
  const periodItems = items.filter((i) => periodTxnIds.has(i.transaction_id));

  const sales = roundMoney(periodTxns.reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0));
  const costOfGoods = roundMoney(
    periodItems.reduce((sum, item) => {
      const product = productMap.get(item.product_id);
      return sum + (product?.cost_price ?? 0) * lineBaseQty(item);
    }, 0)
  );
  const grossProfit = roundMoney(sales - costOfGoods);

  const periodExpenses = expenses.filter((e) => inRange(dateOnlyFromIso(e.created_at), fromDate, toDate));
  const toDateExpenses = expenses.filter((e) => dateOnlyFromIso(e.created_at) <= toDate);
  const operatingExpenses = roundMoney(
    periodExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  );

  const periodCash = cashBook.filter((e) => inRange(e.entry_date, fromDate, toDate));
  const toDateCash = cashBook.filter((e) => e.entry_date <= toDate);

  const otherIncomeRows: { category: string; amount: number }[] = [];
  let cashBookOperatingExpenses = 0;
  let drawings = 0;
  const cashOpexRows: { category: string; amount: number }[] = [];

  for (const entry of periodCash) {
    const cat = normCat(entry.category);
    const amount = Number(entry.amount) || 0;
    if (entry.entry_type === 'income') {
      if (EQUITY_INCOME.has(cat) || LIABILITY_INCOME.has(cat) || POS_SALES_INCOME.has(cat)) continue;
      otherIncomeRows.push({ category: entry.category || 'Other', amount });
    } else if (DRAWINGS.has(cat)) {
      drawings += amount;
    } else {
      cashBookOperatingExpenses += amount;
      cashOpexRows.push({ category: entry.category || 'Other', amount });
    }
  }

  const otherIncome = roundMoney(otherIncomeRows.reduce((s, r) => s + r.amount, 0));
  cashBookOperatingExpenses = roundMoney(cashBookOperatingExpenses);
  drawings = roundMoney(drawings);
  const totalExpenses = roundMoney(operatingExpenses + cashBookOperatingExpenses);
  const netProfit = roundMoney(grossProfit + otherIncome - totalExpenses);

  const incomeLines: StatementLine[] = [
    { label: 'Sales (POS)', amount: sales },
    { label: 'Cost of goods sold', amount: -costOfGoods },
    { label: 'Gross profit', amount: grossProfit, emphasis: 'subtotal' },
    { label: 'Other income (cash book)', amount: otherIncome },
    { label: 'Operating expenses', amount: -operatingExpenses },
    { label: 'Cash book expenses', amount: -cashBookOperatingExpenses },
    { label: 'Net profit', amount: netProfit, emphasis: 'total' },
    { label: 'Drawings / withdrawals', amount: -drawings, emphasis: 'muted' },
  ];

  const incomeStatement: IncomeStatement = {
    periodLabel,
    fromDate,
    toDate,
    sales,
    costOfGoods,
    grossProfit,
    otherIncome,
    operatingExpenses,
    cashBookOperatingExpenses,
    totalExpenses,
    netProfit,
    drawings,
    lines: incomeLines,
    otherIncomeByCategory: groupAmounts(otherIncomeRows),
    expenseByCategory: groupAmounts([
      ...periodExpenses.map((e) => ({ category: e.category || 'Other', amount: Number(e.amount) || 0 })),
      ...cashOpexRows,
    ]),
  };

  const position = buildPosition({
    asOfDate: toDate,
    products,
    toDateTxns,
    toDateExpenses,
    toDateCash,
    items,
    productMap,
  });

  return { storeName, incomeStatement, financialPosition: position };
}

function buildPosition(params: {
  asOfDate: string;
  products: { stock_level: number; cost_price: number; is_active?: number }[];
  toDateTxns: LocalTransaction[];
  toDateExpenses: LocalExpense[];
  toDateCash: LocalCashBookEntry[];
  items: { transaction_id: string; product_id: string; quantity: number; base_quantity?: number | null }[];
  productMap: Map<string, { cost_price: number }>;
}): FinancialPosition {
  const inventory = roundMoney(
    params.products.reduce(
      (sum, p) => sum + toQty(p.stock_level) * toMoney(p.cost_price),
      0
    )
  );

  const posCash = roundMoney(
    params.toDateTxns.reduce((sum, t) => sum + (Number(t.cash_amount) || 0), 0)
  );
  const digitalCollections = roundMoney(
    params.toDateTxns.reduce((sum, t) => sum + (Number(t.paystack_amount) || 0), 0)
  );

  let cashBookIncomeExSales = 0;
  let cashBookExpenses = 0;
  let loans = 0;
  let capital = 0;
  let drawings = 0;
  let cashBookOpex = 0;
  let otherIncome = 0;

  for (const entry of params.toDateCash) {
    const cat = normCat(entry.category);
    const amount = Number(entry.amount) || 0;
    if (entry.entry_type === 'income') {
      if (!POS_SALES_INCOME.has(cat)) cashBookIncomeExSales += amount;
      if (LIABILITY_INCOME.has(cat)) loans += amount;
      else if (EQUITY_INCOME.has(cat)) capital += amount;
      else if (!POS_SALES_INCOME.has(cat)) otherIncome += amount;
    } else {
      cashBookExpenses += amount;
      if (DRAWINGS.has(cat)) drawings += amount;
      else cashBookOpex += amount;
    }
  }

  const expensePage = params.toDateExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // POS cash sales plus cash-book movements, without double-counting "Cash sales".
  const cash = roundMoney(posCash + cashBookIncomeExSales - cashBookExpenses);

  const txnIds = new Set(params.toDateTxns.map((t) => t.id));
  const cogsToDate = roundMoney(
    params.items
      .filter((i) => txnIds.has(i.transaction_id))
      .reduce((sum, item) => {
        const product = params.productMap.get(item.product_id);
        return sum + (product?.cost_price ?? 0) * lineBaseQty(item);
      }, 0)
  );
  const salesToDate = roundMoney(
    params.toDateTxns.reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0)
  );
  const retainedEarnings = roundMoney(
    salesToDate - cogsToDate + otherIncome - expensePage - cashBookOpex
  );

  loans = roundMoney(loans);
  capital = roundMoney(capital);
  drawings = roundMoney(drawings);

  const totalAssets = roundMoney(inventory + cash + digitalCollections);
  const totalLiabilities = loans;
  const equityBeforePlug = roundMoney(capital + retainedEarnings - drawings);
  const balancingDifference = roundMoney(totalAssets - totalLiabilities - equityBeforePlug);
  const equity = roundMoney(equityBeforePlug + balancingDifference);

  const lines: StatementLine[] = [
    { label: 'Inventory (current, at cost)', amount: inventory },
    { label: 'Cash (POS cash + cash book)', amount: cash },
    { label: 'Digital collections (Paystack)', amount: digitalCollections },
    { label: 'Total assets', amount: totalAssets, emphasis: 'total' },
    { label: 'Loans', amount: loans },
    { label: 'Total liabilities', amount: totalLiabilities, emphasis: 'subtotal' },
    { label: 'Capital', amount: capital },
    { label: 'Retained earnings', amount: retainedEarnings },
    { label: 'Drawings', amount: -drawings },
    ...(Math.abs(balancingDifference) >= 0.01
      ? [{ label: 'Unrecorded / timing difference', amount: balancingDifference, emphasis: 'muted' as const }]
      : []),
    { label: 'Total equity', amount: equity, emphasis: 'subtotal' },
    { label: 'Total liabilities and equity', amount: roundMoney(totalLiabilities + equity), emphasis: 'total' },
  ];

  return {
    asOfDate: params.asOfDate,
    inventory,
    cash,
    digitalCollections,
    totalAssets,
    loans,
    totalLiabilities,
    capital,
    retainedEarnings,
    drawings,
    equity,
    balancingDifference,
    lines,
  };
}

export function exportFinancialStatementsPdf(data: StoreFinancialStatements): void {
  const doc = new jsPDF();
  let y = 16;

  const writeTitle = (text: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(text, 14, y);
    y += 8;
  };

  const writeSub = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(text, 14, y);
    y += 7;
  };

  const writeLines = (lines: StatementLine[]) => {
    for (const line of lines) {
      if (y > 280) {
        doc.addPage();
        y = 16;
      }
      const isTotal = line.emphasis === 'total';
      const isSub = line.emphasis === 'subtotal';
      doc.setFont('helvetica', isTotal || isSub ? 'bold' : 'normal');
      doc.setFontSize(isTotal ? 11 : 10);
      doc.setTextColor(line.emphasis === 'muted' ? 100 : 20);
      doc.text(line.label, 14, y);
      doc.text(money(line.amount), 196, y, { align: 'right' });
      y += isTotal ? 8 : 6;
      doc.setTextColor(20);
    }
  };

  writeTitle('Income Statement');
  writeSub(`${data.storeName}  •  ${data.incomeStatement.periodLabel}`);
  writeSub(`${data.incomeStatement.fromDate} to ${data.incomeStatement.toDate}`);
  y += 2;
  writeLines(data.incomeStatement.lines);

  y += 8;
  writeTitle('Statement of Financial Position');
  writeSub(`${data.storeName}  •  As of ${data.financialPosition.asOfDate}`);
  y += 2;
  writeLines(data.financialPosition.lines);

  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(
    'Prepared from POS sales, expenses, cash book, and current inventory. Management statement, not audited accounts.',
    14,
    y,
    { maxWidth: 180 }
  );

  const slug = data.incomeStatement.periodLabel.toLowerCase().replace(/\s+/g, '-');
  doc.save(`adimat-statements-${slug}.pdf`);
}
