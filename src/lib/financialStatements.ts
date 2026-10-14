/**
 * Store financial statements from POS sales, expenses, cash book, and inventory.
 * These are management statements for SMEs — not a full double-entry ledger.
 */

import {
  db,
  getCurrentStoreCashBookEntries,
  getCurrentStoreExpenses,
  getCurrentStoreId,
  type LocalCashBookEntry,
  type LocalCustomer,
  type LocalCustomerOpeningPayment,
  type LocalCreditPayment,
  type LocalExpense,
  type LocalTransaction,
} from './dexie';
import { FormalPdf, formatGhsOfficial, formatOfficialDate, orgFromStore, type FormalOrg } from './formalPdf';
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
  bank: number;
  digitalCollections: number;
  accountsReceivable: number;
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
  org: FormalOrg;
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

export async function buildStoreFinancialStatements(
  fromDate: string,
  toDate: string,
  periodLabel: string
): Promise<StoreFinancialStatements> {
  const storeId = await getCurrentStoreId();
  if (!storeId) throw new Error('No store selected');

  const [store, transactions, items, products, expenses, cashBook, creditPayments, customers, openingPayments] = await Promise.all([
    db.stores.get(storeId),
    db.transactions.where('store_id').equals(storeId).toArray(),
    db.transaction_items.where('store_id').equals(storeId).toArray(),
    db.products.where('store_id').equals(storeId).toArray(),
    getCurrentStoreExpenses(),
    getCurrentStoreCashBookEntries(),
    db.credit_payments.where('store_id').equals(storeId).toArray(),
    db.customers.where('store_id').equals(storeId).toArray(),
    db.customer_opening_payments.where('store_id').equals(storeId).toArray(),
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
  const toDateCreditPayments = creditPayments.filter(
    (payment) => dateOnlyFromIso(payment.created_at) <= toDate
  );

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
    toDateCreditPayments,
    toDateCustomers: customers.filter((customer) => dateOnlyFromIso(customer.created_at) <= toDate),
    toDateCustomerOpeningPayments: openingPayments.filter(
      (payment) => dateOnlyFromIso(payment.created_at) <= toDate
    ),
    items,
    productMap,
  });

  return {
    storeName,
    org: orgFromStore(store),
    incomeStatement,
    financialPosition: position,
  };
}

function buildPosition(params: {
  asOfDate: string;
  products: { stock_level: number; cost_price: number; is_active?: number }[];
  toDateTxns: LocalTransaction[];
  toDateExpenses: LocalExpense[];
  toDateCash: LocalCashBookEntry[];
  toDateCreditPayments: LocalCreditPayment[];
  toDateCustomers: LocalCustomer[];
  toDateCustomerOpeningPayments: LocalCustomerOpeningPayment[];
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
    params.toDateTxns.reduce((sum, t) => sum + (Number(t.cash_amount) || 0), 0) +
      params.toDateCreditPayments.reduce((sum, payment) => sum + payment.amount, 0) +
      params.toDateCustomerOpeningPayments
        .filter((payment) => payment.entry_type === 'payment')
        .reduce((sum, payment) => sum + payment.amount, 0)
  );
  const digitalCollections = roundMoney(
    params.toDateTxns.reduce(
      (sum, t) => sum + (Number(t.paystack_amount) || 0) + (Number(t.manual_payment_amount) || 0),
      0
    )
  );

  let cashBookCashIncomeExSales = 0;
  let cashBookBankIncome = 0;
  let cashBookCashExpenses = 0;
  let cashBookBankExpenses = 0;
  let loans = 0;
  let capital = 0;
  let drawings = 0;
  let cashBookOpex = 0;
  let otherIncome = 0;

  for (const entry of params.toDateCash) {
    const cat = normCat(entry.category);
    const amount = Number(entry.amount) || 0;
    const isBank = entry.account_type === 'bank';
    if (entry.entry_type === 'income') {
      if (!POS_SALES_INCOME.has(cat)) {
        if (isBank) cashBookBankIncome += amount;
        else cashBookCashIncomeExSales += amount;
      }
      if (LIABILITY_INCOME.has(cat)) loans += amount;
      else if (EQUITY_INCOME.has(cat)) capital += amount;
      else if (!POS_SALES_INCOME.has(cat)) otherIncome += amount;
    } else {
      if (isBank) cashBookBankExpenses += amount;
      else cashBookCashExpenses += amount;
      if (DRAWINGS.has(cat)) drawings += amount;
      else cashBookOpex += amount;
    }
  }

  const expensePage = params.toDateExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // POS cash sales plus cash-book cash movements, without double-counting "Cash sales".
  const cash = roundMoney(posCash + cashBookCashIncomeExSales - cashBookCashExpenses);
  const bank = roundMoney(cashBookBankIncome - cashBookBankExpenses);
  const paidByCreditSale = new Map<string, number>();
  for (const payment of params.toDateCreditPayments) {
    paidByCreditSale.set(
      payment.transaction_id,
      (paidByCreditSale.get(payment.transaction_id) || 0) + payment.amount
    );
  }
  const salesReceivable = params.toDateTxns.reduce((sum, transaction) => {
    if (transaction.payment_method !== 'credit') return sum;
    const paid = paidByCreditSale.get(transaction.id) || 0;
    return sum + Math.max(0, (Number(transaction.total_amount) || 0) - paid);
  }, 0);
  const paidOpeningBalances = new Map<string, number>();
  for (const payment of params.toDateCustomerOpeningPayments) {
    if (payment.entry_type !== 'payment') continue;
    paidOpeningBalances.set(
      payment.customer_id,
      (paidOpeningBalances.get(payment.customer_id) || 0) + payment.amount
    );
  }
  const openingReceivable = params.toDateCustomers.reduce(
    (sum, customer) => sum + Math.max(
      0,
      (Number(customer.opening_balance) || 0) - (paidOpeningBalances.get(customer.id) || 0)
    ),
    0
  );
  const accountsReceivable = roundMoney(salesReceivable + openingReceivable);

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

  const totalAssets = roundMoney(inventory + cash + bank + digitalCollections + accountsReceivable);
  const totalLiabilities = loans;
  const equityBeforePlug = roundMoney(capital + retainedEarnings - drawings);
  const balancingDifference = roundMoney(totalAssets - totalLiabilities - equityBeforePlug);
  const equity = roundMoney(equityBeforePlug + balancingDifference);

  const lines: StatementLine[] = [
    { label: 'Inventory (current, at cost)', amount: inventory },
    { label: 'Cash (POS cash + cash book)', amount: cash },
    { label: 'Bank (cash book)', amount: bank },
    { label: 'Non-cash collections', amount: digitalCollections },
    { label: 'Accounts receivable (credit sales)', amount: accountsReceivable },
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
    bank,
    digitalCollections,
    accountsReceivable,
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
  const period = `${formatOfficialDate(data.incomeStatement.fromDate)} to ${formatOfficialDate(data.incomeStatement.toDate)}`;
  const pdf = new FormalPdf(data.org, {
    title: 'Financial statements',
    subtitle: data.storeName,
    period,
    documentLabel: 'OFFICIAL STATEMENTS',
    notes: [
      'These statements were prepared from point-of-sale records, the store cash book, recorded expenses, and current inventory valued at cost.',
      'They are management accounts for internal and filing use. They are not audited financial statements.',
      'Cash-book Capital and Loan entries are presented on the statement of financial position. Cash-book “Cash sales” is not added again on top of POS sales.',
    ],
  });

  const toRows = (lines: StatementLine[]) =>
    lines.map((line) => ({
      label: line.label,
      value: formatGhsOfficial(line.amount, data.org.currencyCode),
      emphasis: line.emphasis,
    }));

  pdf.section('Income statement');
  pdf.paragraph(`For the period ${period}.`, true);
  pdf.kvTable(toRows(data.incomeStatement.lines));

  if (data.incomeStatement.expenseByCategory.length > 0) {
    pdf.section('Operating expenses by category');
    pdf.dataTable(
      ['Category', 'Amount'],
      data.incomeStatement.expenseByCategory.map((r) => [r.category, formatGhsOfficial(r.amount, data.org.currencyCode)]),
      [3, 1]
    );
  }

  pdf.section('Statement of financial position');
  pdf.paragraph(`As at ${formatOfficialDate(data.financialPosition.asOfDate)}.`, true);
  pdf.kvTable(toRows(data.financialPosition.lines));
  pdf.signatureBlock('Prepared by', 'Authorised by');

  const slug = data.incomeStatement.periodLabel.toLowerCase().replace(/\s+/g, '-');
  pdf.save(`${safeFilePart(data.storeName)}-financial-statements-${slug}.pdf`);
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';
}
