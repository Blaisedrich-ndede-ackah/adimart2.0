import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { initAutoSync, startLiveStockSync, stopAutoSync } from '@/lib/sync';
import { autoReconnectPeripherals } from '@/lib/bluetoothPeripherals';
import { isAdminSessionActive, clearAdminSession } from '@/lib/adminAuth';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { getUnlockedWarehouseLocationId } from '@/lib/warehouseAccess';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import SubscriptionWarningBanner from '@/components/SubscriptionWarningBanner';
import StoreBrandingBar from '@/components/StoreBrandingBar';
import AppNav from '@/components/AppNav';
import AddPhonePrompt from '@/components/AddPhonePrompt';
import StoreSetupPage from '@/pages/StoreSetupPage';
import LoginPage from '@/pages/LoginPage';
import CashierBlockedPage from '@/pages/CashierBlockedPage';
import StoreAccessBlockedPage from '@/pages/StoreAccessBlockedPage';
import POSPage from '@/pages/POSPage';
import InventoryPage from '@/pages/InventoryPage';
import ReportsPage from '@/pages/ReportsPage';
import ExpensesPage from '@/pages/ExpensesPage';
import CashBookPage from '@/pages/CashBookPage';
import SettingsPage from '@/pages/SettingsPage';
import DevicesPage from '@/pages/DevicesPage';
import TransactionsPage from '@/pages/TransactionsPage';
import SubscriptionPage from '@/pages/SubscriptionPage';
import WarehousePage from '@/pages/WarehousePage';
import EcommercePage from '@/pages/EcommercePage';
import PublicShopPage from '@/pages/PublicShopPage';
import AdminLoginPage from '@/pages/AdminLoginPage';
import AdminDashboardPage from '@/pages/AdminDashboardPage';
import { isStoreAccessBlocked } from '@/lib/subscription';
import { checkAndSendSubscriptionExpirySms } from '@/lib/subscriptionReminders';
import { canAccessCashbook } from '@/lib/staffAccess';

type AppMode = 'store' | 'admin-login' | 'admin';

function readPublicShopSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const match = hash.match(/^\/?shop\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]).trim().toLowerCase() : null;
}

function userNeedsPhone(user: { phone?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return !isValidGhanaPhone(user.phone || '');
}

export default function App() {
  const { isAuthenticated, currentUser, currentStore, isStoreSetup, isLoading, initialize, switchUser } =
    useAuthStore();
  const [currentPage, setCurrentPage] = useState('pos');
  const [appMode, setAppMode] = useState<AppMode>(() =>
    isAdminSessionActive() ? 'admin' : 'store'
  );
  const [publicShopSlug, setPublicShopSlug] = useState<string | null>(() => readPublicShopSlug());

  useEffect(() => {
    const onHashChange = () => setPublicShopSlug(readPublicShopSlug());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    initialize();
    initAutoSync();
    void autoReconnectPeripherals();
    return () => stopAutoSync();
  }, [initialize]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    return startLiveStockSync(currentStore.id);
  }, [isAuthenticated, currentStore?.id]);

  useEffect(() => {
    // Cashiers cannot stay on owner-only pages after switch/login
    if (currentUser?.role !== 'cashier') return;
    const ownerOnly = ['inventory', 'reports', 'settings', 'warehouse', 'subscription'];
    const ecommerceOk = (currentUser.can_manage_ecommerce ?? 0) === 1;
    const cashbookOk = canAccessCashbook(currentUser);
    if (
      ownerOnly.includes(currentPage) ||
      (currentPage === 'ecommerce' && !ecommerceOk) ||
      (currentPage === 'cashbook' && !cashbookOk)
    ) {
      setCurrentPage('pos');
    }
  }, [currentUser, currentPage]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    const unlocked = getUnlockedWarehouseLocationId(currentStore.id);
    if (unlocked) {
      setCurrentPage('warehouse');
    }
  }, [isAuthenticated, currentStore?.id, currentUser?.id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void checkAndSendSubscriptionExpirySms();
    const timer = window.setInterval(() => void checkAndSendSubscriptionExpirySms(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated]);

  if (publicShopSlug) {
    return <PublicShopPage slug={publicShopSlug} />;
  }

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
      <div className="h-full bg-primary flex items-center justify-center">
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
      <div className="h-full flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StoreSetupPage onOpenAdmin={() => setAppMode('admin-login')} />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-full flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <LoginPage
            onOpenAdmin={() => setAppMode('admin-login')}
            onWarehouseLoginSuccess={() => setCurrentPage('warehouse')}
          />
        </div>
      </div>
    );
  }

  if (isStoreAccessBlocked(currentStore)) {
    return (
      <div className="h-full flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StoreAccessBlockedPage />
        </div>
      </div>
    );
  }

  if (currentUser?.role === 'cashier' && currentUser.is_active === 0) {
    return (
      <div className="h-full flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <CashierBlockedPage />
        </div>
      </div>
    );
  }

  const needsPhone = userNeedsPhone(currentUser);

  const leaveWarehouse = () => {
    // Same idea as switching away from a store — sign out and pick store/warehouse again
    switchUser();
  };

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
        return role === 'owner' ? <SubscriptionPage /> : <POSPage />;
      case 'inventory':
        return role === 'owner' ? <InventoryPage /> : <POSPage />;
      case 'warehouse':
        return role === 'owner' ? (
          <WarehousePage onBackToSettings={leaveWarehouse} />
        ) : (
          <POSPage />
        );
      case 'ecommerce':
        return role === 'owner' || (currentUser?.can_manage_ecommerce ?? 0) === 1
          ? <EcommercePage />
          : <POSPage />;
      case 'reports':
        return role === 'owner' ? <ReportsPage /> : <POSPage />;
      case 'expenses':
        return <ExpensesPage />;
      case 'cashbook':
        return canAccessCashbook(currentUser) ? <CashBookPage /> : <POSPage />;
      case 'settings':
        return role === 'owner' ? (
          <SettingsPage onNavigate={setCurrentPage} />
        ) : (
          <POSPage />
        );
      default:
        return <POSPage />;
    }
  };

  return (
    <div
      className="h-full flex flex-col lg:flex-row overflow-hidden bg-[var(--color-surface)] lg:max-w-7xl lg:mx-auto lg:shadow-xl lg:border-x lg:border-emerald-100"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <AppNav currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <PWAInstallBanner />
        <SubscriptionWarningBanner
          onOpenPlan={
            currentUser?.role === 'owner' ? () => setCurrentPage('subscription') : undefined
          }
        />
        <StoreBrandingBar />
        <div className="flex-1 min-h-0 overflow-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          {renderPage()}
        </div>
      </div>
      {needsPhone && <AddPhonePrompt />}
    </div>
  );
}
