import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { ghsToPesewas, pesewasToGhs } from '@/lib/payroll/calculator';
import {
  markTaxConfigVerified,
  savePayrollRules,
  saveTaxConfig,
  todayDateOnly,
  type PayrollActor,
} from '@/lib/payroll/store';
import { ACCOUNTANT_VERIFY_NOTICE, parsePayeBands } from '@/lib/payroll/taxDefaults';
import type {
  LocalPayrollRules,
  LocalPayrollTaxConfig,
  PayeTaxBand,
  PayrollAbsenceMode,
  PayrollSsnitBasis,
} from '@/lib/payroll/types';

interface PayrollSettingsPanelProps {
  storeId: string;
  taxConfigs: LocalPayrollTaxConfig[];
  rules: LocalPayrollRules;
  actor: PayrollActor;
  onRefresh: () => Promise<void>;
}

interface EditableBand {
  label: string;
  width_ghs: string; // empty = top/unlimited band
  rate_pct: string;
}

export default function PayrollSettingsPanel({
  storeId,
  taxConfigs,
  rules,
  actor,
  onRefresh,
}: PayrollSettingsPanelProps) {
  const [selectedId, setSelectedId] = useState<string>(taxConfigs[0]?.id || 'new');
  const selectedConfig = taxConfigs.find((c) => c.id === selectedId) || taxConfigs[0];

  const [name, setName] = useState(selectedConfig?.name || 'Ghana PAYE & SSNIT Schedule');
  const [effectiveFrom, setEffectiveFrom] = useState(selectedConfig?.effective_from || todayDateOnly());
  const [taxFreeGhs, setTaxFreeGhs] = useState(
    String(pesewasToGhs(selectedConfig?.tax_free_threshold_pesewas || 49_000))
  );
  const [ssnitEmpPct, setSsnitEmpPct] = useState(
    String((selectedConfig?.ssnit_employee_rate_bps ?? 550) / 100)
  );
  const [ssnitErPct, setSsnitErPct] = useState(
    String((selectedConfig?.ssnit_employer_rate_bps ?? 1300) / 100)
  );
  const [ssnitCapGhs, setSsnitCapGhs] = useState(
    String(pesewasToGhs(selectedConfig?.ssnit_max_insurable_pesewas ?? 5_200_000))
  );
  const [ssnitBasis, setSsnitBasis] = useState<PayrollSsnitBasis>(
    selectedConfig?.ssnit_basis || 'basic_only'
  );
  const [bands, setBands] = useState<EditableBand[]>(() =>
    parsePayeBands(selectedConfig?.paye_bands_json || '[]').map((b) => ({
      label: b.label,
      width_ghs: b.width_pesewas === null ? '' : String(pesewasToGhs(b.width_pesewas)),
      rate_pct: String(b.rate_bps / 100),
    }))
  );

  // Shop rules state
  const [hoursPerDay, setHoursPerDay] = useState(String(rules.standard_hours_per_day));
  const [daysPerMonth, setDaysPerMonth] = useState(String(rules.working_days_per_month));
  const [otMultiplier, setOtMultiplier] = useState(String(rules.overtime_multiplier_bps / 10_000));
  const [absenceMode, setAbsenceMode] = useState<PayrollAbsenceMode>(rules.absence_deduction_mode);
  const [absenceFixedGhs, setAbsenceFixedGhs] = useState(
    String(pesewasToGhs(rules.absence_fixed_deduction_pesewas))
  );
  const [defaultCommPct, setDefaultCommPct] = useState(String(rules.default_commission_rate_bps / 100));
  const [postToExpenses, setPostToExpenses] = useState(rules.post_to_expenses === 1);
  const [postToCashbook, setPostToCashbook] = useState(rules.post_to_cashbook === 1);
  const [filingDueDay, setFilingDueDay] = useState(String(rules.filing_due_day));

  const [savingTax, setSavingTax] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadConfigIntoForm = (cfg: LocalPayrollTaxConfig | null) => {
    if (!cfg) {
      setSelectedId('new');
      setName(`Ghana PAYE & SSNIT (${todayDateOnly().slice(0, 4)})`);
      setEffectiveFrom(todayDateOnly());
      return;
    }
    setSelectedId(cfg.id);
    setName(cfg.name);
    setEffectiveFrom(cfg.effective_from);
    setTaxFreeGhs(String(pesewasToGhs(cfg.tax_free_threshold_pesewas)));
    setSsnitEmpPct(String(cfg.ssnit_employee_rate_bps / 100));
    setSsnitErPct(String(cfg.ssnit_employer_rate_bps / 100));
    setSsnitCapGhs(String(pesewasToGhs(cfg.ssnit_max_insurable_pesewas)));
    setSsnitBasis(cfg.ssnit_basis);
    setBands(
      parsePayeBands(cfg.paye_bands_json).map((b) => ({
        label: b.label,
        width_ghs: b.width_pesewas === null ? '' : String(pesewasToGhs(b.width_pesewas)),
        rate_pct: String(b.rate_bps / 100),
      }))
    );
  };

  const handleSaveTax = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSavingTax(true);
    try {
      const normalizedBands: PayeTaxBand[] = bands.map((b, idx) => ({
        label: b.label.trim() || `Band ${idx + 1}`,
        width_pesewas: b.width_ghs.trim() === '' ? null : ghsToPesewas(b.width_ghs),
        rate_bps: Math.max(0, Math.round((Number(b.rate_pct) || 0) * 100)),
      }));
      const saved = await saveTaxConfig(
        storeId,
        {
          id: selectedId === 'new' ? undefined : selectedId,
          name,
          effective_from: effectiveFrom,
          tax_free_threshold_pesewas: ghsToPesewas(taxFreeGhs),
          paye_bands_json: JSON.stringify(normalizedBands),
          ssnit_employee_rate_bps: Math.round((Number(ssnitEmpPct) || 0) * 100),
          ssnit_employer_rate_bps: Math.round((Number(ssnitErPct) || 0) * 100),
          ssnit_max_insurable_pesewas: ghsToPesewas(ssnitCapGhs),
          ssnit_min_insurable_pesewas: 0,
          ssnit_basis: ssnitBasis,
          verified_with_accountant: selectedId === 'new' ? 0 : (selectedConfig?.verified_with_accountant || 0),
          verified_at: selectedId === 'new' ? null : (selectedConfig?.verified_at || null),
          notes: ACCOUNTANT_VERIFY_NOTICE,
          is_active: 1,
        },
        actor
      );
      setSelectedId(saved.id);
      await onRefresh();
      setMessage('Statutory tax & SSNIT schedule saved and logged to audit trail.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save statutory settings.');
    } finally {
      setSavingTax(false);
    }
  };

  const handleVerify = async () => {
    if (!selectedConfig || selectedId === 'new') return;
    await markTaxConfigVerified(storeId, selectedConfig.id, actor);
    await onRefresh();
    setMessage('Marked as verified with your accountant.');
  };

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSavingRules(true);
    try {
      await savePayrollRules(
        storeId,
        {
          standard_hours_per_day: Number(hoursPerDay) || 8,
          working_days_per_month: Math.round(Number(daysPerMonth) || 26),
          overtime_multiplier_bps: Math.round((Number(otMultiplier) || 1.5) * 10_000),
          absence_deduction_mode: absenceMode,
          absence_fixed_deduction_pesewas: ghsToPesewas(absenceFixedGhs),
          default_commission_rate_bps: Math.round((Number(defaultCommPct) || 0) * 100),
          post_to_expenses: postToExpenses ? 1 : 0,
          post_to_cashbook: postToCashbook ? 1 : 0,
          filing_due_day: Math.round(Number(filingDueDay) || 15),
        },
        actor
      );
      await onRefresh();
      setMessage('Shop overtime, absence, and bookkeeping rules saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rules.');
    } finally {
      setSavingRules(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      {/* Section 1: Ghana Statutory PAYE & SSNIT Settings */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink">Ghana Statutory Deductions (PAYE & SSNIT)</h3>
            <p className="text-xs text-muted">
              Rates are stored as editable settings with effective dates — never hard-coded.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => loadConfigIntoForm(null)}
          >
            New Effective Date
          </Button>
        </div>

        {/* Accountant verification banner */}
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold">Verify with your accountant</p>
                <p>{ACCOUNTANT_VERIFY_NOTICE}</p>
              </div>
            </div>
            {selectedConfig && selectedId !== 'new' && (
              selectedConfig.verified_with_accountant === 1 ? (
                <Badge tone="success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                </Badge>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void handleVerify()}>
                  Mark as Verified
                </Button>
              )
            )}
          </div>
        </div>

        {/* Effective-dated schedule selector */}
        {taxConfigs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {taxConfigs.map((cfg) => (
              <button
                key={cfg.id}
                type="button"
                onClick={() => loadConfigIntoForm(cfg)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  selectedId === cfg.id
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 text-muted dark:bg-slate-800'
                }`}
              >
                From {cfg.effective_from} {cfg.verified_with_accountant === 1 ? '✓' : '(Verify)'}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSaveTax} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Schedule name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Effective from date</label>
              <input
                type="date"
                required
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
            </div>
          </div>

          {/* SSNIT settings */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">SSNIT employee %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={ssnitEmpPct}
                onChange={(e) => setSsnitEmpPct(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">Deducted from staff (default 5.5%)</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">SSNIT employer %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={ssnitErPct}
                onChange={(e) => setSsnitErPct(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">Paid by shop (default 13%)</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">SSNIT earnings cap (GH₵/mo)</label>
              <input
                type="number"
                step="1"
                min="0"
                value={ssnitCapGhs}
                onChange={(e) => setSsnitCapGhs(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">0 = no cap. Check yearly SSNIT cap.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Monthly tax-free amount (GH₵)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={taxFreeGhs}
                onChange={(e) => {
                  setTaxFreeGhs(e.target.value);
                  if (bands.length > 0 && Number(bands[0].rate_pct) === 0) {
                    const next = [...bands];
                    next[0] = { ...next[0], width_ghs: e.target.value };
                    setBands(next);
                  }
                }}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">0% PAYE on first amount</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-ink">SSNIT applies to</label>
            <select
              value={ssnitBasis}
              onChange={(e) => setSsnitBasis(e.target.value as PayrollSsnitBasis)}
              className="w-full max-w-sm rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
            >
              <option value="basic_only">Basic salary only (standard Ghana Act 766)</option>
              <option value="gross_cash">Total gross cash pay (basic + allowances)</option>
            </select>
          </div>

          {/* Editable PAYE Bands */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wide text-muted">
                Monthly PAYE Income Tax Bands (GRA)
              </label>
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() =>
                  setBands([...bands, { label: `Band ${bands.length + 1}`, width_ghs: '', rate_pct: '0' }])
                }
              >
                Add Band
              </Button>
            </div>
            <div className="space-y-2">
              {bands.map((band, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
                  <input
                    value={band.label}
                    onChange={(e) => {
                      const next = [...bands];
                      next[idx] = { ...band, label: e.target.value };
                      setBands(next);
                    }}
                    placeholder="Band label"
                    className="min-w-[140px] flex-1 rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-xs text-ink dark:border-white/15 dark:bg-slate-900"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted">Width GH₵</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={band.width_ghs}
                      onChange={(e) => {
                        const next = [...bands];
                        next[idx] = { ...band, width_ghs: e.target.value };
                        setBands(next);
                        if (idx === 0 && Number(band.rate_pct) === 0) setTaxFreeGhs(e.target.value);
                      }}
                      placeholder="Rest"
                      className="w-24 rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs text-ink dark:border-white/15 dark:bg-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted">Rate %</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      value={band.rate_pct}
                      onChange={(e) => {
                        const next = [...bands];
                        next[idx] = { ...band, rate_pct: e.target.value };
                        setBands(next);
                      }}
                      className="w-16 rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs text-ink dark:border-white/15 dark:bg-slate-900"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setBands(bands.filter((_, i) => i !== idx))}
                    className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                    aria-label="Remove band"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted">
              Leave Width blank on the last band to mean "all remaining income above previous bands".
            </p>
          </div>

          <Button type="submit" loading={savingTax} leftIcon={<Save className="h-4 w-4" />}>
            Save Statutory Rates
          </Button>
        </form>
      </Card>

      {/* Section 2: Shop Overtime, Absence & Bookkeeping Rules */}
      <Card className="space-y-4">
        <div>
          <h3 className="text-base font-bold text-ink">Overtime, Absence & Bookkeeping Rules</h3>
          <p className="text-xs text-muted">
            Set these rules once. Every pay run uses them automatically.
          </p>
        </div>

        <form onSubmit={handleSaveRules} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Normal hours per shift/day</label>
              <input
                type="number"
                step="0.5"
                min="1"
                max="24"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">Hours beyond this count as overtime.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Working days per month</label>
              <input
                type="number"
                min="1"
                max="31"
                value={daysPerMonth}
                onChange={(e) => setDaysPerMonth(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">26 for Mon–Sat, 22 for Mon–Fri.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Overtime pay multiplier</label>
              <input
                type="number"
                step="0.1"
                min="1"
                max="5"
                value={otMultiplier}
                onChange={(e) => setOtMultiplier(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">e.g. 1.5 = time-and-a-half.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Unpaid absence rule (monthly staff)</label>
              <select
                value={absenceMode}
                onChange={(e) => setAbsenceMode(e.target.value as PayrollAbsenceMode)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              >
                <option value="daily_prorata">Deduct daily salary rate (Basic ÷ working days)</option>
                <option value="fixed_pesewas">Deduct a fixed amount per absent day</option>
                <option value="none">Do not deduct for absences automatically</option>
              </select>
            </div>
            {absenceMode === 'fixed_pesewas' && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Fixed deduction per absent day (GH₵)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={absenceFixedGhs}
                  onChange={(e) => setAbsenceFixedGhs(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Default cashier commission %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={defaultCommPct}
                onChange={(e) => setDefaultCommPct(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink">Monthly filing due day</label>
              <input
                type="number"
                min="1"
                max="28"
                value={filingDueDay}
                onChange={(e) => setFilingDueDay(e.target.value)}
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
              />
              <p className="mt-0.5 text-[11px] text-muted">Ghana GRA & SSNIT: 15th of following month.</p>
            </div>
          </div>

          <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
            <label className="flex items-start gap-2 text-ink">
              <input
                type="checkbox"
                checked={postToExpenses}
                onChange={(e) => setPostToExpenses(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Automatically post locked pay runs to <strong>Expenses (Salaries)</strong> so Profit reports include staff wages.
              </span>
            </label>
            <label className="flex items-start gap-2 text-ink">
              <input
                type="checkbox"
                checked={postToCashbook}
                onChange={(e) => setPostToCashbook(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Automatically post locked pay runs to <strong>Cash Book (Salaries)</strong>.
              </span>
            </label>
          </div>

          <Button type="submit" loading={savingRules} leftIcon={<Save className="h-4 w-4" />}>
            Save Shop Rules
          </Button>
        </form>
      </Card>
    </div>
  );
}
