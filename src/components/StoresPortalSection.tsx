import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, Plus, CloudDownload, CheckCircle2, ArrowRightLeft } from 'lucide-react';
import {
  addStoreFromCloud,
  assertCanCreateAdditionalStore,
  createStoreWithOwner,
  getAdditionalStoreQuota,
  listLocalStores,
  type LocalStore,
} from '@/lib/dexie';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { isSupabaseConfigured } from '@/lib/supabase';
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

      {stores.length > 1 && (
        <BranchTransferPanel
          title="Branch inventory"
          showHistory
          collapsible
          onTransferred={() => void refresh()}
        />
      )}
    </div>
  );
}
