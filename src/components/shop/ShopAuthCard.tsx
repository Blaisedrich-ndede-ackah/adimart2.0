import { FormEvent, useState } from 'react';

export type ShopAuthMode = 'login' | 'signup' | 'otp' | 'forgot' | 'reset';

interface ShopAuthCardProps {
  mode: ShopAuthMode;
  busy: boolean;
  error: string;
  notice: string;
  phone: string;
  onMode: (mode: ShopAuthMode) => void;
  onLogin: (identifier: string, password: string) => void;
  onSignup: (input: { name: string; phone: string; email: string; password: string }) => void;
  onOtp: (code: string) => void;
  onResend: () => void;
  onForgot: (email: string) => void;
  onReset: (password: string) => void;
}

const field = 'w-full rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-[16px] text-ink outline-none';

export default function ShopAuthCard({
  mode, busy, error, notice, phone, onMode, onLogin, onSignup, onOtp, onResend, onForgot, onReset,
}: ShopAuthCardProps) {
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'login') onLogin(identifier, password);
    if (mode === 'signup') onSignup({ name, phone: identifier, email, password });
    if (mode === 'otp') onOtp(code);
    if (mode === 'forgot') onForgot(email);
    if (mode === 'reset') onReset(password);
  };

  return (
    <form onSubmit={submit} className="ios-glass mx-auto w-full max-w-md rounded-[28px] p-5 md:p-6">
      <p className="text-[13px] font-semibold text-muted">
        {mode === 'signup' ? 'Create account' : mode === 'otp' ? 'Confirm phone' : mode === 'forgot' ? 'Reset password' : mode === 'reset' ? 'New password' : 'Welcome back'}
      </p>
      <h2 className="mt-1 text-[28px] font-bold tracking-tight text-ink">
        {mode === 'signup' ? 'Join this shop' : mode === 'otp' ? 'Enter the SMS code' : mode === 'forgot' ? 'Email a reset link' : mode === 'reset' ? 'Choose a new password' : 'Log in'}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {mode === 'otp'
          ? `We sent a 6-digit code to ${phone || 'your phone'}.`
          : 'Your account stays with this shop. Passwords are handled by Supabase.'}
      </p>
      {notice ? <p className="mt-3 rounded-2xl bg-emerald-50/80 px-3 py-2 text-sm text-primary">{notice}</p> : null}
      {error ? <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 space-y-3">
        {mode === 'signup' ? (
          <>
            <input className={field} value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" autoComplete="name" required />
            <input className={field} value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Phone, 0244123456" autoComplete="tel" inputMode="tel" required />
            <input className={field} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email (optional)" autoComplete="email" inputMode="email" />
            <input className={field} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" autoComplete="new-password" minLength={8} required />
          </>
        ) : null}
        {mode === 'login' ? (
          <>
            <input className={field} value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Phone or email" autoComplete="username" required />
            <input className={field} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" autoComplete="current-password" required />
          </>
        ) : null}
        {mode === 'otp' ? (
          <input className={`${field} tracking-[0.4em] text-center text-xl`} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" required />
        ) : null}
        {mode === 'forgot' ? (
          <input className={field} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email on the account" autoComplete="email" required />
        ) : null}
        {mode === 'reset' ? (
          <input className={field} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" type="password" autoComplete="new-password" minLength={8} required />
        ) : null}
      </div>
      <button type="submit" disabled={busy} className="mt-4 w-full rounded-2xl bg-primary py-3.5 text-[16px] font-semibold text-white disabled:opacity-50">
        {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'otp' ? 'Confirm code' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Save password' : 'Log in'}
      </button>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-primary">
        {mode !== 'login' ? <button type="button" onClick={() => onMode('login')}>Log in</button> : null}
        {mode !== 'signup' ? <button type="button" onClick={() => onMode('signup')}>Create account</button> : null}
        {mode === 'login' ? <button type="button" onClick={() => onMode('forgot')}>Forgot password</button> : null}
        {mode === 'login' || mode === 'otp' ? <button type="button" onClick={() => onMode('otp')}>Use SMS code</button> : null}
        {mode === 'otp' ? <button type="button" onClick={onResend}>Resend code</button> : null}
      </div>
    </form>
  );
}
