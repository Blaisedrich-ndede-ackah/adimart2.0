import { useEffect, useState } from 'react';
import { AlertCircle, Fingerprint, Lock, LogIn, Phone } from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { isAgentBiometricReady, syncAgentPortal, unlockAgentWithBiometric } from '@/lib/agentPortal';

interface AgentLoginPageProps {
  onOpenStore?: () => void;
  onAgentLogin?: () => void;
}

export default function AgentLoginPage({ onOpenStore, onAgentLogin }: AgentLoginPageProps) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);
  const { login, resume, loginError } = useAgentAuthStore();

  useEffect(() => {
    let active = true;
    void syncAgentPortal().then((result) => {
      if (active && !result.success) setSyncNote(result.message);
    });
    void isAgentBiometricReady().then((ready) => {
      if (active) setBiometricReady(ready);
    });
    return () => {
      active = false;
    };
  }, []);

  const isGhanaPhone = isValidGhanaPhone(phone);
  const canSubmit = isGhanaPhone && pin.length === 4 && !busy;

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isGhanaPhone) {
      setError('Enter a valid Ghana phone number (for example 024XXXXXXX).');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be 4 digits.');
      return;
    }
    setBusy(true);
    const ok = await login(phone, pin);
    setBusy(false);
    if (ok) onAgentLogin?.();
    else setError(useAgentAuthStore.getState().loginError || 'Invalid phone or PIN.');
  };

  const handleBiometric = async () => {
    setError('');
    setBusy(true);
    try {
      const agentId = await unlockAgentWithBiometric();
      const ok = await resume(agentId);
      if (ok) onAgentLogin?.();
      else setError(useAgentAuthStore.getState().loginError || 'Biometric unlock failed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Biometric unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  const shownError = error || loginError;

  return (
    <div className="page-shell min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white">
              <LogIn className="w-5 h-5" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Agent Portal</h1>
              <p className="text-sm text-gray-500">Adimat store onboarding</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">
            Sign in with your registered phone and 4-digit PIN
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-6 md:p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400" />
                Phone number
              </label>
              <input
                type="tel"
                inputMode="tel"
                maxLength={13}
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
                placeholder="024XXXXXXX"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                disabled={busy}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                <Lock className="w-4 h-4 text-gray-400" />
                4-digit PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                disabled={busy}
              />
            </div>

            {shownError && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
                <p className="text-sm text-red-700">{shownError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-xl py-3 text-base font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {biometricReady && (
            <button
              type="button"
              onClick={() => void handleBiometric()}
              disabled={busy}
              className="mt-3 w-full rounded-xl border border-emerald-200 py-3 text-sm font-semibold text-emerald-700 flex items-center justify-center gap-2"
            >
              <Fingerprint className="w-4 h-4" />
              Unlock with biometrics
            </button>
          )}

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600 mb-3">
              Agent accounts are created by the platform administrator.
            </p>
            <button
              type="button"
              onClick={() => onOpenStore?.()}
              className="text-sm text-emerald-700 underline"
            >
              I am a store owner — go to POS login
            </button>
          </div>
          {syncNote && <p className="mt-4 text-xs text-amber-700">{syncNote}</p>}
        </div>
      </div>
    </div>
  );
}
