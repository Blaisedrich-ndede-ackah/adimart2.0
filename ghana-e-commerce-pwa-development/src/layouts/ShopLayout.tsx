import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import ChatBot from '@/components/ChatBot';
import { useAdimartStore } from '@/lib/AdimartProvider';

export default function ShopLayout() {
  const { store, loading, error } = useAdimartStore();

  useEffect(() => {
    if (!store?.name) return;
    document.title = `${store.name} — Shop`;
  }, [store?.name]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-orange-50 text-orange-600">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-orange-50 to-white px-6">
        <div className="max-w-lg rounded-3xl border border-orange-100 bg-white p-8 text-center shadow-xl shadow-orange-100">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-500">BONDZTECH</p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">This shop is not connected yet</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-16 md:pb-0">
      <Navbar />
      <main>
        <Outlet />
      </main>
      <ChatBot />
    </div>
  );
}
