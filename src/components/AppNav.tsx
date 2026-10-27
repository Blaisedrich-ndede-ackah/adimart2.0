import { useEffect, useMemo, useState } from 'react';
import {
  ScanBarcode, Package, BarChart3, Settings, LogOut, Bluetooth, Receipt, House,
  CalendarClock, ShoppingBag, MoreHorizontal, X, PiggyBank, BookOpen, MessagesSquare, Moon, Sun,
  ShoppingCart, RotateCcw,
  ContactRound, ArrowLeftRight, Building2, Megaphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { listLocalStores } from '@/lib/dexie';
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
  /** Compact label used in the mobile bottom bar. */
  shortLabel?: string;
  icon: LucideIcon;
  show: boolean;
  /** External destination opened in a new tab instead of in-app navigation. */
  href?: string;
}

export default function AppNav({ currentPage, onNavigate }: AppNavProps) {
  const { currentUser, currentStore, switchUser } = useAuthStore();
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const [storeCount, setStoreCount] = useState(1);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('adimat-theme') === 'dark' ||
      (!window.localStorage.getItem('adimat-theme') && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  });
  const leftHanded = useAccessibilityStore((state) => state.leftHanded);
  const isOwner = currentUser?.role === 'owner';
  const ecommerceEnabled = (currentStore?.ecommerce_enabled ?? 0) === 1;
  const canManageEcommerce =
    isOwner || (currentUser?.can_manage_ecommerce ?? 0) === 1;
  const cashbookOk = canAccessCashbook(currentUser);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
    window.localStorage.setItem('adimat-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    let active = true;
    void listLocalStores().then((stores) => {
      if (active) setStoreCount(Math.max(1, stores.length));
    });
    return () => {
      active = false;
    };
  }, [currentStore?.id]);

  const navItems = useMemo<NavItem[]>(
    () =>
      [
        { id: 'home', label: t('nav.dashboard'), icon: House, show: isOwner },
        { id: 'pos', label: t('nav.pos'), icon: ScanBarcode, show: true },
        {
          id: 'transactions',
          label: isOwner ? t('nav.salesRecords') : t('nav.mySales'),
          shortLabel: isOwner ? t('nav.sales') : t('nav.mySales'),
          icon: Receipt,
          show: true,
        },
        { id: 'customers', label: 'Customers', icon: ContactRound, show: isOwner },
        { id: 'returns', label: 'Returns', icon: RotateCcw, show: isOwner },
        { id: 'expenses', label: t('nav.expenses'), icon: PiggyBank, show: true },
        { id: 'cashbook', label: t('nav.cashbook'), icon: BookOpen, show: cashbookOk },
        { id: 'devices', label: t('nav.devices'), icon: Bluetooth, show: true },
        { id: 'learn', label: 'Learn Adimat', icon: BookOpen, show: true },
        { id: 'campaigns', label: 'Promotions', icon: Megaphone, show: true },
        { id: 'subscription', label: t('nav.plan'), icon: CalendarClock, show: isOwner },
        { id: 'inventory', label: t('nav.inventory'), icon: Package, show: isOwner },
        { id: 'warehouse', label: 'Branch inventory', icon: ArrowLeftRight, show: isOwner },
        { id: 'multistore', label: t('nav.allStores'), icon: Building2, show: isOwner && storeCount > 1 },
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
    [isOwner, ecommerceEnabled, canManageEcommerce, cashbookOk, storeCount, t]
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

  // Group secondary items into logical sections for the mobile More sheet.
  type NavGroup = { label: string; ids: string[] };
  const navGroups: NavGroup[] = [
    { label: t('nav.main'), ids: ['home', 'pos', 'transactions'] },
    { label: 'Shop', ids: ['inventory', 'purchasing', 'warehouse', 'ecommerce', 'multistore'] },
    { label: 'Operations', ids: ['reports', 'expenses', 'cashbook', 'devices', 'subscription', 'returns', 'customers'] },
    { label: 'Help', ids: ['learn', 'campaigns', 'community', 'settings'] },
  ];
  const groupedMoreItems = navGroups
    .map((group) => ({
      group,
      items: navItems.filter((item) => group.ids.includes(item.id)),
    }))
    .filter((entry) => entry.items.length > 0);

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
      <aside className={`ios-pane hidden lg:flex w-60 xl:w-72 shrink-0 flex-col self-stretch text-ink border-white/50 ${
        leftHanded ? 'lg:order-2 border-l' : 'border-r'
      }`}>
        <div className="px-4 pt-6 pb-3">
          <p className="text-[13px] font-semibold text-muted">Adimat</p>
          <p className="font-bold text-[22px] tracking-tight truncate leading-tight mt-0.5">{currentStore?.name || 'Store'}</p>
          <p className="text-muted text-[13px] mt-1 truncate capitalize">
            {currentUser?.name} · {currentUser?.role === 'owner' ? t('role.owner') : t('role.cashier')}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto py-1 px-2 space-y-1">
          {navGroups.map((group) => {
            const groupItems = navItems.filter((item) => group.ids.includes(item.id));
            if (groupItems.length === 0) return null;
            return (
              <div key={group.label} className="pt-1">
                <p className="px-3 pb-1 pt-3 text-[13px] font-semibold text-muted">
                  {group.label}
                </p>
                {groupItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = !item.href && currentPage === item.id;
                  const className = `w-full flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-[15px] font-medium transition-colors touch-target ${
                    isActive
                      ? 'bg-white text-primary shadow-[0_1px_2px_rgba(0,0,0,0.05),0_0_0_0.5px_rgba(60,60,67,0.12)]'
                      : 'text-ink hover:bg-black/[0.04] active:bg-black/[0.06]'
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
              </div>
            );
          })}
        </nav>
        <div className="p-2 border-t border-black/10 space-y-1">
          <AccessibilityControls variant="sidebar" />
          <LanguageSwitcher variant="light" compact />
          <button
            type="button"
            onClick={() => setDarkMode((enabled) => !enabled)}
            aria-pressed={darkMode}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink hover:bg-black/[0.04] dark:hover:bg-white/[0.08] touch-target"
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {darkMode ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            type="button"
            onClick={switchUser}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-[15px] font-medium text-ink hover:bg-black/[0.04] touch-target"
          >
            <LogOut className="w-5 h-5" />
            {t('nav.switchUser')}
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav — primary destinations only */}
      <nav
        className="ios-tabbar lg:hidden fixed bottom-0 z-40"
        style={{
          left: 'env(safe-area-inset-left)',
          right: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="mx-auto flex w-full max-w-lg items-stretch justify-around px-1 pt-1.5 pb-1">
          {primaryItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id && !moreOpen;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                data-active={isActive}
                className="ios-tab-item flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 touch-target"
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 1.8} />
                <span className={`max-w-full truncate text-[10px] leading-none tracking-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
                  {item.shortLabel || item.label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            data-active={moreOpen || moreActive}
            className="ios-tab-item flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 touch-target"
            aria-expanded={moreOpen}
            aria-label={t('nav.moreMenu')}
          >
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={moreOpen || moreActive ? 2.4 : 1.8} />
            <span className={`text-[10px] leading-none tracking-tight ${moreOpen || moreActive ? 'font-semibold' : 'font-medium'}`}>
              {t('common.more')}
            </span>
          </button>
        </div>
      </nav>

      {/* Mobile More sheet — grouped vertical list for 12+ items */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label={t('common.close')}
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="ios-glass relative max-h-[82vh] max-h-[82dvh] overflow-y-auto rounded-t-[20px] shadow-2xl animate-slide-up"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            <div className="ios-pane sticky top-0 z-10 px-4 pb-2 pt-2">
              <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-black/20" />
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-muted">
                    {t('common.menu')}
                  </p>
                  <p className="truncate text-[17px] font-bold tracking-tight text-ink">
                    {currentStore?.name || t('common.store')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="icon-btn"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="space-y-4 px-4 py-2">
              {groupedMoreItems.map(({ group, items }) => (
                <div key={group.label}>
                  <div className="px-3 pb-1.5 text-[13px] font-semibold text-muted">
                    {group.label}
                  </div>
                  <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_0_0_0.5px_rgba(60,60,67,0.12)]">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const isActive = !item.href && currentPage === item.id;
                      const className = `flex w-full items-center gap-3 border-b border-black/[0.06] px-3 py-2.5 text-left touch-target last:border-b-0 ${
                        isActive ? 'text-primary' : 'text-ink active:bg-black/[0.04]'
                      }`;
                      const content = (
                        <>
                          <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={isActive ? 2.4 : 1.8} />
                          <span className={`text-[17px] tracking-tight ${isActive ? 'font-semibold' : 'font-normal'}`}>
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
                </div>
              ))}

              <div className="space-y-2 pt-1">
                <AccessibilityControls variant="menu" />
  <LanguageSwitcher compact />
  <button
  type="button"
  onClick={() => setDarkMode((enabled) => !enabled)}
  aria-pressed={darkMode}
  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 touch-target dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
  >
  {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
  {darkMode ? 'Light mode' : 'Dark mode'}
  </button>
  <button
  type="button"
  onClick={() => {
                    setMoreOpen(false);
                    switchUser();
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-white px-4 py-3 text-[17px] font-normal text-[#FF3B30] touch-target shadow-[0_0_0_0.5px_rgba(60,60,67,0.12)]"
                >
                  <LogOut className="h-4 w-4" />
                  {t('nav.switchUser')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
