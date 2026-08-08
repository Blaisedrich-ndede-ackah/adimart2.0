import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { initAutoSync, stopAutoSync } from '@/lib/sync';
import { autoReconnectPeripherals } from '@/lib/bluetoothPeripherals';
import { isAdminSessionActive, clearAdminSession } from '@/lib/adminAuth';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import BottomNav from '@/components/BottomNav';
import StoreSetupPage from '@/pages/StoreSetupPage';
import LoginPage from '@/pages/LoginPage';
import POSPage from '@/pages/POSPage';
import InventoryPage from '@/pages/InventoryPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';
import AdminLoginPage from '@/pages/AdminLoginPage';
import AdminDashboardPage from '@/pages/AdminDashboardPage';

type AppMode = 'store' | 'admin-login' | 'admin';

export default function App() {
  const { isAuthenticated, currentUser, isStoreSetup, isLoading, initialize } = useAuthStore();
  const [currentPage, setCurrentPage] = useState('pos');
  const [appMode, setAppMode] = useState<AppMode>(() =>
    isAdminSessionActive() ? 'admin' : 'store'
  );

  useEffect(() => {
    initialize();
    initAutoSync();
    void autoReconnectPeripherals();
    return () => stopAutoSync();
  }, [initialize]);

  useEffect(() => {
    if (currentUser?.role === 'cashier') {
      setCurrentPage('pos');
    }
  }, [currentUser]);

  if (appMode === 'admin-login') {
    return (
      <AdminLoginPage
        onSuccess={() => setAppMode('admin')}
        onBack={() => setAppMode('store')}
      />
    );
  }

  if (appMode === 'admin') {
    return (
      <AdminDashboardPage
        onLogout={() => {
          clearAdminSession();
          setAppMode('store');
        }}
      />
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
            <img src="/logo.png" alt="Adimat" className="w-10 h-10 object-contain" />
          </div>
          <p className="text-white font-medium">Loading Adimat...</p>
        </div>
      </div>
    );
  }

  // Show store setup for first-time users
  if (!isStoreSetup) {
    return (
      <div className="h-screen flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1">
          <StoreSetupPage onOpenAdmin={() => setAppMode('admin-login')} />
        </div>
      </div>
    );
  }

  // Show login page
  if (!isAuthenticated) {
    return (
      <div className="h-screen flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1">
          <LoginPage onOpenAdmin={() => setAppMode('admin-login')} />
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'pos':
        return <POSPage />;
      case 'inventory':
        return <InventoryPage />;
      case 'reports':
        return <ReportsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <POSPage />;
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <PWAInstallBanner />
      <div className="flex-1 overflow-hidden">
        {renderPage()}
      </div>
      <BottomNav currentPage={currentPage} onNavigate={setCurrentPage} />
    </div>
  );
}
