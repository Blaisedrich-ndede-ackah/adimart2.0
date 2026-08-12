import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Loader2, Plus, CloudDownload, CheckCircle2, ArrowRightLeft,
} from 'lucide-react';
import {
  addStoreFromCloud,
  createStoreWithOwner,
  listLocalStores,
  type LocalStore,
} from '@/lib/dexie';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Owner multi-store portal: open another store on this device to manage
 * that store's inventory and staff after signing in.
 */
export default function StoresPortalSection() {
  const { currentStore, switchStore, currentUser } = useAuthStore();
  const [stores, setStores] = useState<LocalStore[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showAddCloud, setShowAddCloud] = useState(false);

  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [ownerName, setOwnerName] = useState(currentUser?.name || '');
  const [ownerPin, setOwnerPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [cloudStoreId, setCloudStoreId] = useState('');
  const [cloudPin, setCloudPin] = useState('');

  const refresh = useCallback(async () => {
    setStores(await listLocalStores());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, currentStore?.id]);

  const flash = (text: string, isError = false) => {
    if (isError) {
      setError(text);
      setMsg('');
    } else {
      setMsg(text);
      setError('');
    }
    setTimeout(() => {
      setMsg('');
      setError('');
    }, 4000);
  };

  const handleOpenStore = async (storeId: string) => {
    if (storeId === currentStore?.id) return;
    if (
      !confirm(
        'Switch to this store? You will sign out and must enter a PIN for that store. Its inventory and staff will load after login.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await switchStore(storeId);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not switch store', true);
    }
    setBusy(false);
  };

  const handleCreate = async () => {
    setError('');
    if (!newName.trim() || !newAddress.trim() || !isValidGhanaPhone(newPhone)) {
      flash('Enter store name, address, and a valid Ghana phone number.', true);
      return;
    }
    if (!ownerName.trim()) {
      flash('Enter the owner name for this store.', true);
      return;
    }
    if (ownerPin.length !== 4 || ownerPin !== confirmPin) {
      flash('Enter matching 4-digit owner PINs.', true);
      return;
    }
    setBusy(true);
    try {
      const { store } = await createStoreWithOwner(
        newName.trim(),
        ownerName.trim(),
        ownerPin,
        {
          address: newAddress.trim(),
          supportNumber: newPhone.trim(),
          ownerPhone: newPhone.trim(),
        }
      );
      await switchStore(store.id);
      setShowCreate(false);
      setNewName('');
      setNewAddress('');
      setNewPhone('');
      setOwnerPin('');
      setConfirmPin('');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not create store', true);
      setBusy(false);
    }
  };

  const handleAddCloud = async () => {
    setError('');
    if (!cloudStoreId.trim() || cloudPin.length !== 4) {
      flash('Enter Store ID and owner PIN.', true);
      return;
    }
    setBusy(true);
    const result = await addStoreFromCloud(cloudStoreId.trim(), cloudPin);
    if (!result.success) {
      flash(result.message, true);
      setBusy(false);
      return;
    }
    await switchStore(cloudStoreId.trim());
    setShowAddCloud(false);
    setCloudStoreId('');
    setCloudPin('');
    // switchStore clears auth — component may unmount via App
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-gray-900">My Stores</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Open a store to manage that store&apos;s inventory and staff. Switching signs you out so you
        log in under the selected store.
      </p>

      <div className="space-y-2 mb-3">
        {stores.map((store) => {
          const active = store.id === currentStore?.id;
          return (
            <div
              key={store.id}
              className={`rounded-xl border px-3 py-3 ${
                active ? 'border-emerald-300 bg-emerald-50' : 'border-gray-100 bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{store.name}</p>
                  <p className="text-[11px] text-gray-500 truncate">{store.address || 'No address'}</p>
                  <p className="text-[11px] text-gray-500 truncate">{store.support_number || 'No phone'}</p>
                  {active && (
                    <p className="text-[10px] font-bold uppercase tracking-wide text-primary mt-1">
                      Current store
                    </p>
                  )}
                </div>
                {!active && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleOpenStore(store.id)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white touch-target disabled:opacity-50"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    Open
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setShowCreate((v) => !v);
            setShowAddCloud(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 touch-target"
        >
          <Plus className="w-3.5 h-3.5" />
          Create store
        </button>
        {isSupabaseConfigured() && (
          <button
            type="button"
            onClick={() => {
              setShowAddCloud((v) => !v);
              setShowCreate(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 touch-target"
          >
            <CloudDownload className="w-3.5 h-3.5" />
            Open from cloud
          </button>
        )}
      </div>

      {showCreate && (
        <div className="mt-3 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
          <p className="text-xs font-semibold text-gray-800">New store profile</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Store name *"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Address *"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Support phone * (024…)"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Owner name *"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={ownerPin}
              onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN *"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-center tracking-widest"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Confirm *"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-center tracking-widest"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Create & open store'}
          </button>
        </div>
      )}

      {showAddCloud && (
        <div className="mt-3 space-y-2 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
          <p className="text-xs font-semibold text-gray-800">
            Open another synced store (keeps your other stores on this device)
          </p>
          <input
            value={cloudStoreId}
            onChange={(e) => setCloudStoreId(e.target.value)}
            placeholder="Store ID from Settings"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-sm"
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={cloudPin}
            onChange={(e) => setCloudPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Owner PIN"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-center tracking-widest"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAddCloud()}
            className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Open store'}
          </button>
        </div>
      )}

      {msg && (
        <p className="mt-2 flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {msg}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
