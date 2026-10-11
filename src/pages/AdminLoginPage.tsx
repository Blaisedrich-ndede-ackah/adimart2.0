import { useState } from 'react';
import { Shield, ArrowLeft, Loader2 } from 'lucide-react';
import {
  verifyAdminPin,
  getConfiguredAdminPin,
  beginAdminSmsChallenge,
  verifyAdminSmsOtp,
  clearAdminSmsChallenge,
} from '@/lib/adminAuth';
import { isSupabaseConfigured } from '@/lib/supabase';
import AuthShowcase from '@/components/AuthShowcase';

interface AdminLoginPageProps {
  onSuccess: () => void;
  onBack: () => void;
}

type Step = 'pin' | 'otp';

export default function AdminLoginPage({ onSuccess, onBack }: AdminLoginPageProps) {
  const [step, setStep] = useState<Step>('pin');
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pinLength = Math.min(8, Math.max(4, getConfiguredAdminPin().length));
  const activeValue = step === 'pin' ? pin : otp;
  const activeLen = step === 'pin' ? pinLength : 6;

  const finishLogin = () => {
    setLoading(false);
    onSuccess();
  };

  const submitPin = async (value: string) => {
    if (loading) return;
    setLoading(true);
    setError('');
    await new Promise((resolve) => setTimeout(resolve, 150));

    if (!verifyAdminPin(value)) {
      setError('Invalid administrator PIN.');
      setPin('');
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured()) {
      setError('Supabase is required for the admin portal. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }

    const challenge = await beginAdminSmsChallenge(value);
    if (!challenge.success) {
      setError(challenge.error || 'Could not send SMS code.');
      setLoading(false);
      return;
    }

    setMaskedPhone(challenge.maskedPhone || '');
    setStep('otp');
    setOtp('');
    setLoading(false);
  };

  const submitOtp = async (value: string) => {
    if (loading) return;
    setLoading(true);
    setError('');
    const result = await verifyAdminSmsOtp(value);
    if (!result.success) {
      setError(result.error || 'Could not verify the SMS code.');
      setOtp('');
      setLoading(false);
      if (result.error?.includes('expired')) {
        setStep('pin');
        setPin('');
      }
      return;
    }
    finishLogin();
  };

  const onKey = (key: string) => {
    if (loading) return;
    setError('');
    if (key === 'del') {
      if (step === 'pin') setPin((value) => value.slice(0, -1));
      else setOtp((value) => value.slice(0, -1));
      return;
    }
    if (step === 'pin') {
      const next = (pin + key).slice(0, pinLength);
      setPin(next);
      if (next.length === pinLength) void submitPin(next);
    } else {
      const next = (otp + key).slice(0, 6);
      setOtp(next);
      if (next.length === 6) void submitOtp(next);
    }
  };

  const resendOtp = async () => {
    setLoading(true);
    setError('');
    const challenge = await beginAdminSmsChallenge(pin);
    if (!challenge.success) {
      setError(challenge.error || 'Could not resend code.');
    } else {
      setMaskedPhone(challenge.maskedPhone || '');
      setOtp('');
    }
    setLoading(false);
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
          onClick={() => {
            clearAdminSmsChallenge();
            onBack();
          }}
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
            {step === 'pin' ? 'Administrator' : 'SMS verification'}
          </h1>
          <p className="text-emerald-100/80 text-sm text-center mt-2 max-w-xs">
            {step === 'pin'
              ? 'Enter your admin PIN, then confirm with an SMS code.'
              : `Enter the 6-digit code sent to ${maskedPhone || 'your admin phone'}.`}
          </p>

          <div className="mt-6 mb-2 flex gap-2">
            <span className={`h-1.5 w-10 rounded-full ${step === 'pin' ? 'bg-white' : 'bg-white/30'}`} />
            <span className={`h-1.5 w-10 rounded-full ${step === 'otp' ? 'bg-white' : 'bg-white/30'}`} />
          </div>

          <div className="relative mt-4 mb-4 tracking-[0.5em] text-2xl font-mono text-white min-h-[2rem]">
            {loading ? (
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
            ) : (
              '•'.repeat(activeValue.length) || (
                <span className="text-emerald-200/60 tracking-normal text-sm">
                  {step === 'pin' ? 'Enter admin PIN' : 'Enter SMS code'}
                </span>
              )
            )}
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={activeLen}
              autoComplete="one-time-code"
              autoFocus
              aria-label={step === 'pin' ? 'Administrator PIN' : 'SMS verification code'}
              value={activeValue}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, '').slice(0, activeLen);
                if (step === 'pin') {
                  setPin(value);
                  if (value.length === pinLength) void submitPin(value);
                } else {
                  setOtp(value);
                  if (value.length === 6) void submitOtp(value);
                }
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
                    if (step === 'pin' && pin.length >= 4) void submitPin(pin);
                    if (step === 'otp' && otp.length === 6) void submitOtp(otp);
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

          {step === 'otp' && (
            <div className="mt-5 flex flex-col items-center gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void resendOtp()}
                className="text-emerald-100 text-xs font-semibold touch-target"
              >
                Resend SMS code
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  clearAdminSmsChallenge();
                  setStep('pin');
                  setPin('');
                  setOtp('');
                  setError('');
                }}
                className="text-emerald-200/80 text-xs touch-target"
              >
                Back to PIN
              </button>
            </div>
          )}

          <p className="text-emerald-200/70 text-[11px] text-center mt-6 max-w-sm px-2">
            Set <code className="text-emerald-100">VITE_ADMIN_PIN</code> and the admin phone in Admin → Contact.
          </p>
        </div>
      </div>
    </div>
  );
}
