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
    <div className="flex-shrink-0 bg-white border-b border-emerald-100 px-3 md:px-5 py-2 md:py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <img
          src={logoUrl!}
          alt={`${storeName} logo`}
          className="w-10 h-10 md:w-11 md:h-11 rounded-xl object-cover border border-emerald-50 bg-white flex-shrink-0"
        />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            Your store
          </p>
          <p className="text-sm font-bold text-slate-900 truncate">{storeName}</p>
        </div>
      </div>
    </div>
  );
}
