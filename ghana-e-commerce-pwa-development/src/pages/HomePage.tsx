import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Coffee,
  Dumbbell,
  Headphones,
  Heart,
  Home as HomeIcon,
  Laptop,
  MessageCircle,
  ShieldCheck,
  Shirt,
  Smartphone,
  Sparkles,
  Store,
  Truck,
} from 'lucide-react';
import { loadAdimartProducts } from '@/lib/adimart';
import { useAdimartStore } from '@/lib/AdimartProvider';
import type { Product } from '@/lib/types';
import ProductCard, { ProductCardSkeleton } from '@/components/ProductCard';
import HeroSection from '@/components/HeroSection';

const trustSignals = [
  { label: 'Mobile Money ready', description: 'Pay with MoMo, Visa, Mastercard, or cash on delivery.', icon: Smartphone },
  { label: 'Fast Ghana delivery', description: '1-3 days in Takoradi and 3-7 days nationwide.', icon: Truck },
  { label: 'Secure checkout', description: 'Protected payment flow with clear order updates.', icon: ShieldCheck },
  { label: 'Friendly support', description: 'Get help before and after your order.', icon: Headphones },
];

const categories = [
  { name: 'Electronics', description: 'Phones, gadgets, and accessories', icon: Laptop, color: 'from-blue-500 to-cyan-500' },
  { name: 'Fashion', description: 'Style finds for every day', icon: Shirt, color: 'from-pink-500 to-rose-500' },
  { name: 'Home & Garden', description: 'Useful essentials for your space', icon: HomeIcon, color: 'from-green-500 to-emerald-500' },
  { name: 'Beauty', description: 'Care, grooming, and wellness', icon: Heart, color: 'from-purple-500 to-fuchsia-500' },
  { name: 'Sports', description: 'Fitness and active lifestyle', icon: Dumbbell, color: 'from-orange-500 to-red-500' },
  { name: 'Food & Drinks', description: 'Treats, drinks, and pantry picks', icon: Coffee, color: 'from-yellow-500 to-amber-500' },
];

const serviceHighlights = [
  { title: 'Quality checked products', icon: BadgeCheck },
  { title: 'Local Ghana support', icon: MessageCircle },
  { title: 'Easy shopping experience', icon: Store },
  { title: 'Fresh deals and arrivals', icon: Sparkles },
];

export default function HomePage() {
  const { store } = useAdimartStore();
  const brand = store?.name || 'BONDZTECH';
  const whatsappUrl = store?.whatsappUrl || 'https://wa.me/';
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [latestProducts, setLatestProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const products = await loadAdimartProducts();
      const featured = products.filter((product) => product.is_featured).slice(0, 4);
      const latest = [...products].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
      setFeaturedProducts(featured.length ? featured : latest.slice(0, 4));
      setLatestProducts(latest);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <HeroSection featuredProducts={featuredProducts} loading={loading} />

      {/* Trust Signals */}
      <section className="border-y border-orange-100 bg-orange-50/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {trustSignals.map((signal) => {
              const SignalIcon = signal.icon;
              return (
                <div key={signal.label} className="flex items-start gap-3 rounded-2xl bg-white/80 px-4 py-4 shadow-sm ring-1 ring-orange-100">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                    <SignalIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{signal.label}</h3>
                    <p className="mt-1 text-xs leading-5 text-gray-600">{signal.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section id="categories" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-500">Shop faster</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold text-gray-900">
            Start with what you need
          </h2>
          <p className="mt-3 text-gray-500">
            Browse popular departments and jump straight into the products Ghanaian shoppers ask for most.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category) => {
            const CategoryIcon = category.icon;
            return (
              <Link
                key={category.name}
                to={`/products?category=${encodeURIComponent(category.name)}`}
                className="group relative overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-orange-200"
              >
                <div className={`absolute inset-y-0 right-0 w-28 bg-gradient-to-br ${category.color} opacity-10 transition-opacity group-hover:opacity-20`} />
                <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${category.color} text-white shadow-lg`}>
                  <CategoryIcon className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">{category.name}</h3>
                <p className="mt-1 min-h-10 text-sm leading-5 text-gray-500">{category.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange-600">
                  Explore <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Featured Products */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-500">Popular picks</p>
            <h2 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900">Featured products</h2>
            <p className="text-gray-500 mt-1">Hand-picked deals worth checking first</p>
          </div>
          <Link
            to="/products"
            className="flex items-center gap-1 text-orange-500 hover:text-orange-600 font-medium text-sm transition-colors"
          >
            Explore collection <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : featuredProducts.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {featuredProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <EmptyState
            whatsappUrl={whatsappUrl}
            title="Featured products are coming soon"
            description={`We are preparing the best ${brand} picks for you. Browse the full shop or message us on WhatsApp for current availability.`}
          />
        )}
      </section>

      {/* Latest Products */}
      <section className="bg-gradient-to-b from-orange-50/50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-500">Fresh stock</p>
              <h2 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900">New arrivals</h2>
              <p className="text-gray-500 mt-1">Fresh products just landed</p>
            </div>
            <Link
              to="/products"
              className="flex items-center gap-1 text-orange-500 hover:text-orange-600 font-medium text-sm transition-colors"
            >
              See all new <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : latestProducts.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {latestProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <EmptyState
              whatsappUrl={whatsappUrl}
              title="New arrivals will appear here"
              description="Check back soon for fresh stock, or contact us and we will help you find what you need today."
            />
          )}
        </div>
      </section>

      {/* Service Highlights */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="rounded-[2rem] bg-gray-900 px-5 py-8 text-white sm:px-8 lg:px-10">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-300">Why shop with us</p>
              <h2 className="mt-3 text-2xl sm:text-3xl font-bold">
                Built for confident shopping from first click to delivery.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-300">
                {brand} keeps the buying experience simple with clear prices in Ghana cedis,
                helpful support, and payment options customers already trust.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {serviceHighlights.map((item) => {
                const HighlightIcon = item.icon;
                return (
                  <div key={item.title} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-4 ring-1 ring-white/10">
                    <HighlightIcon className="h-5 w-5 text-orange-300" />
                    <span className="text-sm font-semibold">{item.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <h3 className="text-lg font-bold mb-4">{brand}</h3>
              <p className="text-gray-400 text-sm leading-6">
                Ghana's online shopping destination for quality products, fast delivery, and secure payments.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['Mobile Money', 'Visa', 'Mastercard', 'Cash on Delivery'].map((method) => (
                  <span key={method} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-gray-200">
                    {method}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-4">Quick Links</h3>
              <div className="space-y-2">
                <Link to="/products" className="block text-gray-400 hover:text-orange-400 text-sm transition-colors">All Products</Link>
                <Link to="/products?sort=newest" className="block text-gray-400 hover:text-orange-400 text-sm transition-colors">New Arrivals</Link>
                <Link to="/products?sort=featured" className="block text-gray-400 hover:text-orange-400 text-sm transition-colors">Featured Deals</Link>
                <Link to="/cart" className="block text-gray-400 hover:text-orange-400 text-sm transition-colors">My Cart</Link>
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-4">Customer Care</h3>
              <div className="space-y-2 text-gray-400 text-sm">
                <p>Delivery across Ghana</p>
                <p>1-3 days in Takoradi</p>
                <p>3-7 days outside Takoradi</p>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 transition-colors">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp support
                </a>
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-4">Contact</h3>
              <div className="space-y-2 text-gray-400 text-sm">
                <p>Takoradi, Ghana</p>
                {store?.supportNumber ? (
                  <a href={`tel:${store.supportNumber}`} className="block hover:text-orange-400 transition-colors">{store.supportNumber}</a>
                ) : null}
                <p>{store?.address || 'Ghana'}</p>
              </div>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-500 text-sm">
            © {new Date().getFullYear()} {brand}. Powered by Adimat.
             Developed by <a href="https://blaisedrichndedeackah.vercel.app" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600 transition-colors">Blaisedrich Ndede Ackah</a>.
          </div>
        </div>
      </footer>
    </div>
  );
}

function EmptyState({ title, description, whatsappUrl }: { title: string; description: string; whatsappUrl: string }) {
  return (
    <div className="rounded-3xl bg-white px-4 py-16 text-center shadow-sm ring-1 ring-gray-100">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-600">
        <Store className="h-8 w-8" />
      </div>
      <h3 className="text-xl font-semibold text-gray-800 mb-2">{title}</h3>
      <p className="text-gray-500 max-w-md mx-auto mb-6">
        {description}
      </p>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          to="/products"
          className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-medium px-6 py-3 rounded-full transition-colors"
        >
          Browse shop
          <ArrowRight className="w-4 h-4" />
        </Link>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 border border-orange-200 bg-white px-6 py-3 font-medium text-orange-600 transition-colors hover:bg-orange-50 rounded-full"
        >
          Message us
          <MessageCircle className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
