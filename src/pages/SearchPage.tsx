import { useEffect, useMemo, useState } from 'react';
import { ContactRound, Package, Receipt, Search, Truck } from 'lucide-react';
import {
  db,
  getCurrentStoreId,
  type LocalCustomer,
  type LocalProduct,
  type LocalSupplier,
  type LocalTransaction,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { formatCustomerAddress } from '@/lib/customerAddress';
import { useFormatMoney } from '@/lib/currency';
import { canViewStockQuantities } from '@/lib/stockVisibility';

interface SearchPageProps {
  onNavigate?: (page: string) => void;
}

type ResultKind = 'product' | 'customer' | 'sale' | 'supplier';

interface SearchResult {
  id: string;
  kind: ResultKind;
  title: string;
  detail: string;
  page?: string;
}

function includesQuery(value: string | null | undefined, query: string): boolean {
  return (value || '').toLocaleLowerCase().includes(query);
}

export default function SearchPage({ onNavigate }: SearchPageProps) {
  const { currentUser, currentStore } = useAuthStore();
  const money = useFormatMoney();
  const isOwner = currentUser?.role === 'owner';
  const showStockQty = canViewStockQuantities(currentUser, currentStore);
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<LocalSupplier[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      const storeId = await getCurrentStoreId();
      if (!storeId) return;
      const [productRows, customerRows, transactionRows, supplierRows] = await Promise.all([
        db.products.where('store_id').equals(storeId).toArray(),
        isOwner ? db.customers.where('store_id').equals(storeId).toArray() : Promise.resolve([]),
        db.transactions.where('store_id').equals(storeId).toArray(),
        isOwner ? db.suppliers.where('store_id').equals(storeId).toArray() : Promise.resolve([]),
      ]);
      if (!active) return;
      setProducts(productRows);
      setCustomers(customerRows);
      setTransactions(transactionRows);
      setSuppliers(supplierRows);
    })().catch((loadError: unknown) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : 'Could not load records to search.');
    });
    return () => { active = false; };
  }, [currentStore?.id, isOwner]);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length < 1) return [];
    const found: SearchResult[] = [];
    for (const product of products) {
      if (
        includesQuery(product.name, needle) ||
        includesQuery(product.barcode, needle) ||
        includesQuery(product.category, needle) ||
        includesQuery(product.sku_type, needle)
      ) {
        found.push({
          id: `product:${product.id}`,
          kind: 'product',
          title: product.name,
          detail: [
            product.category,
            product.barcode,
            showStockQty ? `${product.stock_level} in stock` : '',
            money(product.selling_price),
          ]
            .filter(Boolean)
            .join(' · '),
          page: 'inventory',
        });
      }
    }
    for (const customer of customers) {
      const address = formatCustomerAddress(customer.address);
      if (
        includesQuery(customer.name, needle) ||
        includesQuery(customer.phone, needle) ||
        includesQuery(address, needle) ||
        includesQuery(customer.address, needle)
      ) {
        found.push({
          id: `customer:${customer.id}`,
          kind: 'customer',
          title: customer.name,
          detail: [customer.phone || 'No phone', address || 'No address'].join(' · '),
          page: 'customers',
        });
      }
    }
    for (const transaction of transactions) {
      if (
        includesQuery(transaction.receipt_number, needle) ||
        includesQuery(transaction.customer_name, needle) ||
        includesQuery(transaction.customer_phone, needle) ||
        includesQuery(transaction.payment_reference, needle)
      ) {
        found.push({
          id: `sale:${transaction.id}`,
          kind: 'sale',
          title: transaction.receipt_number || 'Sale',
          detail: [
            transaction.customer_name,
            transaction.payment_method,
            money(transaction.total_amount),
            new Date(transaction.created_at).toLocaleString(),
          ].filter(Boolean).join(' · '),
          page: 'transactions',
        });
      }
    }
    for (const supplier of suppliers) {
      if (
        includesQuery(supplier.name, needle) ||
        includesQuery(supplier.phone, needle) ||
        includesQuery(supplier.contact_name, needle)
      ) {
        found.push({
          id: `supplier:${supplier.id}`,
          kind: 'supplier',
          title: supplier.name,
          detail: [supplier.contact_name, supplier.phone].filter(Boolean).join(' · ') || 'Supplier',
          page: 'purchasing',
        });
      }
    }
    return found.slice(0, 40);
  }, [customers, money, products, query, showStockQty, suppliers, transactions]);

  const iconFor = (kind: ResultKind) => {
    if (kind === 'product') return Package;
    if (kind === 'customer') return ContactRound;
    if (kind === 'supplier') return Truck;
    return Receipt;
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="text-lg font-bold text-white">Search</h1>
        <p className="mt-1 text-xs text-emerald-100">
          Find products, customers, sales, and suppliers without leaving the till.
        </p>
      </div>
      <div className="page-body no-scrollbar space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, phone, barcode, receipt, or address"
            aria-label="Search products, customers, and records"
            autoFocus
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!query.trim() ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500">
            Type a product, customer, receipt number, or address.
          </p>
        ) : results.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500" role="status">
            No matching records.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500" role="status">{results.length} result{results.length === 1 ? '' : 's'}</p>
            {results.map((result) => {
              const Icon = iconFor(result.kind);
              return (
                <article key={result.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{result.title}</p>
                    <p className="truncate text-xs text-gray-500">{result.detail}</p>
                  </div>
                  {result.page && onNavigate && (isOwner || result.page === 'transactions' || result.page === 'pos') && (
                    <button
                      type="button"
                      onClick={() => onNavigate(result.page!)}
                      className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-2 text-[11px] font-semibold text-gray-700"
                    >
                      Open
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
