import { useCallback, useEffect, useState } from 'react';
import {
  Warehouse, Loader2, Plus, KeyRound, Lock, CheckCircle2, ArrowRightLeft,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  createLocation,
  listLocations,
  setLocationAccessPin,
} from '@/lib/warehouse';
import {
  clearWarehouseUnlock,
  setPendingWarehouseLogin,
} from '@/lib/warehouseAccess';
import type { LocalLocation } from '@/lib/dexie';

/**
 * Settings portal for warehouses: create (admin-limited), set PIN,
 * and open (signs out — enter warehouse PIN on the login screen, like store switch).
 */
export default function WarehousePortalSection() {
  const { currentStore, refreshStore, switchUser } = useAuthStore();
  const warehouseEnabled = (currentStore?.warehouse_enabled ?? 0) === 1;
  const maxWarehouses = currentStore?.max_warehouses ?? 0;

  const [warehouses, setWarehouses] = useState<LocalLocation[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [pinTargetId, setPinTargetId] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState<'set' | 'change'>('set');
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');

  const refresh = useCallback(async () => {
    if (!currentStore?.id) {
      setWarehouses([]);
      return;
    }
    const locs = await listLocations(currentStore.id);
    setWarehouses(locs.filter((l) => l.location_type === 'warehouse'));
    await refreshStore();
  }, [currentStore?.id, refreshStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const canAdd = warehouseEnabled && warehouses.length < maxWarehouses;

  const beginWarehouseSwitch = (loc: LocalLocation) => {
    if (!currentStore?.id) return;
    if (
      !confirm(
        `Switch to warehouse “${loc.name}”? You will sign out and must enter this warehouse’s PIN to open and manage it.`
      )
    ) {
      return;
    }
    clearWarehouseUnlock();
    setPendingWarehouseLogin({
      storeId: currentStore.id,
      locationId: loc.id,
      name: loc.name,
    });
    switchUser();
  };

  const handleCreate = async () => {
    if (!currentStore?.id) return;
    if (!newName.trim()) {
      flash('Enter a warehouse name.', true);
      return;
    }
    if (newPin.length !== 4 || newPin !== confirmPin) {
      flash('Enter matching 4-digit warehouse PINs.', true);
      return;
    }
    setBusy(true);
    try {
      const location = await createLocation({
        storeId: currentStore.id,
        name: newName.trim(),
        locationType: 'warehouse',
        accessPin: newPin,
      });
      clearWarehouseUnlock();
      setPendingWarehouseLogin({
        storeId: currentStore.id,
        locationId: location.id,
        name: location.name,
      });
      setShowCreate(false);
      setNewName('');
      setNewPin('');
      setConfirmPin('');
      switchUser();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not create warehouse', true);
      setBusy(false);
    }
  };

  const startPinFlow = (loc: LocalLocation, mode: 'set' | 'change') => {
    setPinTargetId(loc.id);
    setPinMode(mode);
    setPinValue('');
    setPinConfirm('');
    setError('');
  };

  const handlePinSubmit = async () => {
    if (!pinTargetId) return;
    if (pinValue.length !== 4 || pinValue !== pinConfirm) {
      flash('Enter matching 4-digit PINs.', true);
      return;
    }
    setBusy(true);
    try {
      await setLocationAccessPin(pinTargetId, pinValue);
      flash(pinMode === 'set' ? 'Warehouse PIN saved — you can Open it now' : 'Warehouse PIN updated');
      setPinTargetId(null);
      await refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'PIN action failed', true);
    }
    setBusy(false);
  };

  if (!warehouseEnabled && warehouses.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Warehouse className="w-5 h-5 text-amber-600" />
          <h3 className="font-bold text-gray-900">My Warehouses</h3>
        </div>
        <p className="text-xs text-gray-500">
          Warehouse is not enabled for this store. Ask your administrator to enable it and set how
          many warehouses you can create.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Warehouse className="w-5 h-5 text-amber-600" />
        <h3 className="font-bold text-gray-900">My Warehouses</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Open a warehouse like switching stores — you sign out and enter that warehouse&apos;s PIN.
        {warehouseEnabled && (
          <>
            {' '}
            Limit: {warehouses.length}/{maxWarehouses}
          </>
        )}
      </p>

      <div className="space-y-2 mb-3">
        {warehouses.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No warehouses yet</p>
        ) : (
          warehouses.map((loc) => {
            const hasPin = Boolean(loc.access_pin_hash);
            return (
              <div
                key={loc.id}
                className="rounded-xl border border-amber-100 bg-amber-50/40 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{loc.name}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 inline-flex items-center gap-1">
                      {hasPin ? (
                        <>
                          <Lock className="w-3 h-3" />
                          PIN set — Open signs you out
                        </>
                      ) : (
                        <>
                          <KeyRound className="w-3 h-3" />
                          Create a PIN before you can open it
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {hasPin ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => beginWarehouseSwitch(loc)}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white touch-target disabled:opacity-50"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          Open
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startPinFlow(loc, 'change')}
                          className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-900 touch-target"
                        >
                          Change PIN
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startPinFlow(loc, 'set')}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white touch-target"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Set PIN
                      </button>
                    )}
                  </div>
                </div>

                {pinTargetId === loc.id && (
                  <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-white p-3">
                    <p className="text-xs font-semibold text-gray-800">
                      {pinMode === 'change' ? 'Set a new 4-digit PIN' : 'Create a 4-digit PIN'}
                    </p>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinValue}
                      onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                      placeholder="PIN *"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-center tracking-widest"
                    />
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                      placeholder="Confirm PIN *"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-center tracking-widest"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handlePinSubmit()}
                        className="flex-1 rounded-xl bg-amber-700 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Save PIN'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPinTargetId(null)}
                        className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {canAdd && (
        <button
          type="button"
          onClick={() => {
            setShowCreate((v) => !v);
            setPinTargetId(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-900 touch-target"
        >
          <Plus className="w-3.5 h-3.5" />
          Create warehouse
        </button>
      )}

      {!canAdd && warehouseEnabled && (
        <p className="text-[11px] text-amber-800/80">
          {maxWarehouses <= 0
            ? 'Admin has not granted any warehouse slots yet.'
            : `Warehouse limit reached (${warehouses.length}/${maxWarehouses}). Ask admin to raise your limit.`}
        </p>
      )}

      {showCreate && canAdd && (
        <div className="mt-3 space-y-2 rounded-xl border border-amber-100 bg-amber-50/50 p-3">
          <p className="text-xs font-semibold text-gray-800">New warehouse</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Warehouse name *"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
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
            className="w-full rounded-xl bg-amber-700 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              'Create & open warehouse'
            )}
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
