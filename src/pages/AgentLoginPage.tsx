import { useState, useEffect } from 'react';
import { LogIn, Phone, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { generateId } from '@/lib/dexie';

export default function AgentLoginPage() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, isLoading } = useAgentAuthStore();

  const isGhanaPhone = isValidGhanaPhone(phone);
  const canSubmit = isGhanaPhone && pin.length === 4 && !busy && !isLoading;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isGhanaPhone) {
      setError('Enter a valid Ghana phone number (e.g. 024XXXXXXX).');
      return;
    }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError('PIN must be 4 digits.');
      return;
    }
    setBusy(true);
    try {
      const ok = await login(phone, pin);
      if (!ok) setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="page-shell min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-[400px]">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <LogIn className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Agent Portal</h1>
              <p className="text-sm text-gray-500">Adimat Store Onboarding</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">
            Sign in with your registered phone and 4-digit PIN
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-6 md:p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400" />
                Phone Number
              </label>
              <input
                type="tel"
                inputMode="tel"
                maxLength="13"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="024XXXXXXX"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all disabled:opacity-50"
                disabled={busy || isLoading}
              />
              {!isGhanaPhone && phone.length > 0 && (
                <p className="text-xs text-red-500">Invalid Ghana phone number</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                <Lock className="w-4 h-4 text-gray-400" />
                4-Digit PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 text-center letter-spacing-widest focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all disabled:opacity-50"
                disabled={busy || isLoading}
              />
              {pin.length > 0 && pin.length !== 4 && (
                <p className="text-xs text-red-500">PIN must be 4 digits</p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className={`w-full rounded-xl py-3 text-base font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                canSubmit ? 'bg-emerald-600 hover:bg-emerald-700 shadow-sm shadow-emerald-100' : 'bg-gray-200 text-gray-400'
              }`}
            >
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600 mb-3">
              Don't have an agent account? Contact the platform administrator to be registered.
            </p>
            <button
              onClick={() => {}}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
              disabled
            >
              I am a store owner — go to POS login
            </button>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400">
            <span className="w-px h-4 bg-gray-300" />
            <span>Built with ❤️ for Ghana agents</span>
            <span className="w-px h-4 bg-gray-300" />
          </div>
        </div>
      </div>
    </div>
  );
}
