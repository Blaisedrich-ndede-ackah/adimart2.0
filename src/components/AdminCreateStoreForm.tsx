import { useState } from 'react';
import { CheckCircle2, Loader2, Plus, Store } from 'lucide-react';
import CopyableStoreId from '@/components/CopyableStoreId';
import { createAdminStore, type AdminCreatedStore } from '@/lib/adminPortal';
import { isValidGhanaPhone } from '@/lib/platformSettings';

export default function AdminCreateStoreForm({
  onCreated,
}: {
  onCreated: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [supportNumber, setSupportNumber] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<AdminCreatedStore | null>(null);

  const resetForm = () => {
    setStoreName('');
    setAddress('');
    setSupportNumber('');
    setOwnerName('');
    setOwnerPhone('');
    setOwnerPin('');
  };

  const handleCreate = async () => {
    setError('');
    if (!isValidGhanaPhone(supportNumber)) {
      setError('Enter a valid Ghana support phone (e.g. 024XXXXXXX).');
      return;
    }
    if (ownerPhone && !isValidGhanaPhone(ownerPhone)) {
      setError('Enter a valid Ghana owner phone or leave it blank.');
      return;
    }
    setBusy(true);
    const result = await createAdminStore({
      storeName,
      address,
      supportNumber,
      ownerName,
      ownerPhone: ownerPhone || supportNumber,
      ownerPin,
    });
    setBusy(false);
    if (!result.success || !result.created) {
      setError(result.error || 'Could not create store');
      return;
    }
    setCreated(result.created);
    resetForm();
    await onCreated();
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError('');
        }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left touch-target"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shrink-0">
            <Plus className="w-4 h-4" />
          </span>
          <span>
            <p className="text-sm font-bold text-slate-900">Create a store</p>
            <p className="text-[11px] text-slate-500">Add a store and owner from admin</p>
          </span>
        </span>
        <Store className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          {created && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-bold text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                {created.storeName} created
              </p>
              <p className="text-[11px] text-emerald-800 mt-1">
                Share this Store ID so the owner can restore it on their phone. They sign in with the PIN you set.
              </p>
              <CopyableStoreId storeId={created.storeId} />
            </div>
          )}

          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="Store name"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
          />
          <input
            type="tel"
            value={supportNumber}
            onChange={(e) => setSupportNumber(e.target.value)}
            placeholder="Support phone (024…)"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Owner name"
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
            <input
              type="tel"
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              placeholder="Owner phone (optional)"
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"
            />
          </div>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={ownerPin}
            onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Owner 4-digit PIN"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm tracking-[0.4em] text-center"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-white py-3 text-sm font-semibold touch-target disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create store
          </button>
        </div>
      )}
    </div>
  );
}
