import { useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Users,
  Building2,
  Phone,
  Smartphone,
  Landmark,
  Banknote,
  Trash2,
  X,
  Percent,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import type { LocalLocation, LocalUser } from '@/lib/dexie';
import { formatPesewas, ghsToPesewas, pesewasToGhs } from '@/lib/payroll/calculator';
import {
  formatPaymentDestination,
  parseAllowances,
  savePayrollStaff,
  todayDateOnly,
  type PayrollActor,
} from '@/lib/payroll/store';
import type {
  LocalPayrollStaff,
  PayrollAllowanceItem,
  PayrollPaymentMethod,
  PayrollPayType,
} from '@/lib/payroll/types';

interface StaffManagerProps {
  storeId: string;
  staffList: LocalPayrollStaff[];
  locations: LocalLocation[];
  users: LocalUser[];
  actor: PayrollActor;
  onRefresh: () => Promise<void>;
}

const PAY_TYPE_LABELS: Record<PayrollPayType, string> = {
  monthly: 'Monthly salary',
  weekly: 'Weekly rate',
  daily: 'Daily rate',
  per_shift: 'Per shift',
};

const ALLOWANCE_PRESETS = ['Transport', 'Meals', 'Airtime / Data', 'Housing', 'Responsibility'];

interface StaffFormState {
  id?: string;
  full_name: string;
  role_title: string;
  location_id: string;
  user_id: string;
  phone: string;
  start_date: string;
  pay_type: PayrollPayType;
  basic_pay_ghs: string;
  allowances: Array<{ id: string; name: string; amount_ghs: string; is_taxable: boolean }>;
  payment_method: PayrollPaymentMethod;
  momo_network: string;
  momo_number: string;
  momo_account_name: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  bank_branch: string;
  ssnit_number: string;
  tin_number: string;
  ssnit_exempt: boolean;
  commission_enabled: boolean;
  commission_rate_pct: string;
  commission_min_sales_ghs: string;
  is_active: boolean;
}

function emptyForm(defaultLocationId: string): StaffFormState {
  return {
    full_name: '',
    role_title: 'Cashier',
    location_id: defaultLocationId,
    user_id: '',
    phone: '',
    start_date: todayDateOnly(),
    pay_type: 'monthly',
    basic_pay_ghs: '',
    allowances: [],
    payment_method: 'momo',
    momo_network: 'MTN',
    momo_number: '',
    momo_account_name: '',
    bank_name: '',
    bank_account_number: '',
    bank_account_name: '',
    bank_branch: '',
    ssnit_number: '',
    tin_number: '',
    ssnit_exempt: false,
    commission_enabled: false,
    commission_rate_pct: '1.0',
    commission_min_sales_ghs: '0',
    is_active: true,
  };
}

function staffToForm(s: LocalPayrollStaff): StaffFormState {
  const allowances = parseAllowances(s.allowances_json).map((a) => ({
    id: a.id,
    name: a.name,
    amount_ghs: String(pesewasToGhs(a.amount_pesewas)),
    is_taxable: a.is_taxable,
  }));
  return {
    id: s.id,
    full_name: s.full_name,
    role_title: s.role_title,
    location_id: s.location_id || '',
    user_id: s.user_id || '',
    phone: s.phone,
    start_date: s.start_date,
    pay_type: s.pay_type,
    basic_pay_ghs: String(pesewasToGhs(s.basic_pay_pesewas)),
    allowances,
    payment_method: s.payment_method,
    momo_network: s.momo_network || 'MTN',
    momo_number: s.momo_number,
    momo_account_name: s.momo_account_name,
    bank_name: s.bank_name,
    bank_account_number: s.bank_account_number,
    bank_account_name: s.bank_account_name,
    bank_branch: s.bank_branch,
    ssnit_number: s.ssnit_number,
    tin_number: s.tin_number,
    ssnit_exempt: s.ssnit_exempt === 1,
    commission_enabled: s.commission_enabled === 1,
    commission_rate_pct: String(s.commission_rate_bps / 100),
    commission_min_sales_ghs: String(pesewasToGhs(s.commission_min_sales_pesewas)),
    is_active: s.is_active === 1,
  };
}

export default function StaffManager({
  storeId,
  staffList,
  locations,
  users,
  actor,
  onRefresh,
}: StaffManagerProps) {
  const [filterLocation, setFilterLocation] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<StaffFormState>(() => emptyForm(locations[0]?.id || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const locationMap = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (!showInactive && s.is_active !== 1) return false;
      if (filterLocation !== 'all' && (s.location_id || '') !== filterLocation) return false;
      return true;
    });
  }, [staffList, showInactive, filterLocation]);

  const openAdd = () => {
    setError('');
    setForm(emptyForm(locations.find((l) => l.is_default === 1)?.id || locations[0]?.id || ''));
    setModalOpen(true);
  };

  const openEdit = (staff: LocalPayrollStaff) => {
    setError('');
    setForm(staffToForm(staff));
    setModalOpen(true);
  };

  const addAllowanceRow = (presetName = '') => {
    setForm((prev) => ({
      ...prev,
      allowances: [
        ...prev.allowances,
        { id: `al_${Date.now()}_${prev.allowances.length}`, name: presetName, amount_ghs: '', is_taxable: true },
      ],
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const allowances: PayrollAllowanceItem[] = form.allowances
        .filter((a) => a.name.trim() && ghsToPesewas(a.amount_ghs) > 0)
        .map((a) => ({
          id: a.id,
          name: a.name.trim(),
          amount_pesewas: ghsToPesewas(a.amount_ghs),
          is_taxable: a.is_taxable,
        }));

      await savePayrollStaff(
        storeId,
        {
          id: form.id,
          location_id: form.location_id || null,
          user_id: form.user_id || null,
          full_name: form.full_name,
          role_title: form.role_title,
          phone: form.phone,
          start_date: form.start_date,
          pay_type: form.pay_type,
          basic_pay_pesewas: ghsToPesewas(form.basic_pay_ghs),
          allowances,
          payment_method: form.payment_method,
          momo_network: form.momo_network,
          momo_number: form.momo_number,
          momo_account_name: form.momo_account_name,
          bank_name: form.bank_name,
          bank_account_number: form.bank_account_number,
          bank_account_name: form.bank_account_name,
          bank_branch: form.bank_branch,
          ssnit_number: form.ssnit_number,
          tin_number: form.tin_number,
          ssnit_exempt: form.ssnit_exempt,
          commission_enabled: form.commission_enabled,
          commission_rate_bps: Math.round((Number(form.commission_rate_pct) || 0) * 100),
          commission_min_sales_pesewas: ghsToPesewas(form.commission_min_sales_ghs),
          is_active: form.is_active,
        },
        actor
      );
      await onRefresh();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save staff member.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {locations.length > 1 && (
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink dark:border-white/10 dark:bg-slate-900"
            >
              <option value="all">All shops / branches</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}
          <label className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-medium text-muted shadow-xs dark:bg-slate-900">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openAdd}>
          Add Staff
        </Button>
      </div>

      {filteredStaff.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10 text-muted" />}
          title="No staff added yet"
          description="Add your cashiers, shop assistants, drivers, or managers with their pay setup and MoMo or bank details."
          action={
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openAdd}>
              Add your first staff member
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredStaff.map((staff) => {
            const allowances = parseAllowances(staff.allowances_json);
            const totalAllowances = allowances.reduce((s, a) => s + a.amount_pesewas, 0);
            const linkedUser = staff.user_id ? userMap.get(staff.user_id) : undefined;
            const shopName = (staff.location_id && locationMap.get(staff.location_id)) || 'Main Shop';
            const PayIcon =
              staff.payment_method === 'momo'
                ? Smartphone
                : staff.payment_method === 'bank'
                  ? Landmark
                  : Banknote;

            return (
              <Card key={staff.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-base font-bold text-ink">{staff.full_name}</h3>
                      {staff.is_active === 0 && <Badge tone="muted">Inactive</Badge>}
                      {staff.ssnit_exempt === 1 && <Badge tone="warning">SSNIT exempt</Badge>}
                    </div>
                    <p className="text-xs text-muted">
                      {staff.role_title} · Started {staff.start_date}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => openEdit(staff)}
                  >
                    Edit
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
                  <div>
                    <p className="text-muted">{PAY_TYPE_LABELS[staff.pay_type]}</p>
                    <p className="mt-0.5 text-sm font-bold text-ink">
                      {formatPesewas(staff.basic_pay_pesewas)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted">Allowances ({allowances.length})</p>
                    <p className="mt-0.5 text-sm font-bold text-ink">
                      {formatPesewas(totalAllowances)}
                    </p>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-muted">
                  <p className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{shopName}</span>
                    {linkedUser && (
                      <Badge tone="info" size="sm">
                        POS: {linkedUser.name}
                      </Badge>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <PayIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{formatPaymentDestination(staff)}</span>
                  </p>
                  {staff.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{staff.phone}</span>
                    </p>
                  )}
                  {staff.commission_enabled === 1 && (
                    <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                      <Percent className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Sales commission: {(staff.commission_rate_bps / 100).toFixed(2)}% of POS sales
                        {staff.commission_min_sales_pesewas > 0
                          ? ` (min ${formatPesewas(staff.commission_min_sales_pesewas)})`
                          : ''}
                      </span>
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Staff Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <form
            onSubmit={handleSave}
            className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5 dark:bg-slate-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">
                  {form.id ? 'Edit Staff Member' : 'Add Staff Member'}
                </h3>
                <p className="text-xs text-muted">
                  All changes to salary are saved in the payroll audit trail.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full p-2 text-muted hover:bg-black/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {/* Identity & Shop */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Full name *</label>
                  <input
                    required
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    placeholder="e.g. Ama Mensah"
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Job role</label>
                  <input
                    value={form.role_title}
                    onChange={(e) => setForm({ ...form, role_title: e.target.value })}
                    placeholder="e.g. Cashier, Storekeeper"
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Shop / branch</label>
                  <select
                    value={form.location_id}
                    onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  >
                    <option value="">Main Shop</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Start date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Phone (WhatsApp / MoMo)</label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="e.g. 0241234567"
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Link to POS account</label>
                  <select
                    value={form.user_id}
                    onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  >
                    <option value="">Not linked to a POS login</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-muted">
                    Pulls cashier sales for commission and lets them view only their own payslip.
                  </p>
                </div>
              </div>

              {/* Pay Setup */}
              <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                  Pay Setup
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink">Pay type</label>
                    <select
                      value={form.pay_type}
                      onChange={(e) => setForm({ ...form, pay_type: e.target.value as PayrollPayType })}
                      className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    >
                      <option value="monthly">Monthly salary</option>
                      <option value="weekly">Weekly rate</option>
                      <option value="daily">Daily rate</option>
                      <option value="per_shift">Per shift</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink">
                      Basic {form.pay_type === 'monthly' ? 'monthly salary' : PAY_TYPE_LABELS[form.pay_type].toLowerCase()} (GH₵) *
                    </label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.basic_pay_ghs}
                      onChange={(e) => setForm({ ...form, basic_pay_ghs: e.target.value })}
                      placeholder="e.g. 2000.00"
                      className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Allowances */}
                <div className="mt-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-ink">
                      Monthly Allowances (Transport, Meals, etc.)
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {ALLOWANCE_PRESETS.slice(0, 3).map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => addAllowanceRow(preset)}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-slate-200 dark:bg-slate-800"
                        >
                          + {preset}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => addAllowanceRow('')}
                        className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
                      >
                        + Custom
                      </button>
                    </div>
                  </div>
                  {form.allowances.length === 0 ? (
                    <p className="text-xs text-muted">No allowances added.</p>
                  ) : (
                    <div className="space-y-2">
                      {form.allowances.map((row, idx) => (
                        <div key={row.id} className="flex flex-wrap items-center gap-2">
                          <input
                            value={row.name}
                            onChange={(e) => {
                              const next = [...form.allowances];
                              next[idx] = { ...row, name: e.target.value };
                              setForm({ ...form, allowances: next });
                            }}
                            placeholder="Allowance name"
                            className="min-w-[120px] flex-1 rounded-lg border border-black/15 bg-white px-2.5 py-2 text-xs text-ink dark:border-white/15 dark:bg-slate-800"
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.amount_ghs}
                            onChange={(e) => {
                              const next = [...form.allowances];
                              next[idx] = { ...row, amount_ghs: e.target.value };
                              setForm({ ...form, allowances: next });
                            }}
                            placeholder="GH₵"
                            className="w-24 rounded-lg border border-black/15 bg-white px-2.5 py-2 text-xs text-ink dark:border-white/15 dark:bg-slate-800"
                          />
                          <label className="inline-flex items-center gap-1 text-[11px] text-muted">
                            <input
                              type="checkbox"
                              checked={row.is_taxable}
                              onChange={(e) => {
                                const next = [...form.allowances];
                                next[idx] = { ...row, is_taxable: e.target.checked };
                                setForm({ ...form, allowances: next });
                              }}
                            />
                            Taxable
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                allowances: form.allowances.filter((_, i) => i !== idx),
                              })
                            }
                            className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                            aria-label="Remove allowance"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* POS Sales Commission */}
                <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
                  <label className="flex items-center gap-2 text-xs font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={form.commission_enabled}
                      onChange={(e) => setForm({ ...form, commission_enabled: e.target.checked })}
                    />
                    Earn commission from POS sales (requires linked POS account)
                  </label>
                  {form.commission_enabled && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">Commission % of sales</label>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          max="100"
                          value={form.commission_rate_pct}
                          onChange={(e) => setForm({ ...form, commission_rate_pct: e.target.value })}
                          className="w-full rounded-lg border border-black/15 bg-white px-2.5 py-2 text-xs text-ink dark:border-white/15 dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">Min monthly sales (GH₵)</label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={form.commission_min_sales_ghs}
                          onChange={(e) => setForm({ ...form, commission_min_sales_ghs: e.target.value })}
                          className="w-full rounded-lg border border-black/15 bg-white px-2.5 py-2 text-xs text-ink dark:border-white/15 dark:bg-slate-800"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment Method Details */}
              <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                  How to pay this staff member
                </h4>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {(['momo', 'bank', 'cash'] as PayrollPaymentMethod[]).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setForm({ ...form, payment_method: method })}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                        form.payment_method === method
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-black/10 text-muted dark:border-white/10'
                      }`}
                    >
                      {method === 'momo' ? 'MoMo' : method === 'bank' ? 'Bank' : 'Cash'}
                    </button>
                  ))}
                </div>

                {form.payment_method === 'momo' && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select
                      value={form.momo_network}
                      onChange={(e) => setForm({ ...form, momo_network: e.target.value })}
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    >
                      <option value="MTN">MTN MoMo</option>
                      <option value="Telecel">Telecel Cash</option>
                      <option value="AirtelTigo">AT Money</option>
                    </select>
                    <input
                      value={form.momo_number}
                      onChange={(e) => setForm({ ...form, momo_number: e.target.value })}
                      placeholder="MoMo number"
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                    <input
                      value={form.momo_account_name}
                      onChange={(e) => setForm({ ...form, momo_account_name: e.target.value })}
                      placeholder="Registered name"
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                  </div>
                )}

                {form.payment_method === 'bank' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={form.bank_name}
                      onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                      placeholder="Bank name (e.g. GCB, Ecobank)"
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                    <input
                      value={form.bank_account_number}
                      onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })}
                      placeholder="Account number"
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                    <input
                      value={form.bank_account_name}
                      onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })}
                      placeholder="Account name"
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                    <input
                      value={form.bank_branch}
                      onChange={(e) => setForm({ ...form, bank_branch: e.target.value })}
                      placeholder="Branch (optional)"
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                  </div>
                )}

                {form.payment_method === 'cash' && (
                  <p className="text-xs text-muted">
                    Paid in cash at the shop and tracked on your monthly payment list.
                  </p>
                )}
              </div>

              {/* Statutory IDs */}
              <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                  SSNIT & Tax IDs (for monthly filing summary)
                </h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={form.ssnit_number}
                    onChange={(e) => setForm({ ...form, ssnit_number: e.target.value })}
                    placeholder="SSNIT Number (optional)"
                    className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                  <input
                    value={form.tin_number}
                    onChange={(e) => setForm({ ...form, tin_number: e.target.value })}
                    placeholder="Ghana Card / GRA TIN (optional)"
                    className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={form.ssnit_exempt}
                      onChange={(e) => setForm({ ...form, ssnit_exempt: e.target.checked })}
                    />
                    Exempt from SSNIT (e.g. casual or statutory exemption)
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    />
                    Active staff member
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {form.id ? 'Save Changes' : 'Add Staff'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
