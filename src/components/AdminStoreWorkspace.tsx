import { useMemo, useState } from 'react';
import {
  ArrowLeft, Package, Users, Loader2, UserPlus, Ban, CheckCircle2, Key,
} from 'lucide-react';
import {
  addAdminStoreCashier,
  formatGhs,
  resetAdminUserPin,
  setAdminUserActive,
  updateAdminProduct,
  type AdminDashboardData,
  type AdminProductRow,
  type AdminStoreRow,
  type AdminUserRow,
} from '@/lib/adminPortal';

interface AdminStoreWorkspaceProps {
  store: AdminStoreRow;
  data: AdminDashboardData;
  onBack: () => void;
  onChanged: () => Promise<void>;
}

type WorkspaceTab = 'inventory' | 'staff';

export default function AdminStoreWorkspace({
  store,
  data,
  onBack,
  onChanged,
}: AdminStoreWorkspaceProps) {
  const [tab, setTab] = useState<WorkspaceTab>('inventory');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffPin, setStaffPin] = useState('');
  const [resetPinUserId, setResetPinUserId] = useState<string | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [stockEdits, setStockEdits] = useState<Record<string, string>>({});

  const products = useMemo(
    () =>
      data.products
        .filter((p) => p.store_id === store.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.products, store.id]
  );

  const users = useMemo(
    () =>
      data.users
        .filter((u) => u.store_id === store.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.users, store.id]
  );

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 4000);
  };

  const toggleProduct = async (product: AdminProductRow) => {
    setBusyId(product.id);
    const result = await updateAdminProduct(product.id, { is_active: !product.is_active });
    if (!result.success) flash(result.error || 'Update failed');
    else {
      flash(product.is_active ? 'Product deactivated' : 'Product activated');
      await onChanged();
    }
    setBusyId(null);
  };

  const saveStock = async (product: AdminProductRow) => {
    const raw = stockEdits[product.id];
    if (raw == null || raw === '') return;
    const stock = Math.max(0, Math.floor(Number(raw) || 0));
    setBusyId(product.id);
    const result = await updateAdminProduct(product.id, { stock_level: stock });
    if (!result.success) flash(result.error || 'Stock update failed');
    else {
      flash(`Stock updated for ${product.name}`);
      setStockEdits((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      await onChanged();
    }
    setBusyId(null);
  };

  const toggleUser = async (user: AdminUserRow) => {
    if (user.role === 'owner') {
      flash('Owner accounts cannot be blocked here.');
      return;
    }
    setBusyId(user.id);
    const result = await setAdminUserActive(user.id, !user.is_active);
    if (!result.success) flash(result.error || 'Update failed');
    else {
      flash(user.is_active ? `Blocked ${user.name}` : `Unblocked ${user.name}`);
      await onChanged();
    }
    setBusyId(null);
  };

  const addCashier = async () => {
    setBusyId('new-staff');
    const result = await addAdminStoreCashier(store.id, staffName, staffPin);
    if (!result.success) flash(result.error || 'Could not add staff');
    else {
      flash(`Added cashier ${staffName.trim()}`);
      setStaffName('');
      setStaffPin('');
      await onChanged();
    }
    setBusyId(null);
  };

  const doResetPin = async (userId: string) => {
    setBusyId(userId);
    const result = await resetAdminUserPin(userId, resetPin);
    if (!result.success) flash(result.error || 'PIN reset failed');
    else {
      flash('PIN updated');
      setResetPinUserId(null);
      setResetPin('');
      await onChanged();
    }
    setBusyId(null);
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 touch-target"
      >
        <ArrowLeft className="w-4 h-4" />
        All stores
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Store workspace</p>
        <h2 className="text-xl font-bold text-slate-900 mt-1">{store.name}</h2>
        <p className="text-xs text-slate-500 mt-1">
          {[store.address, store.support_number].filter(Boolean).join(' · ') || 'No profile details'}
        </p>
        <p className="text-[11px] text-slate-500 mt-2">
          {users.length} staff · {products.length} products · manage inventory &amp; staff for this store
        </p>
      </div>

      <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setTab('inventory')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
            tab === 'inventory' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <Package className="w-4 h-4" />
            Inventory
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('staff')}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
            tab === 'staff' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <Users className="w-4 h-4" />
            Staff
          </span>
        </button>
      </div>

      {status && (
        <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800">
          {status}
        </p>
      )}

      {tab === 'inventory' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {products.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">No products for this store.</p>
          ) : (
            products.map((product) => (
              <div key={product.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{product.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {product.category} · {formatGhs(product.selling_price)}
                      {!product.is_active ? ' · inactive' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === product.id}
                    onClick={() => void toggleProduct(product)}
                    className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700"
                  >
                    {product.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[11px] text-slate-500">Stock</label>
                  <input
                    type="number"
                    min={0}
                    value={stockEdits[product.id] ?? String(product.stock_level)}
                    onChange={(e) =>
                      setStockEdits((prev) => ({ ...prev, [product.id]: e.target.value }))
                    }
                    className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busyId === product.id}
                    onClick={() => void saveStock(product)}
                    className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {busyId === product.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'staff' && (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-800">Add cashier</p>
            <input
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Staff name"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={staffPin}
              onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, ''))}
              placeholder="4-digit PIN"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-center tracking-widest"
            />
            <button
              type="button"
              disabled={busyId === 'new-staff'}
              onClick={() => void addCashier()}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busyId === 'new-staff' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Add staff
                </>
              )}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {users.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-10">No staff found.</p>
            ) : (
              users.map((user) => (
                <div key={user.id} className="px-4 py-3 border-b border-slate-100 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                      <p className="text-[11px] text-slate-500 capitalize">
                        {user.role}
                        {!user.is_active ? ' · blocked' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {user.role === 'cashier' && (
                        <button
                          type="button"
                          disabled={busyId === user.id}
                          onClick={() => void toggleUser(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-700"
                        >
                          {user.is_active ? (
                            <>
                              <Ban className="w-3 h-3" /> Block
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> Unblock
                            </>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setResetPinUserId(resetPinUserId === user.id ? null : user.id);
                          setResetPin('');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-700"
                      >
                        <Key className="w-3 h-3" />
                        PIN
                      </button>
                    </div>
                  </div>
                  {resetPinUserId === user.id && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={resetPin}
                        onChange={(e) => setResetPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="New PIN"
                        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-center tracking-widest"
                      />
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => void doResetPin(user.id)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
