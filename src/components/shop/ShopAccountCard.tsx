import { FormEvent, useState } from 'react';
import { LogOut } from 'lucide-react';
import type { ShopProfile } from '@/lib/shopClient';

interface ShopAccountCardProps {
  profile: ShopProfile;
  busy: boolean;
  error: string;
  notice: string;
  money: (value: number) => string;
  onTopup: (amount: number) => void;
  onLogout: () => void;
  onReset: (password: string) => void;
}

export default function ShopAccountCard({ profile, busy, error, notice, money, onTopup, onLogout, onReset }: ShopAccountCardProps) {
  const [amount, setAmount] = useState('20');
  const [password, setPassword] = useState('');

  const topup = (event: FormEvent) => {
    event.preventDefault();
    onTopup(Number(amount));
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section className="ios-glass rounded-[28px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-muted">My account</p>
            <h2 className="text-[28px] font-bold tracking-tight text-ink">{profile.account.name}</h2>
            <p className="text-sm text-muted">{profile.account.phone}{profile.account.email ? ` · ${profile.account.email}` : ''}</p>
          </div>
          <button type="button" onClick={onLogout} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-black/5 px-3 text-sm font-semibold text-primary">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
        <p className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-muted">Wallet balance</p>
        <p className="text-4xl font-bold tracking-tight text-ink">{money(profile.balance)}</p>
      </section>

      <form onSubmit={topup} className="ios-glass rounded-[28px] p-5">
        <h3 className="text-lg font-bold text-ink">Top up with Paystack</h3>
        <p className="mt-1 text-sm text-muted">MTN, Telecel, AirtelTigo, card, and bank open in Paystack. The wallet is credited only after Paystack verifies the payment.</p>
        {notice ? <p className="mt-3 rounded-2xl bg-emerald-50/80 px-3 py-2 text-sm text-primary">{notice}</p> : null}
        {error ? <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="topup-amount">Amount (GHS)</label>
        <input id="topup-amount" className="mt-1 w-full rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-[16px] outline-none" inputMode="decimal" min={1} max={5000} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          {[10, 20, 50, 100].map((value) => (
            <button key={value} type="button" onClick={() => setAmount(String(value))} className="rounded-full bg-white/70 px-3 py-2 text-sm font-semibold text-ink">
              GH₵ {value}
            </button>
          ))}
        </div>
        <button type="submit" disabled={busy} className="mt-4 w-full rounded-2xl bg-primary py-3.5 font-semibold text-white disabled:opacity-50">
          {busy ? 'Opening Paystack…' : 'Continue to Paystack'}
        </button>
      </form>

      <section className="ios-glass rounded-[28px] p-5">
        <h3 className="text-lg font-bold text-ink">Wallet activity</h3>
        <div className="mt-3 space-y-2">
          {profile.transactions.length === 0 ? <p className="text-sm text-muted">No wallet activity yet.</p> : profile.transactions.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/45 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{entry.description || entry.entry_type}</p>
                <p className="text-xs text-muted">{new Date(entry.created_at).toLocaleString()}</p>
              </div>
              <p className={`font-semibold ${entry.direction === 'debit' ? 'text-red-600' : 'text-primary'}`}>
                {entry.direction === 'debit' ? '−' : '+'}{money(Number(entry.amount) || 0)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="ios-glass rounded-[28px] p-5">
        <h3 className="text-lg font-bold text-ink">Orders</h3>
        <div className="mt-3 space-y-2">
          {profile.orders.length === 0 ? <p className="text-sm text-muted">No orders yet.</p> : profile.orders.map((order) => (
            <div key={order.id} className="rounded-2xl bg-white/45 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-ink">{order.order_number}</p>
                <p className="font-semibold text-primary">{money(Number(order.total_amount) || 0)}</p>
              </div>
              <p className="text-xs capitalize text-muted">{order.status} · {String(order.payment_method || '').replace(/_/g, ' ')}</p>
            </div>
          ))}
        </div>
      </section>

      <form
        className="ios-glass rounded-[28px] p-5"
        onSubmit={(event) => {
          event.preventDefault();
          onReset(password);
          setPassword('');
        }}
      >
        <h3 className="text-lg font-bold text-ink">Change password</h3>
        <input className="mt-3 w-full rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-[16px] outline-none" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" autoComplete="new-password" />
        <button type="submit" disabled={busy} className="mt-3 rounded-2xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50">Save password</button>
      </form>
    </div>
  );
}
