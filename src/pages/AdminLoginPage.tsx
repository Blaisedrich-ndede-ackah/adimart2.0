import { useState } from 'react';
import { Shield, ArrowLeft, Loader2 } from 'lucide-react';
import {
  adminFunctionErrorMessage,
  verifyAdminPin,
  startAdminSession,
} from '@/lib/adminAuth';
import AuthShowcase from '@/components/AuthShowcase';

interface AdminLoginPageProps {
  onSuccess: () => void;
  onBack: () => void;
}

export default function AdminLoginPage({ onSuccess, onBack }: AdminLoginPageProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pinLength = 8;

  const finishLogin = () => {
    setLoading(false);
    onSuccess();
  };

  const submitPin = async (value: string) => {
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const session = await verifyAdminPin(value);
      startAdminSession(session);
      finishLogin();
    } catch (loginError) {
      const message = adminFunctionErrorMessage(loginError);
      setError(/invalid.*pin|unauthorized/i.test(message) ? 'Invalid administrator PIN.' : message);
      setPin('');
      setLoading(false);
    }
  };

  const onKey = (key: string) => {
    if (loading) return;
    setError('');
    if (key === 'del') {
      setPin((value) => value.slice(0, -1));
      return;
    }
    const next = (pin + key).slice(0, pinLength);
    setPin(next);
    if (next.length === pinLength) void submitPin(next);
  };

  return (
    <div className="auth-shell wide-auth-shell">
      <AuthShowcase
        variant="admin"
        eyebrow="Platform administration"
        title="Keep every store in sync."
        description="Manage store access, subscriptions, and payouts from one clear workspace."
      />
      <div className="w-full max-w-md px-1 wide-auth-card">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-emerald-100 text-sm touch-target mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to store login
        </button>

        <div className="flex flex-col items-center">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-white/15 flex items-center justify-center mb-4 border border-white/20">
            <Shield className="w-8 h-8 text-emerald-100" />
          </div>
          <h1 className="text-white text-2xl md:text-3xl font-bold tracking-tight text-center">
            Administrator
          </h1>
          <p className="text-emerald-100/80 text-sm text-center mt-2 max-w-xs">
            Enter your admin PIN, then tap the arrow if your PIN has fewer than eight digits.
          </p>

          <div className="relative mt-4 mb-4 tracking-[0.5em] text-2xl font-mono text-white min-h-[2rem]">
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
            ) : (
              '•'.repeat(pin.length) || (
                <span className="text-emerald-200/60 tracking-normal text-sm">
                  Enter admin PIN
                </span>
              )
            )}
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={pinLength}
              autoComplete="off"
              autoFocus
              aria-label="Administrator PIN"
              value={pin}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, '').slice(0, pinLength);
                setPin(value);
                if (value.length === pinLength) void submitPin(value);
              }}
              className="absolute inset-0 h-full w-full cursor-text opacity-0"
            />
          </div>

          {error && (
            <p role="alert" className="text-red-300 text-xs text-center mb-4 max-w-sm px-2">{error}</p>
          )}

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 w-full max-w-xs">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'go'].map((key) => (
              <button
                key={key}
                type="button"
                disabled={loading}
                onClick={() => {
                  if (key === 'go') {
                    if (pin.length >= 4) void submitPin(pin);
                    return;
                  }
                  onKey(key);
                }}
                className="h-14 sm:h-16 rounded-2xl bg-white/15 text-white text-xl font-semibold active:bg-white/25 disabled:opacity-50 touch-target"
              >
                {key === 'del' ? '⌫' : key === 'go' ? '→' : key}
              </button>
            ))}
          </div>

          <p className="text-emerald-200/70 text-[11px] text-center mt-6 max-w-sm px-2">
            Enter the administrator PIN to sign in.
          </p>
        </div>
      </div>
    </div>
  );
}
