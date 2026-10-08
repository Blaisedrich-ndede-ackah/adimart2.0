import { useState, type FormEvent } from 'react';
import { Shield, ArrowLeft, Loader2 } from 'lucide-react';
import { signInPlatformAdmin } from '@/lib/adminAuth';
import { isSupabaseConfigured } from '@/lib/supabase';
import AuthShowcase from '@/components/AuthShowcase';

interface AdminLoginPageProps {
  onSuccess: () => void;
  onBack: () => void;
}

export default function AdminLoginPage({ onSuccess, onBack }: AdminLoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!isSupabaseConfigured()) {
      setError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for this app.');
      return;
    }

    setLoading(true);
    const result = await signInPlatformAdmin(email, password);
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'Administrator sign-in could not be completed.');
      return;
    }
    onSuccess();
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
            Sign in with your platform administrator email and password.
          </p>

          <form onSubmit={(event) => void submit(event)} className="mt-7 w-full space-y-4">
            <label className="grid gap-1.5 text-sm font-semibold text-white">
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-h-12 rounded-xl border border-white/30 bg-white px-3 font-normal text-slate-900 outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-white">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-h-12 rounded-xl border border-white/30 bg-white px-3 font-normal text-slate-900 outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </label>

            {error && (
              <p role="alert" className="text-red-200 text-sm text-center px-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-emerald-950 hover:bg-emerald-50 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-emerald-200/70 text-xs text-center mt-6 max-w-sm px-2">
            This must be a Supabase Auth account with the platform administrator role. Setup steps are in the Administrator Portal section of the README.
          </p>
        </div>
      </div>
    </div>
  );
}
