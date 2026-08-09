import { ScanBarcode, Package, BarChart3, Settings, LogOut, Bluetooth, Receipt, CalendarClock, Warehouse } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

interface BottomNavProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

export default function BottomNav({ currentPage, onNavigate }: BottomNavProps) {
  const { currentUser, currentStore, switchUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const warehouseEnabled = (currentStore?.warehouse_enabled ?? 0) === 1;

  const navItems = [
    { id: 'pos', label: 'POS', icon: ScanBarcode, show: true },
    { id: 'transactions', label: isOwner ? 'Sales' : 'My Sales', icon: Receipt, show: true },
    { id: 'devices', label: 'Devices', icon: Bluetooth, show: true },
    { id: 'subscription', label: 'Plan', icon: CalendarClock, show: true },
    { id: 'inventory', label: 'Inventory', icon: Package, show: isOwner },
    { id: 'warehouse', label: 'Warehouse', icon: Warehouse, show: isOwner && warehouseEnabled },
    { id: 'reports', label: 'Reports', icon: BarChart3, show: isOwner },
    { id: 'settings', label: 'Settings', icon: Settings, show: isOwner },
  ].filter(item => item.show);

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center justify-around px-0.5 py-1 overflow-x-auto no-scrollbar">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg touch-target flex-1 min-w-0 transition-colors ${
                isActive
                  ? 'text-primary bg-emerald-50'
                  : 'text-gray-500 hover:text-gray-700'
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
          onClick={switchUser}
          className="flex flex-col items-center justify-center py-2 px-1.5 rounded-lg touch-target flex-1 min-w-0 text-gray-500 hover:text-red-500 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[9px] mt-0.5 font-medium">Switch</span>
        </button>
      </div>
    </nav>
  );
}
