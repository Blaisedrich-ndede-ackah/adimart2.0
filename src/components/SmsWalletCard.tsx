import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { useFormatMoney } from '@/lib/currency';
import {
  SMS_TOPUP_PRESETS_GHS,
  loadSmsWallet,
  setReceiptSmsEnabled,
  startSmsTopup,
  textsRemaining,
  verifySmsTopup,
  type SmsWalletSnapshot,
} from '@/lib/smsWallet';

interface SmsWalletCardProps {
  storeId: string;
  userId: string;
  localBalancePesewas: number;
  localReceiptSms: boolean;
}

export default function SmsWalletCard({
  storeId,
  userId,
  localBalancePesewas,
  localReceiptSms,
}: SmsWalletCardProps) {
  const money = useFormatMoney();
  const [snapshot, setSnapshot] = useState<SmsWalletSnapshot>({
    balancePesewas: localBalancePesewas,
    receiptSmsEnabled: localReceiptSms,
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
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref') || '';
    if (params.get('smsWallet') === '1' && reference.startsWith('SMS-')) {
      const ticket = ++generation.current;
      setBusy('confirm');
      void verifySmsTopup(storeId, userId, reference)
        .then((next) => {
          if (cancelled || ticket !== generation.current) return;
          setSnapshot(next);
          setNotice(`SMS credit added. Balance GHS ${(next.balancePesewas / 100).toFixed(2)}.`);
          setError('');
        })
        .catch((verifyError: unknown) => {
          if (!cancelled) setError(verifyError instanceof Error ? verifyError.message : 'Paystack could not confirm this SMS payment.');
        })
        .finally(() => {
          if (!cancelled) setBusy('');
          params.delete('smsWallet');
          params.delete('reference');
          params.delete('trxref');
          const query = params.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
        });
    }
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
      const url = await startSmsTopup(storeId, userId, value);
      window.location.assign(url);
    } catch (payError: unknown) {
      setNotice('');
      setError(payError instanceof Error ? payError.message : 'Paystack could not open.');
      setBusy('');
    }
  }

  async function toggleReceipts() {
    const next = !snapshot.receiptSmsEnabled;
    generation.current += 1;
    setBusy('toggle');
    setError('');
    setNotice('');
    try {
      const updated = await setReceiptSmsEnabled(storeId, userId, next);
      setSnapshot(updated);
      setNotice(next ? 'Receipt texts are on for saved customer numbers.' : 'Receipt texts are off.');
    } catch (toggleError: unknown) {
      setError(toggleError instanceof Error ? toggleError.message : 'The receipt text setting was not saved.');
    } finally {
      setBusy('');
    }
  }

  const balanceLabel = money(snapshot.balancePesewas / 100);
  const textCount = textsRemaining(snapshot.balancePesewas);

  return (
    <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm" aria-label="SMS wallet">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <MessageSquare className="h-4 w-4 text-primary" />
            SMS wallet
          </p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{balanceLabel}</p>
          <p className="text-sm text-gray-600">{textCount} text{textCount === 1 ? '' : 's'} left for this store</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-gray-600">
        Bulk messages, debt reminders, care replies, and receipt texts for this store use this balance.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Receipt texts</p>
          <p className="text-xs text-gray-600">Text a receipt when the customer’s number is already saved.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={snapshot.receiptSmsEnabled}
          aria-label="Receipt texts"
          disabled={busy === 'toggle'}
          onClick={() => void toggleReceipts()}
          className={`touch-target relative h-11 w-16 shrink-0 rounded-full ${snapshot.receiptSmsEnabled ? 'bg-primary' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-1 h-9 w-9 rounded-full bg-white shadow ${snapshot.receiptSmsEnabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

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
        className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-base"
      />
      <button
        type="button"
        onClick={() => void addCredit()}
        disabled={busy === 'pay' || busy === 'confirm'}
        className="touch-target mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
      >
        {(busy === 'pay' || busy === 'confirm') && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy === 'confirm' ? 'Confirming Paystack…' : 'Add SMS credit'}
      </button>
      {notice ? <p className="mt-3 text-sm font-medium text-emerald-800">{notice}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-amber-800">{error}</p> : null}
    </section>
  );
}
