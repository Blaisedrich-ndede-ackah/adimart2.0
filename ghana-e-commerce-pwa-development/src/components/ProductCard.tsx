import { Link } from 'react-router-dom';
import { ShoppingCart, Star, Truck } from 'lucide-react';
import type { Product } from '@/lib/types';
import { useCartStore } from '@/store/cartStore';
import toast from 'react-hot-toast';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const addItem = useCartStore((s) => s.addItem);

  const primaryImage = product.images?.find((img) => img.is_primary)?.image_url
    || product.images?.[0]?.image_url
    || 'https://placehold.co/400x400/FFF7ED/EA580C?text=No+Image';

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addItem(product);
    toast.success(`${product.name} added to cart!`, {
      icon: '',
      style: {
        borderRadius: '12px',
        background: '#1F2937',
        color: '#fff',
      },
    });
  };

  return (
    <Link
      to={`/product/${product.id}`}
      className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-orange-200 hover:-translate-y-1"
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-orange-50">
        <img
          src={primaryImage}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
          loading="lazy"
        />
        {product.is_featured && (
          <div className="absolute top-3 left-3 flex items-center gap-1 bg-gradient-to-r from-orange-500 to-yellow-400 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
            <Star className="w-3 h-3 fill-current" />
            Featured
          </div>
        )}
        {product.stock_quantity <= 0 && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-red-500 text-white px-4 py-2 rounded-full font-bold text-sm">
              Out of Stock
            </span>
          </div>
        )}
        {/* Quick Add Button */}
        {product.stock_quantity > 0 && (
          <button
            onClick={handleAddToCart}
            className="absolute bottom-3 right-3 bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-full shadow-lg opacity-100 transform translate-y-0 transition-all duration-300 md:opacity-0 md:translate-y-2 md:group-hover:opacity-100 md:group-hover:translate-y-0"
            aria-label={`Add ${product.name} to cart`}
          >
            <ShoppingCart className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <p className="text-xs font-medium text-orange-500 uppercase tracking-wide mb-1">
          {product.category}
        </p>
        <h3 className="font-semibold text-gray-800 text-sm line-clamp-2 mb-2 group-hover:text-orange-600 transition-colors">
          {product.name}
        </h3>
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-gray-900">
            ₵{product.price.toLocaleString('en-GH', { minimumFractionDigits: 2 })}
          </span>
          {product.stock_quantity > 0 && product.stock_quantity <= 5 && (
            <span className="text-xs text-red-500 font-medium">
              Only {product.stock_quantity} left
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className={`font-semibold ${product.stock_quantity > 0 ? 'text-green-600' : 'text-red-500'}`}>
            {product.stock_quantity > 0 ? 'In stock' : 'Unavailable'}
          </span>
          {product.stock_quantity > 0 && (
            <span className="inline-flex items-center gap-1 text-gray-500">
              <Truck className="h-3.5 w-3.5 text-orange-500" />
              Fast delivery
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 animate-pulse">
      <div className="aspect-square bg-gray-200" />
      <div className="p-4 space-y-3">
        <div className="h-3 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-3/4" />
        <div className="h-5 bg-gray-200 rounded w-1/2" />
      </div>
    </div>
  );
}
