import { lazy, Suspense, useState, useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { initAutoSync, startLiveStockSync, stopAutoSync, triggerPushSync } from '@/lib/sync';
import { sendDeviceHeartbeat } from '@/lib/devicePresence';
import { autoReconnectPeripherals } from '@/lib/bluetoothPeripherals';
import { clearAdminSession, restoreAdminSession } from '@/lib/adminAuth';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { getUnlockedWarehouseLocationId } from '@/lib/warehouseAccess';
import SubscriptionWarningBanner from '@/components/SubscriptionWarningBanner';
import StoreBrandingBar from '@/components/StoreBrandingBar';
import { SyncStatusBanner } from '@/components/ui/SyncStatusBanner';
import { SyncToast } from '@/components/ui/Toast';
import AppNav from '@/components/AppNav';
import AddPhonePrompt from '@/components/AddPhonePrompt';
import SessionTimeoutGuard from '@/components/SessionTimeoutGuard';
const StoreSetupPage = lazy(() => import('@/pages/StoreSetupPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const CashierBlockedPage = lazy(() => import('@/pages/CashierBlockedPage'));
const StoreAccessBlockedPage = lazy(() => import('@/pages/StoreAccessBlockedPage'));
const POSPage = lazy(() => import('@/pages/POSPage'));
const CustomerDisplayPage = lazy(() => import('@/pages/CustomerDisplayPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const InventoryPage = lazy(() => import('@/pages/InventoryPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const ExpensesPage = lazy(() => import('@/pages/ExpensesPage'));
const CashBookPage = lazy(() => import('@/pages/CashBookPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const DevicesPage = lazy(() => import('@/pages/DevicesPage'));
const TransactionsPage = lazy(() => import('@/pages/TransactionsPage'));
const CustomersPage = lazy(() => import('@/pages/CustomersPage'));
const ReturnsPage = lazy(() => import('@/pages/ReturnsPage'));
const SubscriptionPage = lazy(() => import('@/pages/SubscriptionPage'));
const WarehousePage = lazy(() => import('@/pages/WarehousePage'));
const EcommercePage = lazy(() => import('@/pages/EcommercePage'));
const PurchasingPage = lazy(() => import('@/pages/PurchasingPage'));
const StockApprovalsPage = lazy(() => import('@/pages/StockApprovalsPage'));
const AdimatAiPage = lazy(() => import('@/pages/AdimatAiPage'));
const OwnerHomePage = lazy(() => import('@/pages/OwnerHomePage'));
const MultiStorePage = lazy(() => import('@/pages/MultiStorePage'));
const LearnAdimatPage = lazy(() => import('@/pages/LearnAdimatPage'));
const CampaignsPage = lazy(() => import('@/pages/CampaignsPage'));
const StoreDealsPage = lazy(() => import('@/pages/StoreDealsPage'));
const PublicShopPage = lazy(() => import('@/pages/PublicShopPage'));
const PriceScanPage = lazy(() => import('@/pages/PriceScanPage'));
const VerifyPickupPage = lazy(() => import('@/pages/VerifyPickupPage'));
const WriteOffPage = lazy(() => import('@/pages/WriteOffPage'));
const BundlesPage = lazy(() => import('@/pages/BundlesPage'));
const GiftCardsRentalsPage = lazy(() => import('@/pages/GiftCardsRentalsPage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const ReceiptPage = lazy(() => import('@/pages/ReceiptPage'));
const TermsPage = lazy(() => import('@/pages/TermsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const AdminLoginPage = lazy(() => import('@/pages/AdminLoginPage'));
const AdminDashboardPage = lazy(() => import('@/pages/AdminDashboardPage'));
const AgentLoginPage = lazy(() => import('@/pages/AgentLoginPage'));
const AgentShell = lazy(() => import('@/components/AgentShell'));
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import { isStoreAccessBlocked } from '@/lib/subscription';
import { checkAndSendSubscriptionExpirySms } from '@/lib/subscriptionReminders';
import { checkAndSendDebtReminders } from '@/lib/debtReminders';
import { flushSmsOutbox, sendClosingSummary } from '@/lib/smsOutbox';
import { canAccessCashbook, canRecordCustomerPayments } from '@/lib/staffAccess';
import { createAutomaticStoreBackup, recordBackupIssue } from '@/lib/storeBackup';
import { createDueRecurringExpenses } from '@/lib/dexie';
import { flushPriceChanges } from '@/lib/priceChangeQueue';
import { useAccessibilityStore } from '@/lib/accessibility';
import { useT } from '@/lib/i18n';
import { syncWriteOffs } from '@/lib/writeOff';
import { syncBundles } from '@/lib/bundle';
import { syncReceipts } from '@/lib/receiptWallet';

type AppMode = 'store' | 'admin-login' | 'admin' | 'agent-login' | 'agent';

function readPublicShopSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const pathMatch = window.location.pathname.match(/^\/shop\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim().toLowerCase();
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

function isCustomerDisplayRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash.replace(/^#/, '').replace(/\/$/, '').toLowerCase();
  const path = window.location.pathname.replace(/\/$/, '').toLowerCase();
  return hash === '/pos/customer-display' || path === '/pos/customer-display';
}

function readPriceScanSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const match = hash.match(/^\/?price-scan\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]).trim().toLowerCase() : null;
}

function readVerifyPickupRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase() === 'verify-pickup';
}

function readReceiptToken(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.hash.replace(/^#/, '').match(/^\/?receipt\/([^/?#]+)/i);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function readStaffFeatureRoute(): 'write-offs' | 'bundles' | null {
  if (typeof window === 'undefined') return null;
  const route = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase();
  return route === 'write-offs' || route === 'bundles' ? route : null;
}

function readPublicUtilityRoute(): 'terms' | '404' | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '').replace(/^\//, '').replace(/\/$/, '');
  if (!hash) return null;
  if (hash.toLowerCase() === 'terms') return 'terms';
  if (hash.toLowerCase() === 'agent') return null;
  if (hash.toLowerCase() === 'verify-pickup') return null;
  if (hash.toLowerCase() === 'write-offs' || hash.toLowerCase() === 'bundles') return null;
  if (/^receipt\//i.test(hash)) return null;
  if (/^shop\//i.test(hash)) return null;
  if (/^price-scan\//i.test(hash)) return null;
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
  if (isCustomerDisplayRoute()) return <CustomerDisplayRoute />;
  const receiptToken = readReceiptToken();
  if (receiptToken) return <Suspense fallback={<div className="min-h-screen bg-gray-50" />}><ReceiptPage token={receiptToken} /></Suspense>;
  return <AuthenticatedApp />;
}

function CustomerDisplayRoute() {
  const initialize = useAuthStore((state) => state.initialize);
  useEffect(() => {
    void initialize(true);
  }, [initialize]);
  return <Suspense fallback={<div className="min-h-screen bg-slate-950" />}><CustomerDisplayPage /></Suspense>;
}

function AuthenticatedApp() {
  const { isAuthenticated, currentUser, currentStore, isStoreSetup, isLoading, startupError, initialize, switchUser } =
    useAuthStore();
  const t = useT();
  const initializeAgent = useAgentAuthStore((state) => state.initialize);
  const leftHanded = useAccessibilityStore((state) => state.leftHanded);
  const [currentPage, setCurrentPage] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const pushPage = params.get('open-page');
    const allowedPushPages = ['inventory', 'ecommerce', 'devices', 'customers', 'notifications'];
    if (params.has('open-notifications')) return pushPage && allowedPushPages.includes(pushPage) ? pushPage : 'notifications';
    return readVerifyPickupRoute() ? 'verify-pickup' : readStaffFeatureRoute() || 'home';
  });
  const [quickAction, setQuickAction] = useState<'add-product' | 'add-expense' | null>(null);
  const [appMode, setAppMode] = useState<AppMode>(() => (readAgentHash() ? 'agent-login' : 'store'));
  const [adminSessionResolved, setAdminSessionResolved] = useState(false);
  const [publicShopSlug, setPublicShopSlug] = useState<string | null>(() => readPublicShopSlug());
  const [priceScanSlug, setPriceScanSlug] = useState<string | null>(() => readPriceScanSlug());
  const [publicUtilityRoute, setPublicUtilityRoute] = useState<'terms' | '404' | null>(() => readPublicUtilityRoute());

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
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_NOTIFICATIONS') {
        const allowed = ['inventory', 'ecommerce', 'devices', 'customers', 'notifications'];
        setCurrentPage(allowed.includes(event.data.page) ? event.data.page : 'notifications');
      }
    };
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
  }, []);

  useEffect(() => {
    if (!currentStore?.id || !currentUser?.id) return;
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      if (detail.success !== false || (detail.phase !== 'error' && detail.phase !== 'complete')) return;
      const hour = new Date().toISOString().slice(0, 13);
      void fetch('/api/integrations?action=sync_failed', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store_id: currentStore.id, user_id: currentUser.id, event_key: `${currentUser.id}:${hour}`, body: String(detail.message || 'Cloud sync could not complete.').slice(0, 300) }),
      }).catch(() => undefined);
    };
    window.addEventListener('adimat-sync', onSync);
    return () => window.removeEventListener('adimat-sync', onSync);
  }, [currentStore?.id, currentUser?.id]);

  useEffect(() => {
    const onHashChange = () => setPublicShopSlug(readPublicShopSlug());
    const onPriceScanHashChange = () => setPriceScanSlug(readPriceScanSlug());
    const onUtilityHashChange = () => setPublicUtilityRoute(readPublicUtilityRoute());
    const onVerifyPickupHashChange = () => {
      if (readVerifyPickupRoute()) setCurrentPage('verify-pickup');
    };
    const onStaffFeatureHashChange = () => {
      const route = readStaffFeatureRoute();
      if (route) setCurrentPage(route);
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('hashchange', onPriceScanHashChange);
    window.addEventListener('hashchange', onUtilityHashChange);
    window.addEventListener('hashchange', onVerifyPickupHashChange);
    window.addEventListener('hashchange', onStaffFeatureHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('hashchange', onPriceScanHashChange);
      window.removeEventListener('hashchange', onUtilityHashChange);
      window.removeEventListener('hashchange', onVerifyPickupHashChange);
      window.removeEventListener('hashchange', onStaffFeatureHashChange);
    };
  }, []);

  useEffect(() => {
    initialize();
    void initializeAgent();
    initAutoSync();
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
    let active = true;
    let timer = 0;
    let running = false;
    const runHousekeeping = async () => {
      if (!active || running || document.visibilityState !== 'visible' || navigator.onLine === false) return;
      running = true;
      try {
        await flushPriceChanges(currentStore.id).catch(() => undefined);
        await syncWriteOffs(currentStore.id).catch(() => undefined);
        await syncBundles(currentStore.id).catch(() => undefined);
        await syncReceipts(currentStore.id).catch(() => undefined);
        if (currentUser?.id) await sendDeviceHeartbeat(currentStore.id, currentUser.id).catch(() => undefined);
        await flushSmsOutbox(currentStore.id).catch(() => undefined);
        if (currentUser?.role === 'owner') await sendClosingSummary(currentStore).catch(() => undefined);
      } catch (error) {
        console.warn('[Housekeeping] A background task did not complete:', error);
      } finally {
        running = false;
      }
    };
    const schedule = () => {
      if (!active || document.visibilityState !== 'visible' || navigator.onLine === false) return;
      timer = window.setTimeout(async () => {
        await runHousekeeping();
        schedule();
      }, 60_000);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void runHousekeeping().finally(schedule);
      } else {
        window.clearTimeout(timer);
      }
    };
    const onOnline = () => { window.clearTimeout(timer); void runHousekeeping().finally(schedule); };
    void runHousekeeping().finally(schedule);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [isAuthenticated, currentStore, currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    return startLiveStockSync(currentStore.id);
  }, [isAuthenticated, currentStore?.id]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    let running = false;
    const runRecurringExpenses = async () => {
      if (document.visibilityState !== 'visible' || running) return;
      running = true;
      try {
        await createDueRecurringExpenses()
        .then((created) => {
          if (created > 0) void triggerPushSync('recurring-expenses');
        })
        .catch((error: unknown) => {
          console.error('[Expenses] Could not create scheduled recurring expenses:', error);
        });
      } finally {
        running = false;
      }
    };
    let timer = 0;
    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(async () => { await runRecurringExpenses(); schedule(); }, 60 * 60 * 1000);
    };
    void runRecurringExpenses().finally(schedule);
    const onVisible = () => {
      if (document.visibilityState === 'visible') { window.clearTimeout(timer); void runRecurringExpenses().finally(schedule); }
      else window.clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, currentStore?.id]);

  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    setCurrentPage(readVerifyPickupRoute() ? 'verify-pickup' : currentUser.role === 'owner' ? 'home' : 'pos');
  }, [isAuthenticated, currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    let running = false;
    const runBackup = async () => {
      if (document.visibilityState !== 'visible' || running) return;
      running = true;
      try {
        await createAutomaticStoreBackup(currentStore.id)
        .then(() => recordBackupIssue(''))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[Backup] Automatic store snapshot failed:', error);
          recordBackupIssue(message);
        });
      } finally {
        running = false;
      }
    };
    let timer = 0;
    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      timer = window.setTimeout(async () => { await runBackup(); schedule(); }, 60 * 60 * 1000);
    };
    void runBackup().finally(schedule);
    const onVisible = () => {
      if (document.visibilityState === 'visible') { window.clearTimeout(timer); void runBackup().finally(schedule); }
      else window.clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, currentStore?.id]);

  useEffect(() => {
    // Cashiers cannot stay on owner-only pages after switch/login
    if (currentUser?.role !== 'cashier') return;
    const ownerOnly = ['home', 'inventory', 'purchasing', 'reports', 'settings', 'warehouse', 'subscription', 'returns', 'multistore', 'adimat-ai', 'store-deals', 'bundles'];
    const ecommerceOk = (currentUser.can_manage_ecommerce ?? 0) === 1;
    const cashbookOk = canAccessCashbook(currentUser);
    const customerPaymentsOk = canRecordCustomerPayments(currentUser);
    if (
      ownerOnly.includes(currentPage) ||
      (currentPage === 'customers' && !customerPaymentsOk) ||
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
    let timer = 0;
    let running = false;
    const run = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || running) return;
      running = true;
      try { await checkAndSendSubscriptionExpirySms(); }
      catch (error) { console.warn('[Subscription reminders] Could not complete:', error); }
      finally { running = false; }
    };
    const schedule = () => { if (document.visibilityState === 'visible' && navigator.onLine) timer = window.setTimeout(async () => { await run(); schedule(); }, 6 * 60 * 60 * 1000); };
    void run().finally(schedule);
    const onVisibility = () => { if (document.visibilityState === 'visible') { window.clearTimeout(timer); void run().finally(schedule); } else window.clearTimeout(timer); };
    const onOnline = () => { void run().finally(() => { window.clearTimeout(timer); schedule(); }); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('online', onOnline); };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !currentStore?.id) return;
    // Only the owner's device runs the automatic chase. A cashier device must
    // never send owner-configured reminders.
    if (currentUser?.role !== 'owner') return;
    // Chase overdue customer credit on its own schedule. The per-customer
    // interval stored on the store keeps this from over-texting anyone.
    let timer = 0;
    let running = false;
    const run = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || running) return;
      running = true;
      try { await checkAndSendDebtReminders(); }
      catch (error) { console.warn('[Debt reminders] Could not complete:', error); }
      finally { running = false; }
    };
    const schedule = () => { if (document.visibilityState === 'visible' && navigator.onLine) timer = window.setTimeout(async () => { await run(); schedule(); }, 6 * 60 * 60 * 1000); };
    void run().finally(schedule);
    const onVisibility = () => { if (document.visibilityState === 'visible') { window.clearTimeout(timer); void run().finally(schedule); } else window.clearTimeout(timer); };
    const onOnline = () => { void run().finally(() => { window.clearTimeout(timer); schedule(); }); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('online', onOnline); };
  }, [isAuthenticated, currentStore?.id, currentUser?.role]);

  if (publicShopSlug) {
    return <PublicShopPage slug={publicShopSlug} />;
  }

  if (priceScanSlug) {
    return <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loadingâ€¦</div>}><PriceScanPage slug={priceScanSlug} /></Suspense>;
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

  if (startupError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-primary px-5 py-10 text-white">
        <section className="w-full max-w-md rounded-2xl bg-white p-6 text-center text-gray-900 shadow-xl">
          <h1 className="text-xl font-bold">{t('app.startupErrorTitle')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('app.startupErrorBody')}</p>
          <button
            type="button"
            onClick={() => void initialize()}
            className="mt-5 rounded-xl bg-primary px-5 py-3 font-semibold text-white touch-target"
          >
            {t('common.retry')}
          </button>
        </section>
      </main>
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
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StoreAccessBlockedPage />
        </div>
      </div>
    );
  }

  if (currentUser?.role === 'cashier' && currentUser.is_active === 0) {
    return authenticatedChrome(
      <div className="h-full flex flex-col">
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
        return canRecordCustomerPayments(currentUser) ? <CustomersPage onNavigate={setCurrentPage} /> : <POSPage />;
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
      case 'store-deals':
        return role === 'owner' ? <StoreDealsPage /> : <POSPage />;
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
      case 'verify-pickup':
        return role === 'owner' || role === 'cashier' ? <VerifyPickupPage /> : <POSPage />;
      case 'write-offs':
        return role === 'owner' || (role === 'cashier' && currentStore?.cashiers_can_record_expenses === 1) ? <WriteOffPage /> : <POSPage />;
      case 'bundles':
        return role === 'owner' ? <BundlesPage /> : <POSPage />;
      case 'gift-cards-rentals':
        return role === 'owner' ? <GiftCardsRentalsPage /> : <POSPage />;
      case 'notifications':
        return <NotificationsPage />;
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
        <SyncStatusBanner />
        <SyncToast />
        <SubscriptionWarningBanner
          onOpenPlan={
            currentUser?.role === 'owner' ? () => setCurrentPage('subscription') : undefined
          }
        />
        {currentPage !== 'pos' && <StoreBrandingBar />}
        <div className="flex-1 min-h-0 overflow-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center" role="status">
                <p className="text-sm font-medium text-muted">Loading…</p>
              </div>
            }
          >
            {renderPage()}
          </Suspense>
        </div>
      </div>
      {needsPhone && <AddPhonePrompt />}
    </div>
  );
}
