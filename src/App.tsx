import { useState, useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { ensureFirstFullPull, initAutoSync, startLiveStockSync, stopAutoSync, triggerPushSync } from '@/lib/sync';
import { detectPrivateIndexedDb } from '@/lib/browserCompat';
import { autoReconnectPeripherals } from '@/lib/bluetoothPeripherals';
import { clearAdminSession, restoreAdminSession } from '@/lib/adminAuth';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { getUnlockedWarehouseLocationId } from '@/lib/warehouseAccess';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import SubscriptionWarningBanner from '@/components/SubscriptionWarningBanner';
import StoreBrandingBar from '@/components/StoreBrandingBar';
import { SyncStatusBanner } from '@/components/ui/SyncStatusBanner';
import { SyncToast } from '@/components/ui/Toast';
import AppNav from '@/components/AppNav';
import AddPhonePrompt from '@/components/AddPhonePrompt';
import SessionTimeoutGuard from '@/components/SessionTimeoutGuard';
import StoreSetupPage from '@/pages/StoreSetupPage';
import LoginPage from '@/pages/LoginPage';
import CashierBlockedPage from '@/pages/CashierBlockedPage';
import StoreAccessBlockedPage from '@/pages/StoreAccessBlockedPage';
import POSPage from '@/pages/POSPage';
import SearchPage from '@/pages/SearchPage';
import InventoryPage from '@/pages/InventoryPage';
import ReportsPage from '@/pages/ReportsPage';
import ExpensesPage from '@/pages/ExpensesPage';
import CashBookPage from '@/pages/CashBookPage';
import SettingsPage from '@/pages/SettingsPage';
import DevicesPage from '@/pages/DevicesPage';
import TransactionsPage from '@/pages/TransactionsPage';
import CustomersPage from '@/pages/CustomersPage';
import ReturnsPage from '@/pages/ReturnsPage';
import SubscriptionPage from '@/pages/SubscriptionPage';
import WarehousePage from '@/pages/WarehousePage';
import EcommercePage from '@/pages/EcommercePage';
import PurchasingPage from '@/pages/PurchasingPage';
import StockApprovalsPage from '@/pages/StockApprovalsPage';
import AdimatAiPage from '@/pages/AdimatAiPage';
import HelpSupportPage from '@/pages/HelpSupportPage';
import OwnerHomePage from '@/pages/OwnerHomePage';
import MultiStorePage from '@/pages/MultiStorePage';
import LearnAdimatPage from '@/pages/LearnAdimatPage';
import CampaignsPage from '@/pages/CampaignsPage';
import PublicShopPage from '@/pages/PublicShopPage';
import TermsPage from '@/pages/TermsPage';
import NotFoundPage from '@/pages/NotFoundPage';
import AdminLoginPage from '@/pages/AdminLoginPage';
import AdminDashboardPage from '@/pages/AdminDashboardPage';
import AgentLoginPage from '@/pages/AgentLoginPage';
import AgentShell from '@/components/AgentShell';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import { isStoreAccessBlocked } from '@/lib/subscription';
import { checkAndSendSubscriptionExpirySms } from '@/lib/subscriptionReminders';
import { checkAndSendDebtReminders } from '@/lib/debtReminders';
import { canAccessCashbook } from '@/lib/staffAccess';
import { createAutomaticStoreBackup, recordBackupIssue } from '@/lib/storeBackup';
import { createDueRecurringExpenses } from '@/lib/dexie';
import { useAccessibilityStore } from '@/lib/accessibility';

type AppMode = 'store' | 'admin-login' | 'admin' | 'agent-login' | 'agent';

function readPublicShopSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const match = hash.match(/^\/?shop\/([^/?#]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]).trim().toLowerCase();
  const recovery = new URLSearchParams(window.location.search).get('shop_recovery');
  return recovery ? decodeURIComponent(recovery).trim().toLowerCase() : null;
}

function readAgentHash(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash.replace(/^#/, '').replace(/^\//, '').replace(/\/$/, '');
  return hash.toLowerCase() === 'agent';
}

function readPublicUtilityRoute(): 'terms' | '404' | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '').replace(/^\//, '').replace(/\/$/, '');
  if (!hash) return null;
  if (hash.toLowerCase() === 'terms') return 'terms';
  if (hash.toLowerCase() === 'agent') return null;
  if (/^shop\//i.test(hash)) return null;
  return '404';
}

function openAgentHash(): void {
  if (readAgentHash()) return;
  window.location.hash = '#/agent';
}

function clearAgentHash(): void {
  if (!readAgentHash()) return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', next);
}

function userNeedsPhone(user: { phone?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return !isValidGhanaPhone(user.phone || '');
}

export default function App() {
  const { isAuthenticated, currentUser, currentStore, isStoreSetup, isLoading, initialize, switchUser } =
    useAuthStore();
  const initializeAgent = useAgentAuthStore((state) => state.initialize);
  const leftHanded = useAccessibilityStore((state) => state.leftHanded);
  const [currentPage, setCurrentPage] = useState('home');
  const [quickAction, setQuickAction] = useState<'add-product' | 'add-expense' | null>(null);
  const [appMode, setAppMode] = useState<AppMode>(() => (readAgentHash() ? 'agent-login' : 'store'));
  const [adminSessionResolved, setAdminSessionResolved] = useState(false);
  const [publicShopSlug, setPublicShopSlug] = useState<string | null>(() => readPublicShopSlug());
  const [publicUtilityRoute, setPublicUtilityRoute] = useState<'terms' | '404' | null>(() => readPublicUtilityRoute());
  const [privateStorage, setPrivateStorage] = useState(false);

  useEffect(() => {
    let active = true;
    void restoreAdminSession()
      .then((isActive) => {
        if (active && isActive && !readAgentHash()) setAppMode('admin');
      })
      .catch((error) => {
        console.error('Could not restore administrator session', error);
      })
      .finally(() => {
        if (active) setAdminSessionResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setPublicShopSlug(readPublicShopSlug());
    const onUtilityHashChange = () => setPublicUtilityRoute(readPublicUtilityRoute());
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('hashchange', onUtilityHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('hashchange', onUtilityHashChange);
    };
  }, []);

  useEffect(() => {
    initialize();
    void initializeAgent();
    initAutoSync();
    void detectPrivateIndexedDb().then(setPrivateStorage);
    void autoReconnectPeripherals();
    return () => stopAutoSync();
  }, [initialize, initializeAgent]);

  useEffect(() => {
    const onAgentHash = () => {
      if (!readAgentHash()) return;
      setPublicUtilityRoute(null);
      setAppMode((mode) => (mode === 'agent' ? mode : 'agent-login'));
    };
    window.addEventListener('hashchange', onAgentHash);
    return () => window.removeEventListener('hashchange', onAgentHash);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    void ensureFirstFullPull(currentStore.id);
    return startLiveStockSync(currentStore.id);
  }, [isAuthenticated, currentStore?.id]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    const runRecurringExpenses = () => {
      void createDueRecurringExpenses()
        .then((created) => {
          if (created > 0) void triggerPushSync('recurring-expenses');
        })
        .catch((error: unknown) => {
          console.error('[Expenses] Could not create scheduled recurring expenses:', error);
        });
    };
    runRecurringExpenses();
    const interval = window.setInterval(runRecurringExpenses, 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') runRecurringExpenses();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, currentStore?.id]);

  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    setCurrentPage(currentUser.role === 'owner' ? 'home' : 'pos');
  }, [isAuthenticated, currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    const runBackup = () => {
      void createAutomaticStoreBackup(currentStore.id)
        .then(() => recordBackupIssue(''))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[Backup] Automatic store snapshot failed:', error);
          recordBackupIssue(message);
        });
    };
    runBackup();
    const interval = window.setInterval(runBackup, 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') runBackup();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, currentStore?.id]);

  useEffect(() => {
    // Cashiers cannot stay on owner-only pages after switch/login
    if (currentUser?.role !== 'cashier') return;
    const ownerOnly = ['home', 'inventory', 'purchasing', 'reports', 'settings', 'warehouse', 'subscription', 'customers', 'returns', 'multistore', 'adimat-ai'];
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

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    // Only the owner's device runs the automatic chase. A cashier device must
    // never send owner-configured reminders.
    if (currentUser?.role !== 'owner') return;
    // Chase overdue customer credit on its own schedule. The per-customer
    // interval stored on the store keeps this from over-texting anyone.
    void checkAndSendDebtReminders();
    const timer = window.setInterval(() => void checkAndSendDebtReminders(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, currentStore?.id, currentUser?.role]);

  if (publicShopSlug) {
    return <PublicShopPage slug={publicShopSlug} />;
  }

  if (publicUtilityRoute === 'terms') return <TermsPage />;
  if (publicUtilityRoute === '404') return <NotFoundPage />;

  if (!adminSessionResolved) {
    return (
      <div className="h-full bg-primary flex items-center justify-center">
        <p className="text-white font-medium tracking-wide">Checking administrator session…</p>
      </div>
    );
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
          void clearAdminSession().catch((error) => {
            console.error('Administrator sign-out failed', error);
          });
          setAppMode('store');
        }}
      />
    );
  }

  if (appMode === 'agent-login') {
    return (
      <div className="h-full flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AgentLoginPage
            onOpenStore={() => {
              clearAgentHash();
              setAppMode('store');
            }}
            onAgentLogin={() => setAppMode('agent')}
          />
        </div>
      </div>
    );
  }

  if (appMode === 'agent') {
    return (
      <div className="h-full flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-hidden">
          <AgentShell
            onLogout={() => {
              clearAgentHash();
              setAppMode('agent-login');
            }}
          />
        </div>
      </div>
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
          <StoreSetupPage
            onOpenAdmin={() => setAppMode('admin-login')}
            onOpenAgent={() => {
              openAgentHash();
              setAppMode('agent-login');
            }}
          />
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
            onOpenAgent={() => {
              openAgentHash();
              setAppMode('agent-login');
            }}
            onWarehouseLoginSuccess={() => setCurrentPage('warehouse')}
          />
        </div>
      </div>
    );
  }

  const authenticatedChrome = (page: ReactNode) => (
    <>
      <SessionTimeoutGuard />
      {page}
    </>
  );

  if (isStoreAccessBlocked(currentStore)) {
    return authenticatedChrome(
      <div className="h-full flex flex-col">
        <PWAInstallBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StoreAccessBlockedPage />
        </div>
      </div>
    );
  }

  if (currentUser?.role === 'cashier' && currentUser.is_active === 0) {
    return authenticatedChrome(
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
      case 'home':
        return role === 'owner' ? <OwnerHomePage onNavigate={(page, quickAdd) => {
          setQuickAction(quickAdd && page === 'inventory' ? 'add-product' : quickAdd && page === 'expenses' ? 'add-expense' : null);
          setCurrentPage(page);
        }} /> : <POSPage />;
      case 'pos':
        return <POSPage onNavigate={setCurrentPage} />;
      case 'search':
        return <SearchPage onNavigate={setCurrentPage} />;
      case 'transactions':
        return <TransactionsPage />;
      case 'customers':
        return role === 'owner' ? <CustomersPage onNavigate={setCurrentPage} /> : <POSPage />;
      case 'multistore':
        return role === 'owner' ? <MultiStorePage onNavigate={setCurrentPage} /> : <POSPage />;
      case 'returns':
        return role === 'owner' ? <ReturnsPage /> : <POSPage />;
      case 'devices':
        return <DevicesPage />;
      case 'learn':
        return currentUser ? <LearnAdimatPage onNavigate={setCurrentPage} /> : <POSPage />;
      case 'campaigns':
        return currentUser ? <CampaignsPage /> : <POSPage />;
      case 'subscription':
        return role === 'owner' ? <SubscriptionPage /> : <POSPage />;
      case 'inventory':
        return role === 'owner' ? <InventoryPage openAddOnLoad={quickAction === 'add-product'} onQuickActionHandled={() => setQuickAction(null)} /> : <POSPage />;
      case 'purchasing':
        return role === 'owner' ? <PurchasingPage /> : <POSPage />;
      case 'stock-approvals':
        return <StockApprovalsPage />;
      case 'adimat-ai':
        return role === 'owner' ? <AdimatAiPage onNavigate={setCurrentPage} /> : <POSPage />;
      case 'support':
        return <HelpSupportPage />;
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
        return <ExpensesPage openAddOnLoad={quickAction === 'add-expense'} onQuickActionHandled={() => setQuickAction(null)} />;
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

  return authenticatedChrome(
    <div
      className="ios-canvas h-full w-full min-w-0 flex flex-col lg:flex-row overflow-hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <AppNav currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden ${leftHanded ? 'lg:order-1' : ''}`}>
        <PWAInstallBanner />
        {privateStorage && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            This browser is blocking saved data (private mode). Sales and tickets stay only until you close the tab. Open Adimat in a normal window to keep them.
          </div>
        )}
        <SyncStatusBanner />
        <SyncToast />
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
