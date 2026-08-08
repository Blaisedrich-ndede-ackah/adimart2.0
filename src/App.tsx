import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { initAutoSync, stopAutoSync } from '@/lib/sync';
import { autoReconnectPeripherals } from '@/lib/bluetoothPeripherals';
import { isAdminSessionActive, clearAdminSession } from '@/lib/adminAuth';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import SubscriptionWarningBanner from '@/components/SubscriptionWarningBanner';
import StoreBrandingBar from '@/components/StoreBrandingBar';
import BottomNav from '@/components/BottomNav';
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
    if (currentUser?.role === 'cashier' && ['inventory', 'reports', 'settings'].includes(currentPage)) {
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

  // Blocked cashiers can authenticate but cannot use the POS
  if (currentUser?.role === 'cashier' && currentUser.is_active === 0) {
    return (
      <div className="h-screen flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1">
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
      case 'reports':
        return role === 'owner' ? <ReportsPage /> : <POSPage />;
      case 'settings':
        return role === 'owner' ? <SettingsPage /> : <POSPage />;
      default:
        return <POSPage />;
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <PWAInstallBanner />
      <SubscriptionWarningBanner onOpenPlan={() => setCurrentPage('subscription')} />
      <StoreBrandingBar />
      <div className="flex-1 overflow-hidden">
        {renderPage()}
      </div>
      <BottomNav currentPage={currentPage} onNavigate={setCurrentPage} />
    </div>
  );
}
