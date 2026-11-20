import { useAuthStore } from '@/store/useAuthStore';
import { hasStoreLogo } from '@/lib/productImage';

/**
 * Top-of-app store branding for authenticated owners and cashiers.
 * Shows when the store owner has uploaded a logo in Settings.
 */
export default function StoreBrandingBar() {
  const { currentStore } = useAuthStore();
  const logoUrl = currentStore?.logo_url;
  const storeName = currentStore?.name?.trim() || 'Store';

  if (!hasStoreLogo(logoUrl)) return null;

  return (
    <div className="flex-shrink-0 border-b border-black/10 bg-white/80 px-4 py-2 backdrop-blur-md md:px-5">
      <div className="flex items-center gap-3 min-w-0">
        <img
          src={logoUrl!}
          alt={`${storeName} logo`}
          className="h-9 w-9 flex-shrink-0 rounded-[10px] border border-black/5 bg-white object-cover md:h-10 md:w-10"
        />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">Your store</p>
          <p className="truncate text-[15px] font-semibold tracking-tight text-ink">{storeName}</p>
        </div>
      </div>
    </div>
  );
}
