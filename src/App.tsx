import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { initAutoSync, stopAutoSync } from '@/lib/sync';
import { autoReconnectPeripherals } from '@/lib/bluetoothPeripherals';
import { isAdminSessionActive, clearAdminSession } from '@/lib/adminAuth';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import SubscriptionWarningBanner from '@/components/SubscriptionWarningBanner';
import StoreBrandingBar from '@/components/StoreBrandingBar';
import AppNav from '@/components/AppNav';
import StoreSetupPage from '@/pages/StoreSetupPage';
import LoginPage from '@/pages/LoginPage';
import CashierBlockedPage from '@/pages/CashierBlockedPage';
import POSPage from '@/pages/POSPage';
import InventoryPage from '@/pages/InventoryPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';
import DevicesPage from '@/pages/DevicesPage';
import TransactionsPage from '@/pages/TransactionsPage';
import SubscriptionPage from '@/pages/SubscriptionPage';
import WarehousePage from '@/pages/WarehousePage';
import AdminLoginPage from '@/pages/AdminLoginPage';
import AdminDashboardPage from '@/pages/AdminDashboardPage';
import { checkAndSendSubscriptionExpirySms } from '@/lib/subscriptionReminders';

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
    // Cashiers cannot stay on owner-only pages after switch/login
    if (currentUser?.role === 'cashier' && ['inventory', 'reports', 'settings', 'warehouse'].includes(currentPage)) {
      setCurrentPage('pos');
    }
  }, [currentUser, currentPage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void checkAndSendSubscriptionExpirySms();
    const timer = window.setInterval(() => void checkAndSendSubscriptionExpirySms(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated]);

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

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-primary flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <img src="/logo.png" alt="Adimat" className="w-10 h-10 object-contain" />
          </div>
          <p className="text-white font-medium tracking-wide">Loading Adimat…</p>
        </div>
      </div>
    );
  }

  if (!isStoreSetup) {
    return (
      <div className="h-[100dvh] flex flex-col bg-[var(--color-surface)]">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StoreSetupPage onOpenAdmin={() => setAppMode('admin-login')} />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-[100dvh] flex flex-col bg-[var(--color-surface)]">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <LoginPage onOpenAdmin={() => setAppMode('admin-login')} />
        </div>
      </div>
    );
  }

  if (currentUser?.role === 'cashier' && currentUser.is_active === 0) {
    return (
      <div className="h-[100dvh] flex flex-col bg-[var(--color-surface)]">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <CashierBlockedPage />
        </div>
      </div>
    );
  }

  const renderPage = () => {
    const role = currentUser?.role;
    switch (currentPage) {
      case 'pos':
        return <POSPage />;
      case 'transactions':
        return <TransactionsPage />;
      case 'devices':
        return <DevicesPage />;
      case 'subscription':
        return <SubscriptionPage />;
      case 'inventory':
        return role === 'owner' ? <InventoryPage /> : <POSPage />;
      case 'warehouse':
        return role === 'owner' ? <WarehousePage /> : <POSPage />;
      case 'reports':
        return role === 'owner' ? <ReportsPage /> : <POSPage />;
      case 'settings':
        return role === 'owner' ? <SettingsPage /> : <POSPage />;
      default:
        return <POSPage />;
    }
  };

  return (
    <div className="app-frame md:flex-row md:h-[100dvh] md:overflow-hidden">
      <AppNav currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 md:h-[100dvh] md:overflow-hidden">
        <PWAInstallBanner />
        <SubscriptionWarningBanner onOpenPlan={() => setCurrentPage('subscription')} />
        <StoreBrandingBar />
        <div className="flex-1 min-h-0 overflow-hidden pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
