import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Loader2, Plus, CloudDownload, CheckCircle2, ArrowRightLeft, Boxes,
} from 'lucide-react';
import { db, type LocalProduct } from '@/lib/dexie';
import { transferStockBetweenStores } from '@/lib/warehouse';
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
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [sourceStoreId, setSourceStoreId] = useState('');
  const [destinationStoreId, setDestinationStoreId] = useState('');
  const [sourceProductId, setSourceProductId] = useState('');
  const [destinationProductId, setDestinationProductId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('');
  const [showBranchTransfer, setShowBranchTransfer] = useState(false);

  const refresh = useCallback(async () => {
    const localStores = await listLocalStores();
    setStores(localStores);
    setProducts(await db.products.toArray());
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

  const sourceProducts = useMemo(
    () => products.filter((product) => product.store_id === sourceStoreId && product.is_active === 1),
    [products, sourceStoreId]
  );
  const destinationProducts = useMemo(
    () => products.filter((product) => product.store_id === destinationStoreId && product.is_active === 1),
    [products, destinationStoreId]
  );

  const handleBranchTransfer = async () => {
    const quantity = Number(transferQuantity);
    if (!sourceStoreId || !destinationStoreId || !sourceProductId || !destinationProductId) {
      flash('Choose the source store, destination store, and matching products.', true);
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      flash('Enter a whole quantity greater than zero.', true);
      return;
    }
    setBusy(true);
    try {
      await transferStockBetweenStores({
        sourceStoreId,
        destinationStoreId,
        sourceProductId,
        destinationProductId,
        quantity,
        userId: currentUser?.id,
        note: `Branch inventory transfer from ${sourceStoreId} to ${destinationStoreId}`,
      });
      await refresh();
      setTransferQuantity('');
      flash('Transfer completed. Source stock was deducted and destination stock was added.');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Transfer failed', true);
    } finally {
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

      {stores.length > 1 && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                <Boxes className="h-4 w-4 text-emerald-700" /> Branch inventory
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                Move stock between any stores linked to this owner account. Every transfer deducts the source first and records the matching addition at the destination.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowBranchTransfer((value) => !value)}
              className="shrink-0 rounded-lg bg-emerald-700 px-2.5 py-2 text-[11px] font-bold text-white"
            >
              {showBranchTransfer ? 'Close' : 'Transfer'}
            </button>
          </div>
          {showBranchTransfer && (
            <div className="mt-3 space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] font-semibold text-gray-600">
                  From store
                  <select
                    value={sourceStoreId}
                    onChange={(event) => {
                      setSourceStoreId(event.target.value);
                      setSourceProductId('');
                    }}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="">Select source store</option>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-gray-600">
                  To store
                  <select
                    value={destinationStoreId}
                    onChange={(event) => {
                      setDestinationStoreId(event.target.value);
                      setDestinationProductId('');
                    }}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="">Select destination store</option>
                    {stores.filter((store) => store.id !== sourceStoreId).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_110px]">
                <select
                  value={sourceProductId}
                  onChange={(event) => setSourceProductId(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  aria-label="Source product"
                >
                  <option value="">Product leaving source</option>
                  {sourceProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock_level} available</option>)}
                </select>
                <select
                  value={destinationProductId}
                  onChange={(event) => setDestinationProductId(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  aria-label="Destination product"
                >
                  <option value="">Matching destination product</option>
                  {destinationProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={transferQuantity}
                  onChange={(event) => setTransferQuantity(event.target.value)}
                  placeholder="Qty"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  aria-label="Transfer quantity"
                />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleBranchTransfer()}
                className="w-full rounded-xl bg-gray-900 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Confirm stock transfer'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canCreateStore}
          onClick={() => {
            setShowCreate((v) => !v);
            setShowAddCloud(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 touch-target disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          Create store
        </button>
        {!canCreateStore && (
          <p className="w-full text-[11px] text-amber-800">
            Store limit reached. Ask your administrator to allow more stores.
          </p>
        )}
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

      {showCreate && canCreateStore && (
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
            Add to Branch inventory
            <span className="block mt-1 text-[11px] font-normal text-gray-500">
              Enter the Store ID and the 4-digit owner PIN for that store. This adds it without removing your other linked stores.
            </span>
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
            placeholder="Enter your 4-digit owner PIN"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-center tracking-widest"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAddCloud()}
            className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Add store to Branch inventory'}
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
