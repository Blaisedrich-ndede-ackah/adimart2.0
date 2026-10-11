import { useEffect, useState, useMemo } from 'react';
import { Flame } from 'lucide-react';
import { getCurrentStoreId, getCurrentStoreActiveProducts, getTransactionItems, db, type LocalProduct } from '@/lib/dexie';
import ProductImage from '@/components/ProductImage';
import { useFormatMoney } from '@/lib/currency';
import { toQty } from '@/lib/warehouse';

interface ProductWithFrequency {
  product: LocalProduct;
  frequency: number;
}

export default function FrequentItems({ onAddProduct }: { onAddProduct?: (product: LocalProduct) => void }) {
  const [frequentItems, setFrequentItems] = useState<ProductWithFrequency[]>([]);
  const [loading, setLoading] = useState(true);
  const money = useFormatMoney();

  useEffect(() => {
    async function loadFrequentItems() {
      try {
        const storeId = await getCurrentStoreId();
        if (!storeId) {
          setFrequentItems([]);
          setLoading(false);
          return;
        }

        // Get all transactions from last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const transactions = await db.transactions
          .where('store_id')
          .equals(storeId)
          .filter((t) => t.created_at && t.created_at > thirtyDaysAgo && t.status === 'completed')
          .toArray();

        // Count product frequency
        const frequencyMap = new Map<string, number>();
        for (const txn of transactions) {
          const items = await getTransactionItems(txn.id);
          for (const item of items) {
            frequencyMap.set(
              item.product_id,
              (frequencyMap.get(item.product_id) || 0) + (item.quantity || 1)
            );
          }
        }

        // Get products
        const products = await getCurrentStoreActiveProducts();
        
        // Build list with frequency
        const withFreq = Array.from(frequencyMap.entries())
          .map(([productId, freq]) => {
            const product = products.find((p) => p.id === productId);
            return product ? { product, frequency: freq } : null;
          })
          .filter((item): item is ProductWithFrequency => item !== null)
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 10);

        setFrequentItems(withFreq);
      } catch (err) {
        console.error('[v0] Error loading frequent items:', err);
        setFrequentItems([]);
      } finally {
        setLoading(false);
      }
    }

    void loadFrequentItems();
  }, []);

  if (loading || frequentItems.length === 0) {
    return null;
  }

  return (
    <div className="px-3 md:px-4 py-3 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-amber-200 flex-shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <Flame className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <p className="text-xs font-bold text-amber-900">TOP 10 FREQUENTLY BOUGHT</p>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {frequentItems.map(({ product }) => {
          const stockLevel = toQty(product.stock_level);
          const outOfStock = stockLevel <= 0;

          return (
            <button
              key={product.id}
              onClick={() => onAddProduct?.(product)}
              disabled={outOfStock}
              className={`flex-shrink-0 w-20 md:w-24 rounded-lg border-2 transition-all touch-target ${
                outOfStock
                  ? 'opacity-50 border-gray-200 cursor-not-allowed'
                  : 'border-amber-300 hover:border-amber-400 hover:bg-white active:bg-amber-100'
              }`}
              title={product.name}
            >
              <div className="aspect-square bg-gray-50 rounded-t-[6px] flex items-center justify-center overflow-hidden">
                <ProductImage
                  productId={product.id}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-1.5 space-y-0.5">
                <p className="text-[10px] font-semibold text-gray-800 truncate">{product.name}</p>
                <p className="text-[9px] text-amber-700 font-bold">{money(product.selling_price || 0)}</p>
                {outOfStock && <p className="text-[8px] text-red-600 font-bold">Out of stock</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
