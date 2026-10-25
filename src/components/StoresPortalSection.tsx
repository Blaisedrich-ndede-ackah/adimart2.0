import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, CloudDownload, ArrowRightLeft, CheckCircle2 } from 'lucide-react';
import {
  addStoreFromCloud,
  assertCanCreateAdditionalStore,
  createStoreWithOwner,
  getAdditionalStoreQuota,
  listLocalStores,
  type LocalStore,
} from '@/lib/dexie';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { useAuthStore } from '@/store/useAuthStore';
import BranchTransferPanel from '@/components/BranchTransferPanel';

/**
 * Owner multi-store portal: open another store on this device to manage
 * that store's inventory and staff after signing in.
 */
export default function StoresPortalSection() {
  const { currentStore, switchStore, currentUser, refreshStore } = useAuthStore();
  const [stores, setStores] = useState<LocalStore[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showAddCloud, setShowAddCloud] = useState(false);
  const [quotaLabel, setQuotaLabel] = useState('');
  const [canCreateStore, setCanCreateStore] = useState(true);

  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [ownerName, setOwnerName] = useState(currentUser?.name || '');
  const [ownerPin, setOwnerPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [cloudStoreId, setCloudStoreId] = useState('');
  const [cloudPin, setCloudPin] = useState('');

  const refresh = useCallback(async () => {
    const localStores = await listLocalStores();
    setStores(localStores);
    await refreshStore();
    const phoneHint =
      currentUser?.phone || currentStore?.support_number || newPhone || '';
    const quota = await getAdditionalStoreQuota(phoneHint);
    setCanCreateStore(quota.canCreate);
    setQuotaLabel(`${quota.ownedCount}/${quota.maxStores} stores allowed`);
  }, [currentStore?.support_number, currentUser?.phone, newPhone, refreshStore]);

  useEffect(() => {
    void refresh();
  }, [refresh, currentStore?.id]);

  const flash = (text: string, isError = false) => {
    if (isError) {
      setError(text);
      setMsg('');
      return;
    }
    setMsg(text);
    setError('');
    setTimeout(() => setMsg(''), 4000);
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
      await assertCanCreateAdditionalStore(newPhone.trim());
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

  const handleRestoreCloud = async () => {
    setError('');
    const storeId = cloudStoreId.trim();
    if (!storeId || cloudPin.length !== 4) {
      flash('Enter the Store ID and 4-digit owner PIN. The administrator PIN is also accepted.', true);
      return;
    }
    if (!confirm('Add this cloud store as a branch on this device? Existing stores will remain available.')) return;
    setBusy(true);
    try {
      const result = await addStoreFromCloud(storeId, cloudPin);
      if (!result.success) {
        flash(result.message, true);
        return;
      }
      setShowAddCloud(false);
      setCloudStoreId('');
      setCloudPin('');
      flash(result.message);
      await refresh();
    } catch (restoreError) {
      flash(restoreError instanceof Error ? restoreError.message : 'Could not restore store from cloud.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-gray-900">My Stores</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Link unlimited existing stores to this owner account with each Store ID and its 4-digit owner PIN. Linked stores stay available in Branch inventory for secure stock transfers.
        {quotaLabel ? ` New store creation: ${quotaLabel}.` : ''}
      </p>

      <div className="space-y-2 mb-3">
        {stores.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 px-3 py-4 text-center">
            <p className="text-xs text-gray-600">No linked stores yet. Use the button below to link your first store.</p>
          </div>
        ) : (
          stores.map((store) => {
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
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Store / branch name</p>
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
          })
        )}
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => setShowAddCloud((visible) => !visible)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
        >
          <CloudDownload className="h-4 w-4" />
          Restore store from cloud
        </button>

        {showAddCloud && (
          <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
            <p className="text-xs leading-relaxed text-gray-600">
              Enter the store&apos;s ID and 4-digit owner PIN to add its cloud data as a branch on this device.
              Existing stores stay available, and the administrator PIN can override the owner PIN when authorized.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold text-gray-700">
                Store ID
                <input
                  value={cloudStoreId}
                  onChange={(event) => setCloudStoreId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  placeholder="Enter Store ID"
                  autoComplete="off"
                />
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Owner or admin PIN
                <input
                  value={cloudPin}
                  onChange={(event) => setCloudPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-center text-lg tracking-[0.45em] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  placeholder="••••"
                  autoComplete="off"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleRestoreCloud()}
              disabled={busy}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
              {busy ? 'Restoring…' : 'Restore from cloud'}
            </button>
            <p className="mt-2 text-[11px] text-amber-700">
              This adds or refreshes the selected store as a branch. Other stores on this device are not removed.
            </p>
          </div>
        )}
      </div>

      {stores.length > 1 && (
        <BranchTransferPanel
          title="Branch inventory"
          showHistory
          collapsible
          onTransferred={() => void refresh()}
        />
      )}

      {msg && (
        <p role="status" className="mt-3 flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {msg}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
