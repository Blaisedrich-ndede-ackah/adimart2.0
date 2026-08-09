import {
  ScanBarcode, Package, BarChart3, Settings, LogOut, Bluetooth, Receipt,
  CalendarClock, Warehouse, ShoppingBag
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

interface AppNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export default function AppNav({ currentPage, onNavigate }: AppNavProps) {
  const { currentUser, currentStore, switchUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const warehouseEnabled = (currentStore?.warehouse_enabled ?? 0) === 1;
  const ecommerceEnabled = (currentStore?.ecommerce_enabled ?? 0) === 1;
  const canManageEcommerce =
    isOwner || (currentUser?.can_manage_ecommerce ?? 0) === 1;

  const navItems = [
    { id: 'pos', label: 'POS', icon: ScanBarcode, show: true },
    { id: 'transactions', label: isOwner ? 'Sales' : 'My Sales', icon: Receipt, show: true },
    { id: 'devices', label: 'Devices', icon: Bluetooth, show: true },
    { id: 'subscription', label: 'Plan', icon: CalendarClock, show: true },
    { id: 'inventory', label: 'Inventory', icon: Package, show: isOwner },
    { id: 'warehouse', label: 'Warehouse', icon: Warehouse, show: isOwner && warehouseEnabled },
    {
      id: 'ecommerce',
      label: 'Online',
      icon: ShoppingBag,
      show: ecommerceEnabled && canManageEcommerce,
    },
    { id: 'reports', label: 'Reports', icon: BarChart3, show: isOwner },
    { id: 'settings', label: 'Settings', icon: Settings, show: isOwner },
  ].filter((item) => item.show);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 lg:w-64 shrink-0 flex-col self-stretch bg-primary text-white border-r border-primary-dark">
        <div className="px-4 py-5 border-b border-white/10">
          <p className="text-emerald-200 text-[10px] font-semibold uppercase tracking-[0.14em]">Adimat</p>
          <p className="font-bold text-xl tracking-tight truncate mt-1">{currentStore?.name || 'Store'}</p>
          <p className="text-emerald-100/80 text-xs mt-1 truncate capitalize">
            {currentUser?.name} · {currentUser?.role}
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors touch-target ${
                  isActive
                    ? 'bg-white text-primary shadow-sm'
                    : 'text-emerald-50 hover:bg-white/10'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-2 border-t border-white/10">
          <button
            type="button"
            onClick={switchUser}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-emerald-50 hover:bg-white/10 touch-target"
          >
            <LogOut className="w-5 h-5" />
            Switch user
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-emerald-100 z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-around px-0.5 py-1 overflow-x-auto no-scrollbar max-w-3xl mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg touch-target flex-1 min-w-0 transition-colors ${
                  isActive
                    ? 'text-primary bg-emerald-50'
                    : 'text-gray-500 hover:text-primary'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                <span className={`text-[9px] mt-0.5 truncate max-w-full ${isActive ? 'font-bold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={switchUser}
            className="flex flex-col items-center justify-center py-2 px-1.5 rounded-lg touch-target flex-1 min-w-0 text-gray-500 hover:text-red-500 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-[9px] mt-0.5 font-medium">Switch</span>
          </button>
        </div>
      </nav>
    </>
  );
}
