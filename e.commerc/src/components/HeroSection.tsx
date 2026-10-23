import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, CreditCard, Search, ShieldCheck, Truck } from 'lucide-react';
import type { Product } from '@/lib/types';

interface HeroSectionProps {
  featuredProducts: Product[];
  loading?: boolean;
}

export default function HeroSection({ featuredProducts = [], loading = false }: HeroSectionProps) {
  const slides = featuredProducts.slice(0, 4);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const hasFeatured = slides.length > 0 && !loading;

  useEffect(() => {
    if (!hasFeatured) return;
    const intervalId = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slides.length);
    }, 6000);
    return () => window.clearInterval(intervalId);
  }, [hasFeatured, slides.length]);

  useEffect(() => {
    if (activeIndex >= slides.length) {
      setActiveIndex(0);
    }
  }, [slides.length, activeIndex]);

  const activeProduct = slides[activeIndex];

  const heroImage = activeProduct?.images?.find((img) => img.is_primary)?.image_url
    || activeProduct?.images?.[0]?.image_url
    || 'https://placehold.co/900x700/FFF7ED/EA580C?text=Featured+Product';

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    navigate(query ? `/products?search=${encodeURIComponent(query)}` : '/products');
  };

  return (
    <div className="relative">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-white via-orange-50/70 to-white">
        <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-orange-200/40 blur-3xl" />
        <div className="absolute -right-24 bottom-8 h-72 w-72 rounded-full bg-yellow-200/50 blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_520px] items-center">
            {/* Left content */}
            <div className="text-center lg:text-left max-w-3xl mx-auto lg:mx-0">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-4 py-2 text-sm font-semibold text-orange-600 shadow-sm">
                <ShieldCheck className="h-4 w-4" />
                Trusted online shopping in Ghana
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight mb-4">
                Shop trusted products with
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-orange-500 via-yellow-500 to-green-500">fast Ghana delivery</span>
              </h1>
              <p className="text-base sm:text-lg text-gray-600 mb-6 max-w-2xl">
                Discover quality products at great prices, pay with Mobile Money or cash on delivery,
                and get friendly support from BONDZTECH in Takoradi.
              </p>

              <form onSubmit={handleSearch} className="mx-auto mb-5 flex max-w-xl rounded-full bg-white p-2 shadow-xl shadow-orange-200/40 ring-1 ring-orange-100 lg:mx-0">
                <div className="flex flex-1 items-center gap-3 px-3">
                  <Search className="h-5 w-5 shrink-0 text-gray-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search phones, fashion, beauty..."
                    className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 sm:text-base"
                  />
                </div>
                <button type="submit" className="rounded-full bg-orange-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-orange-600">
                  Search
                </button>
              </form>

              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <Link to="/products" className="inline-flex items-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold px-6 py-3 rounded-full shadow-lg shadow-orange-200 transition-transform hover:-translate-y-0.5">
                  Shop Now
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <a href="#categories" className="inline-flex items-center gap-2 bg-white text-gray-700 font-semibold px-6 py-3 rounded-full border border-gray-200 transition-colors hover:border-orange-200 hover:text-orange-600">
                  Browse Categories
                </a>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
                {[
                  { label: 'Fast delivery', icon: Truck },
                  { label: 'Mobile Money', icon: CreditCard },
                  { label: 'Secure checkout', icon: ShieldCheck },
                ].map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-3 text-sm font-semibold text-gray-700 ring-1 ring-orange-100">
                      <ItemIcon className="h-4 w-4 text-orange-500" />
                      {item.label}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: hero image with overlaid product details */}
            <div className="relative">
              <div className="relative overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-orange-200/50 ring-1 ring-orange-100">
                <img src={heroImage} alt={activeProduct?.name ?? 'Featured product'} className="w-full h-[360px] sm:h-[440px] object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                {hasFeatured ? (
                  <>
                    <div className="absolute left-5 right-5 bottom-6 text-white sm:left-7 sm:right-7">
                      <p className="text-xs font-semibold uppercase text-orange-300 tracking-[0.2em]">Featured product</p>
                      <h2 className="mt-2 text-2xl sm:text-3xl font-bold leading-tight">{activeProduct?.name}</h2>
                      <p className="mt-2 max-w-md text-sm text-gray-100 line-clamp-2">{activeProduct?.description}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Link to={`/product/${activeProduct?.id}`} className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 py-2 rounded-full">
                          View Product
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                        <span className="rounded-full bg-white/15 px-4 py-2 text-lg sm:text-2xl font-extrabold backdrop-blur">₵{activeProduct?.price.toLocaleString('en-GH', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>

                    {/* Prev / Next */}
                    <button onClick={() => setActiveIndex((prev) => (prev === 0 ? slides.length - 1 : prev - 1))} className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-gray-800 shadow-lg transition-colors hover:bg-white" aria-label="Previous slide">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button onClick={() => setActiveIndex((prev) => (prev + 1) % slides.length)} className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-gray-800 shadow-lg transition-colors hover:bg-white" aria-label="Next slide">
                      <ChevronRight className="w-5 h-5" />
                    </button>

                    {/* Dots */}
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-2">
                      {slides.map((_, idx) => (
                        <button key={`hero-dot-${idx}`} onClick={() => setActiveIndex(idx)} className={`h-2.5 rounded-full transition-all ${idx === activeIndex ? 'w-6 bg-orange-500' : 'w-2.5 bg-white/70'}`} aria-label={`Select slide ${idx + 1}`} />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-x-5 bottom-6 rounded-3xl bg-white/90 p-5 text-gray-900 shadow-xl backdrop-blur sm:inset-x-7">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-500">Featured products</p>
                    <h2 className="mt-2 text-2xl font-bold">Fresh finds are coming soon</h2>
                    <p className="mt-2 text-sm leading-6 text-gray-600">
                      Browse the shop or message BONDZTECH for current availability and recommendations.
                    </p>
                  </div>
                )}
              </div>

              {/* Thumbnails below image */}
              {hasFeatured && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {slides.map((product, idx) => {
                    const thumbImage = product.images?.find((img) => img.is_primary)?.image_url || product.images?.[0]?.image_url || 'https://placehold.co/300x300/FFF7ED/EA580C?text=No+Image';
                    return (
                      <Link key={product.id} to={`/product/${product.id}`} onClick={() => setActiveIndex(idx)} className={`block overflow-hidden rounded-2xl bg-white shadow-sm transition-all ${idx === activeIndex ? 'ring-2 ring-orange-400' : 'ring-1 ring-orange-100 hover:ring-orange-200'}`} aria-label={`Open ${product.name}`}>
                        <img src={thumbImage} alt={product.name} className="h-20 w-full object-cover" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

     
    </div>
  );
}
