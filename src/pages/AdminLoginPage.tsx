import { useState } from 'react';
import { Shield, ArrowLeft, Loader2 } from 'lucide-react';
import { verifyAdminPin, startAdminSession, getConfiguredAdminPin } from '@/lib/adminAuth';
import { isSupabaseConfigured } from '@/lib/supabase';

interface AdminLoginPageProps {
  onSuccess: () => void;
  onBack: () => void;
}

export default function AdminLoginPage({ onSuccess, onBack }: AdminLoginPageProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pinLength = Math.min(8, Math.max(4, getConfiguredAdminPin().length));

  const submit = async (value: string) => {
    setLoading(true);
    setError('');
    await new Promise((r) => setTimeout(r, 200));

    if (!verifyAdminPin(value)) {
      setError('Invalid administrator PIN');
      setPin('');
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setError('Supabase is required for the admin portal. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }

    startAdminSession();
    setLoading(false);
    onSuccess();
  };

  const onKey = (key: string) => {
    if (loading) return;
    setError('');
    if (key === 'del') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    const next = (pin + key).slice(0, pinLength);
    setPin(next);
    if (next.length === pinLength) {
      void submit(next);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="px-4 pt-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-300 text-sm touch-target"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to store login
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-emerald-400" />
        </div>
        <h1 className="text-white text-2xl font-bold">Administrator</h1>
        <p className="text-slate-400 text-sm text-center mt-2 max-w-xs">
          View all stores, sales, and weekly Paystack remittances.
        </p>

        <div className="mt-8 mb-4 tracking-[0.5em] text-2xl font-mono text-white min-h-[2rem]">
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
          ) : (
            '•'.repeat(pin.length) || <span className="text-slate-600 tracking-normal text-sm">Enter admin PIN</span>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-xs text-center mb-4 max-w-sm">{error}</p>
        )}

        <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go'].map((key) => (
            <button
              key={key}
              disabled={loading}
              onClick={() => {
                if (key === 'go') {
                  if (pin.length >= 4) void submit(pin);
                  return;
                }
                onKey(key);
              }}
              className="h-14 rounded-2xl bg-slate-800 text-white text-xl font-semibold active:bg-slate-700 disabled:opacity-50"
            >
              {key === 'del' ? '⌫' : key === 'go' ? '→' : key}
            </button>
          ))}
        </div>

        <p className="text-slate-500 text-[11px] text-center mt-6 max-w-sm">
          Set <code className="text-slate-400">VITE_ADMIN_PIN</code> in your environment. Stores must sync to Supabase to appear here.
        </p>
      </div>
    </div>
  );
}
