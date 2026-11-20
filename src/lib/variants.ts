import { db, generateId, type LocalProduct, type LocalProductVariant } from '@/lib/dexie';
import { roundStockQtyAllowZero } from '@/lib/measure';

export async function listProductVariants(productId: string): Promise<LocalProductVariant[]> {
  return db.product_variants.where('product_id').equals(productId).sortBy('variant_value');
}

export async function listStoreVariants(storeId: string): Promise<LocalProductVariant[]> {
  return db.product_variants.where('store_id').equals(storeId).toArray();
}

export async function findVariantByCode(storeId: string, code: string): Promise<LocalProductVariant | null> {
  const needle = code.trim().toLowerCase();
  if (!needle) return null;
  const rows = await db.product_variants.where('store_id').equals(storeId).toArray();
  return (
    rows.find((row) => row.is_active === 1 && (
      (row.barcode || '').trim().toLowerCase() === needle ||
      (row.sku || '').trim().toLowerCase() === needle
    )) || null
  );
}

export function variantLabel(variant: Pick<LocalProductVariant, 'variant_name' | 'variant_value'>): string {
  const name = variant.variant_name.trim();
  const value = variant.variant_value.trim();
  if (name && value) return `${name}: ${value}`;
  return value || name;
}

export function variantSellingPrice(product: Pick<LocalProduct, 'selling_price'>, variant: Pick<LocalProductVariant, 'price_adjustment'>): number {
  return Math.round((Number(product.selling_price) + Number(variant.price_adjustment || 0)) * 100) / 100;
}

export async function saveProductVariant(input: {
  storeId: string;
  productId: string;
  id?: string;
  variantName: string;
  variantValue: string;
  sku: string;
  barcode: string;
  price: number;
  stockLevel: number;
}): Promise<void> {
  const product = await db.products.get(input.productId);
  if (!product || product.store_id !== input.storeId) throw new Error('Product not found.');
  const variantName = input.variantName.trim() || 'Option';
  const variantValue = input.variantValue.trim();
  if (!variantValue) throw new Error('Enter the variant, such as Large, Red, or Vanilla.');
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid variant price.');
  const stock = roundStockQtyAllowZero(input.stockLevel);
  const now = new Date().toISOString();
  const adjustment = Math.round((price - Number(product.selling_price)) * 100) / 100;
  const existing = input.id ? await db.product_variants.get(input.id) : undefined;
  if (existing && existing.product_id !== product.id) throw new Error('Variant does not belong to this product.');
  const row: LocalProductVariant = {
    id: existing?.id || generateId(),
    store_id: input.storeId,
    product_id: product.id,
    variant_name: variantName,
    variant_value: variantValue,
    sku: input.sku.trim(),
    barcode: input.barcode.trim(),
    price_adjustment: adjustment,
    stock_level: stock,
    is_active: existing?.is_active ?? 1,
    created_at: existing?.created_at || now,
    updated_at: now,
    synced: 0,
  };
  await db.product_variants.put(row);
}

export async function setVariantActive(id: string, active: boolean): Promise<void> {
  await db.product_variants.update(id, {
    is_active: active ? 1 : 0,
    updated_at: new Date().toISOString(),
    synced: 0,
  });
}
