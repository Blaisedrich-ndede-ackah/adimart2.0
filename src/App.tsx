import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { initAutoSync, stopAutoSync } from '@/lib/sync';
import PWAInstallBanner from '@/components/PWAInstallBanner';
import BottomNav from '@/components/BottomNav';
import StoreSetupPage from '@/pages/StoreSetupPage';
import LoginPage from '@/pages/LoginPage';
import POSPage from '@/pages/POSPage';
import InventoryPage from '@/pages/InventoryPage';
import ReportsPage from '@/pages/ReportsPage';
import SettingsPage from '@/pages/SettingsPage';

export default function App() {
  const { isAuthenticated, currentUser, isStoreSetup, isLoading, initialize } = useAuthStore();
  const [currentPage, setCurrentPage] = useState('pos');

  useEffect(() => {
    initialize();
    initAutoSync();
    return () => stopAutoSync();
  }, [initialize]);

  useEffect(() => {
    if (currentUser?.role === 'cashier') {
      setCurrentPage('pos');
    }
  }, [currentUser]);

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
          <StoreSetupPage />
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
          <LoginPage />
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
