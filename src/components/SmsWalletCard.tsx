import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { useFormatMoney } from '@/lib/currency';
import {
  SMS_TOPUP_PRESETS_GHS,
  loadSmsWallet,
  paySmsTopup,
  textsRemaining,
  type SmsWalletSnapshot,
} from '@/lib/smsWallet';

interface SmsWalletCardProps {
  storeId: string;
  userId: string;
  localBalancePesewas: number;
}

export default function SmsWalletCard({
  storeId,
  userId,
  localBalancePesewas,
}: SmsWalletCardProps) {
  const money = useFormatMoney();
  const [snapshot, setSnapshot] = useState<SmsWalletSnapshot>({
    balancePesewas: localBalancePesewas,
    entries: [],
  });
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const ticket = ++generation.current;
    void loadSmsWallet(storeId, userId)
      .then((next) => {
        if (!cancelled && ticket === generation.current) setSnapshot(next);
      })
      .catch((loadError: unknown) => {
        if (!cancelled && ticket === generation.current) {
          setError(loadError instanceof Error ? loadError.message : 'SMS credit could not be refreshed.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, userId]);

  async function addCredit() {
    const value = Number(String(amount).replace(/,/g, '').trim());
    if (!Number.isFinite(value) || value < 1 || value > 5000) {
      setError('Add between GHS 1 and GHS 5,000.');
      return;
    }
    setBusy('pay');
    setError('');
    setNotice('Opening Paystack…');
    try {
      const next = await paySmsTopup(storeId, value);
      setSnapshot(next);
      setNotice(`SMS credit added. Balance GHS ${(next.balancePesewas / 100).toFixed(2)}.`);
    } catch (payError: unknown) {
      setNotice('');
      setError(payError instanceof Error ? payError.message : 'Paystack could not open.');
      setBusy('');
    }
  }

  const balanceLabel = money(snapshot.balancePesewas / 100);
  const textCount = textsRemaining(snapshot.balancePesewas);

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm" aria-label="SMS wallet">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <MessageSquare className="h-4 w-4 text-primary" />
        SMS units
      </p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{balanceLabel}</p>
      <p className="text-sm text-gray-600">{textCount} text{textCount === 1 ? '' : 's'} left for this store</p>
      <p className="mt-3 text-sm text-gray-600">
        Receipt texts, closing summaries, debt reminders, and bulk messages use only this store’s SMS units. A text is not sent when the balance is too low.
      </p>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {SMS_TOPUP_PRESETS_GHS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={amount === String(preset)}
            onClick={() => setAmount(String(preset))}
            className={`touch-target rounded-xl text-sm font-semibold ${amount === String(preset) ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800'}`}
          >
            {preset}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm font-medium text-gray-700" htmlFor="sms-topup-amount">
        Amount (GHS)
      </label>
      <input
        id="sms-topup-amount"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="button"
        onClick={() => void addCredit()}
        disabled={busy === 'pay' || busy === 'confirm'}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {(busy === 'pay' || busy === 'confirm') && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy === 'confirm' ? 'Confirming Paystack…' : 'Add SMS credit'}
      </button>
      {notice ? <p className="mt-3 text-sm font-medium text-emerald-800">{notice}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-amber-800">{error}</p> : null}
    </section>
  );
}
