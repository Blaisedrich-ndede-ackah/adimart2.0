import { Package } from 'lucide-react';
import { hasProductImage } from '@/lib/productImage';

interface ProductImageProps {
  src?: string | null;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASS = {
  sm: 'w-10 h-10',
  md: 'w-14 h-14',
  lg: 'w-20 h-20',
} as const;

export default function ProductImage({
  src,
  alt = 'Product',
  size = 'md',
  className = '',
}: ProductImageProps) {
  const box = SIZE_CLASS[size];

  if (hasProductImage(src)) {
    return (
      <img
        src={src!}
        alt={alt}
        className={`${box} rounded-xl object-cover bg-gray-100 flex-shrink-0 ${className}`}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`${box} rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 ${className}`}
      aria-label="No product photo"
    >
      <Package className={size === 'sm' ? 'w-4 h-4 text-gray-400' : 'w-5 h-5 text-gray-400'} />
    </div>
  );
}
