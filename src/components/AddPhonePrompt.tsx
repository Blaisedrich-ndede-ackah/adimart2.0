import { useState } from 'react';
import { Phone, Loader2, AlertCircle } from 'lucide-react';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Blocking prompt so older accounts without a phone can attach one
 * (needed for SMS PIN reset and multi-store identity).
 */
export default function AddPhonePrompt() {
  const { currentUser, updateMyPhone } = useAuthStore();
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    if (!isValidGhanaPhone(phone)) {
      setError('Enter a valid Ghana mobile number (e.g. 024XXXXXXX).');
      return;
    }
    setBusy(true);
    try {
      await updateMyPhone(phone.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save phone number');
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4">
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl p-5 sm:p-6 animate-slide-up"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <Phone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add your phone number</h2>
            <p className="text-xs text-slate-500">Required for PIN reset and store recovery</p>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 leading-relaxed flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Hi {currentUser?.name || 'there'} — your account doesn&apos;t have a phone number yet.
            Add it now so you can reset your PIN by SMS if you forget it.
          </span>
        </div>

        <label className="text-xs font-semibold text-slate-600 mb-1.5 block">
          Ghana mobile number
        </label>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="024XXXXXXX"
          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm mb-2"
        />
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSave()}
          className="w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-white disabled:opacity-50 touch-target"
        >
          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Save phone number'}
        </button>
      </div>
    </div>
  );
}
