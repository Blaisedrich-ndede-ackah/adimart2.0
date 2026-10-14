import { useEffect, useMemo, useState } from 'react';
import {
  ScanBarcode, Package, BarChart3, Settings, LogOut, Bluetooth, Receipt, House,
  CalendarClock, ShoppingBag, MoreHorizontal, X, PiggyBank, BookOpen, MessagesSquare,
  ShoppingCart, RotateCcw,
  ContactRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useAccessibilityStore } from '@/lib/accessibility';
import { COMMUNITY_CHAT_URL } from '@/lib/community';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import AccessibilityControls from '@/components/AccessibilityControls';
import { useT } from '@/lib/i18n';
import { canAccessCashbook } from '@/lib/staffAccess';

interface AppNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
  /** External destination opened in a new tab instead of in-app navigation. */
  href?: string;
}

export default function AppNav({ currentPage, onNavigate }: AppNavProps) {
  const { currentUser, currentStore, switchUser } = useAuthStore();
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const leftHanded = useAccessibilityStore((state) => state.leftHanded);
  const isOwner = currentUser?.role === 'owner';
  const ecommerceEnabled = (currentStore?.ecommerce_enabled ?? 0) === 1;
  const canManageEcommerce =
    isOwner || (currentUser?.can_manage_ecommerce ?? 0) === 1;
  const cashbookOk = canAccessCashbook(currentUser);

  const navItems = useMemo<NavItem[]>(
    () =>
      [
        { id: 'home', label: 'Home', icon: House, show: isOwner },
        { id: 'pos', label: t('nav.pos'), icon: ScanBarcode, show: true },
        { id: 'transactions', label: isOwner ? t('nav.sales') : t('nav.mySales'), icon: Receipt, show: true },
        { id: 'customers', label: 'Customers', icon: ContactRound, show: isOwner },
        { id: 'returns', label: 'Returns', icon: RotateCcw, show: isOwner },
        { id: 'expenses', label: t('nav.expenses'), icon: PiggyBank, show: true },
        { id: 'cashbook', label: t('nav.cashbook'), icon: BookOpen, show: cashbookOk },
        { id: 'devices', label: t('nav.devices'), icon: Bluetooth, show: true },
        { id: 'learn', label: 'Learn Adimat', icon: BookOpen, show: true },
        { id: 'subscription', label: t('nav.plan'), icon: CalendarClock, show: isOwner },
        { id: 'inventory', label: t('nav.inventory'), icon: Package, show: isOwner },
        { id: 'purchasing', label: 'Purchasing', icon: ShoppingCart, show: isOwner },
        {
          id: 'ecommerce',
          label: t('nav.online'),
          icon: ShoppingBag,
          show: ecommerceEnabled && canManageEcommerce,
        },
        { id: 'reports', label: t('nav.reports'), icon: BarChart3, show: isOwner },
        { id: 'settings', label: t('nav.settings'), icon: Settings, show: isOwner },
        {
          id: 'community',
          label: t('nav.community'),
          icon: MessagesSquare,
          show: true,
          href: COMMUNITY_CHAT_URL,
        },
      ].filter((item) => item.show),
    [isOwner, ecommerceEnabled, canManageEcommerce, cashbookOk, t]
  );

  // Keep bottom bar to a few primary destinations; rest live under More
  const primaryIds: readonly string[] = isOwner
    ? ['home', 'pos', 'transactions']
    : cashbookOk
      ? ['pos', 'transactions', 'cashbook']
      : ['pos', 'transactions', 'expenses'];

  const primaryItems = navItems.filter((item) => primaryIds.includes(item.id));
  const moreItems = navItems.filter((item) => !primaryIds.includes(item.id));
  const moreActive = moreItems.some((item) => item.id === currentPage);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const go = (page: string) => {
    setMoreOpen(false);
    onNavigate(page);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex w-56 xl:w-64 shrink-0 flex-col self-stretch bg-primary text-white border-primary-dark ${
        leftHanded ? 'lg:order-2 border-l border-r-0' : 'border-r'
      }`}>
        <div className="px-4 py-5 border-b border-white/10">
          <p className="text-emerald-200 text-[10px] font-semibold uppercase tracking-[0.14em]">Adimat</p>
          <p className="font-bold text-xl tracking-tight truncate mt-1">{currentStore?.name || 'Store'}</p>
          <p className="text-emerald-100/80 text-xs mt-1 truncate capitalize">
            {currentUser?.name} · {currentUser?.role === 'owner' ? t('role.owner') : t('role.cashier')}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = !item.href && currentPage === item.id;
            const className = `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors touch-target ${
              isActive
                ? 'bg-white text-primary shadow-sm'
                : 'text-emerald-50 hover:bg-white/10'
            }`;
            const content = (
              <>
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </>
            );
            if (item.href) {
              return (
                <a
                  key={item.id}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('community.aria')}
                  className={className}
                >
                  {content}
                </a>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={className}
              >
                {content}
              </button>
            );
          })}
        </nav>
        <div className="p-2 border-t border-white/10 space-y-2">
          <AccessibilityControls variant="sidebar" />
          <LanguageSwitcher variant="onPrimary" compact />
          <button
            type="button"
            onClick={switchUser}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-emerald-50 hover:bg-white/10 touch-target"
          >
            <LogOut className="w-5 h-5" />
            {t('nav.switchUser')}
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav — primary destinations only */}
      <nav
        className="lg:hidden fixed bottom-0 z-40 border-t border-emerald-100 bg-white/95 backdrop-blur-md shadow-[0_-8px_24px_rgba(15,23,42,0.06)]"
        style={{
          left: 'env(safe-area-inset-left)',
          right: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-stretch justify-between gap-1 px-2 py-1.5">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id && !moreOpen;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-2.5 touch-target transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-primary'
                    : 'text-slate-500 active:bg-slate-50'
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                <span className={`text-[11px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-2.5 touch-target transition-colors ${
              moreOpen || moreActive
                ? 'bg-emerald-50 text-primary'
                : 'text-slate-500 active:bg-slate-50'
            }`}
            aria-expanded={moreOpen}
            aria-label={t('nav.moreMenu')}
          >
            <MoreHorizontal className={`h-5 w-5 ${moreOpen || moreActive ? 'stroke-[2.5]' : ''}`} />
            <span className={`text-[11px] leading-none ${moreOpen || moreActive ? 'font-bold' : 'font-medium'}`}>
              {t('common.more')}
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile More sheet */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label={t('common.close')}
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="relative max-h-[75vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl animate-slide-up"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3 rounded-t-3xl">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                  {t('common.menu')}
                </p>
                <p className="truncate text-sm font-bold text-slate-900">
                  {currentStore?.name || t('common.store')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-600 touch-target"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 p-4">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const isActive = !item.href && currentPage === item.id;
                const className = `flex flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-4 touch-target transition-colors ${
                  isActive
                    ? 'border-emerald-200 bg-emerald-50 text-primary'
                    : 'border-slate-100 bg-slate-50 text-slate-700 active:bg-emerald-50'
                }`;
                const content = (
                  <>
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                        isActive ? 'bg-primary text-white' : 'bg-white text-primary shadow-sm'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className={`text-xs ${isActive ? 'font-bold' : 'font-semibold'}`}>
                      {item.label}
                    </span>
                  </>
                );
                if (item.href) {
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('community.aria')}
                      onClick={() => setMoreOpen(false)}
                      className={className}
                    >
                      {content}
                    </a>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    className={className}
                  >
                    {content}
                  </button>
                );
              })}
            </div>

            <div className="px-4 pb-2 space-y-2">
              <AccessibilityControls variant="menu" />
              <LanguageSwitcher compact />
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  switchUser();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3.5 text-sm font-semibold text-rose-700 touch-target"
              >
                <LogOut className="h-4 w-4" />
                {t('nav.switchUser')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
