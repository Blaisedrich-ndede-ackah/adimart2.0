import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Product } from '@/lib/types';

export interface AdimartStoreProfile {
  id: string;
  name: string;
  address: string;
  supportNumber: string;
  logoUrl: string;
  tagline: string;
  slug: string;
  currencyCode: string;
  whatsappUrl: string;
}

const storeSlug = (import.meta.env.VITE_ADIMAT_STORE_SLUG || '').trim().toLowerCase();

function whatsappUrl(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const international = digits.startsWith('0') ? `233${digits.slice(1)}` : digits;
  return international ? `https://wa.me/${international}` : 'https://wa.me/';
}

function mapProduct(row: {
  id: string;
  name: string;
  category: string | null;
  selling_price: number | string | null;
  stock_level: number | string | null;
  image_url: string | null;
  created_at: string | null;
}, featured: boolean): Product {
  const createdAt = row.created_at || new Date(0).toISOString();
  const imageUrl = row.image_url || '';
  return {
    id: row.id,
    name: row.name,
    description: '',
    price: Number(row.selling_price) || 0,
    category: row.category || 'Other',
    stock_quantity: Number(row.stock_level) || 0,
    is_featured: featured,
    created_at: createdAt,
    images: imageUrl
      ? [{
          id: row.id,
          product_id: row.id,
          image_url: imageUrl,
          is_primary: true,
          created_at: createdAt,
        }]
      : [],
  };
}

let storeRequest: Promise<AdimartStoreProfile> | null = null;

export function adimartStoreSlug(): string {
  return storeSlug;
}

export function getAdimartStore(): Promise<AdimartStoreProfile> {
  if (!storeRequest) storeRequest = fetchAdimartStore();
  return storeRequest;
}

async function fetchAdimartStore(): Promise<AdimartStoreProfile> {
  if (!isSupabaseConfigured()) {
    throw new Error('Connect this storefront to Adimat with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  if (!storeSlug) {
    throw new Error('Set VITE_ADIMAT_STORE_SLUG to the Adimat shop slug for this store.');
  }

  const { data, error } = await supabase
    .from('stores')
    .select('id, name, address, support_number, logo_url, ecommerce_enabled, ecommerce_slug, ecommerce_tagline, currency_code')
    .eq('ecommerce_slug', storeSlug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || !data.ecommerce_enabled) {
    throw new Error('This Adimat shop is not available online. Turn on e-commerce for the store and publish its slug.');
  }

  return {
    id: data.id,
    name: data.name || 'BONDZTECH',
    address: data.address || '',
    supportNumber: data.support_number || '',
    logoUrl: data.logo_url || '',
    tagline: data.ecommerce_tagline || 'Shop trusted products with fast Ghana delivery',
    slug: data.ecommerce_slug || storeSlug,
    currencyCode: data.currency_code || 'GHS',
    whatsappUrl: whatsappUrl(data.support_number || ''),
  };
}

export async function loadAdimartProducts(): Promise<Product[]> {
  const store = await getAdimartStore();
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, selling_price, stock_level, image_url, created_at')
    .eq('store_id', store.id)
    .eq('is_active', true)
    .eq('sell_online', true)
    .order('name');

  if (error) throw new Error(error.message);

  let featuredLeft = 4;
  return (data || []).map((row) => {
    const stock = Number(row.stock_level) || 0;
    const featured = stock > 0 && featuredLeft > 0;
    if (featured) featuredLeft -= 1;
    return mapProduct(row, featured);
  });
}

export async function loadAdimartProduct(productId: string): Promise<Product | null> {
  const products = await loadAdimartProducts();
  return products.find((product) => product.id === productId) || null;
}

function orderNumber(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear().toString().slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  return `ON-${stamp}-${Math.floor(Math.random() * 900 + 100)}`;
}

export async function placeAdimartOrder(input: {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerEmail?: string;
  paymentMethod: 'paystack' | 'cash_on_delivery';
  paystackReference?: string;
  items: Array<{ product: Product; quantity: number }>;
}): Promise<{ orderId: string; orderNumber: string }> {
  const store = await getAdimartStore();
  if (!input.customerName.trim()) throw new Error('Enter your name');
  if (!input.customerPhone.trim()) throw new Error('Enter your phone number');
  if (!input.customerAddress.trim()) throw new Error('Enter a delivery address');
  if (!input.items.length) throw new Error('Your cart is empty');

  const liveProducts = await loadAdimartProducts();
  for (const item of input.items) {
    const current = liveProducts.find((product) => product.id === item.product.id);
    if (!current || current.stock_quantity < item.quantity) {
      throw new Error(`${item.product.name} does not have enough stock in Adimat.`);
    }
  }

  const orderId = crypto.randomUUID();
  const number = orderNumber();
  const now = new Date().toISOString();
  const total = Math.round(input.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0) * 100) / 100;
  const notes = [
    input.customerEmail?.trim() ? `Email: ${input.customerEmail.trim()}` : '',
    input.paystackReference ? `Paystack: ${input.paystackReference}` : '',
    `Placed on the ${store.name} storefront.`,
  ].filter(Boolean).join('\n');

  const { error: orderError } = await supabase.from('online_orders').insert({
    id: orderId,
    store_id: store.id,
    order_number: number,
    customer_name: input.customerName.trim(),
    customer_phone: input.customerPhone.trim(),
    customer_address: input.customerAddress.trim(),
    notes,
    status: 'new',
    payment_method: input.paymentMethod === 'paystack' ? 'paystack' : 'pay_on_delivery',
    total_amount: total,
    created_at: now,
    updated_at: now,
  });
  if (orderError) throw new Error(orderError.message);

  const { error: itemsError } = await supabase.from('online_order_items').insert(input.items.map((item) => ({
    id: crypto.randomUUID(),
    store_id: store.id,
    order_id: orderId,
    product_id: item.product.id,
    product_name: item.product.name,
    unit_price: item.product.price,
    quantity: item.quantity,
    subtotal: Math.round(item.product.price * item.quantity * 100) / 100,
    created_at: now,
  })));
  if (itemsError) throw new Error(itemsError.message);

  return { orderId, orderNumber: number };
}
