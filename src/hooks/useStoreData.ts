import useSWR from 'swr';
import {
  db,
  type LocalCustomer,
  type LocalExpense,
  type LocalProduct,
  type LocalTransaction,
} from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';

const STORE_DATA_OPTIONS = {
  dedupingInterval: 30_000,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
} as const;

function useStoreRows<T>(
  resource: string,
  loadRows: (storeId: string) => Promise<T[]>
) {
  const storeId = useAuthStore((state) => state.currentStore?.id);
  return useSWR<T[]>(
    storeId ? `store:${storeId}:${resource}` : null,
    () => loadRows(storeId!),
    STORE_DATA_OPTIONS
  );
}

/** Local IndexedDB remains the source of truth; SWR deduplicates screen reads. */
export function useStoreProducts() {
  return useStoreRows<LocalProduct>('products', (storeId) =>
    db.products.where('store_id').equals(storeId).toArray()
  );
}

export function useStoreTransactions() {
  return useStoreRows<LocalTransaction>('transactions', (storeId) =>
    db.transactions.where('store_id').equals(storeId).toArray()
  );
}

export function useStoreCustomers() {
  return useStoreRows<LocalCustomer>('customers', (storeId) =>
    db.customers.where('store_id').equals(storeId).toArray()
  );
}

export function useStoreExpenses() {
  return useStoreRows<LocalExpense>('expenses', (storeId) =>
    db.expenses.where('store_id').equals(storeId).toArray()
  );
}
