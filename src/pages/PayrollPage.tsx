import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  Clock,
  FileText,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  WifiOff,
} from 'lucide-react';
import { Badge, Card, EmptyState, LoadingState } from '@/components/ui';
import { db, type LocalLocation, type LocalUser } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { formatPesewas, getMonthPeriodBounds, selectEffectiveTaxConfig } from '@/lib/payroll/calculator';
import {
  currentPayMonth,
  ensurePayrollBootstrap,
  getPayrollStaffForUser,
  listDeductionRepayments,
  listPayRuns,
  listPayrollAttendance,
  listPayrollDeductions,
  listPayrollStaff,
  listPayslipsForCashierUser,
  type PayrollActor,
} from '@/lib/payroll/store';
import type {
  LocalPayrollAdjustment,
  LocalPayrollAttendance,
  LocalPayrollDeduction,
  LocalPayrollDeductionRepayment,
  LocalPayrollRules,
  LocalPayrollRun,
  LocalPayrollRunItem,
  LocalPayrollStaff,
  LocalPayrollTaxConfig,
} from '@/lib/payroll/types';
import StaffManager from '@/components/payroll/StaffManager';
import DeductionsManager from '@/components/payroll/DeductionsManager';
import AttendancePanel from '@/components/payroll/AttendancePanel';
import PayRunFlow from '@/components/payroll/PayRunFlow';
import ComplianceReports from '@/components/payroll/ComplianceReports';
import PayrollSettingsPanel from '@/components/payroll/PayrollSettingsPanel';
import { PayslipCard } from '@/components/payroll/PayslipModal';

type OwnerTab = 'payrun' | 'staff' | 'attendance' | 'deductions' | 'reports' | 'settings';
type CashierTab = 'mypayslips' | 'myattendance';

export default function PayrollPage() {
  const { currentUser, currentStore } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const storeId = currentStore?.id || '';

  const [loading, setLoading] = useState(true);
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('payrun');
  const [cashierTab, setCashierTab] = useState<CashierTab>('mypayslips');
  const [payMonth, setPayMonth] = useState(() => currentPayMonth());
  const [refreshTick, setRefreshTick] = useState(0);
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );

  // Owner data
  const [staffList, setStaffList] = useState<LocalPayrollStaff[]>([]);
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [deductions, setDeductions] = useState<LocalPayrollDeduction[]>([]);
  const [repayments, setRepayments] = useState<LocalPayrollDeductionRepayment[]>([]);
  const [attendance, setAttendance] = useState<LocalPayrollAttendance[]>([]);
  const [runs, setRuns] = useState<LocalPayrollRun[]>([]);
  const [taxConfigs, setTaxConfigs] = useState<LocalPayrollTaxConfig[]>([]);
  const [rules, setRules] = useState<LocalPayrollRules | null>(null);

  // Cashier self-service data (strictly scoped to currentUser.id only)
  const [ownStaff, setOwnStaff] = useState<LocalPayrollStaff | null>(null);
  const [ownPayslips, setOwnPayslips] = useState<
    Array<{ item: LocalPayrollRunItem; runStatus: LocalPayrollRun['status']; adjustments: LocalPayrollAdjustment[] }>
  >([]);
  const [selectedOwnPayslipId, setSelectedOwnPayslipId] = useState<string | null>(null);

  const actor: PayrollActor = useMemo(
    () => ({
      id: currentUser?.id || 'unknown',
      name: currentUser?.name || (isOwner ? 'Owner' : 'Staff'),
    }),
    [currentUser?.id, currentUser?.name, isOwner]
  );

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!storeId || !currentUser?.id) return;
    try {
      if (isOwner) {
        const [boot, staff, locs, storeUsers, deds, repays, att, payRuns] = await Promise.all([
          ensurePayrollBootstrap(storeId),
          listPayrollStaff(storeId, true),
          db.locations.where('store_id').equals(storeId).and((l) => l.is_active === 1).toArray(),
          db.users.where('store_id').equals(storeId).and((u) => u.is_active === 1).toArray(),
          listPayrollDeductions(storeId),
          listDeductionRepayments(storeId),
          listPayrollAttendance(storeId),
          listPayRuns(storeId),
        ]);
        setTaxConfigs(boot.taxConfigs);
        setRules(boot.rules);
        setStaffList(staff);
        setLocations(locs);
        setUsers(storeUsers);
        setDeductions(deds);
        setRepayments(repays);
        setAttendance(att);
        setRuns(payRuns);
        setRefreshTick((v) => v + 1);
      } else {
        // Strict role isolation: cashiers ONLY load their own linked staff profile, own attendance, and own payslips.
        const [staff, slips, att] = await Promise.all([
          getPayrollStaffForUser(storeId, currentUser.id),
          listPayslipsForCashierUser(storeId, currentUser.id),
          listPayrollAttendance(storeId),
        ]);
        setOwnStaff(staff);
        setOwnPayslips(slips);
        setAttendance(staff ? att.filter((a) => a.staff_id === staff.id) : []);
        if (slips.length > 0 && !selectedOwnPayslipId) {
          setSelectedOwnPayslipId(slips[0].item.id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [storeId, currentUser?.id, isOwner, selectedOwnPayslipId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeTaxConfig = useMemo(() => {
    const { periodEnd } = getMonthPeriodBounds(payMonth);
    return selectEffectiveTaxConfig(taxConfigs, periodEnd);
  }, [taxConfigs, payMonth]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <LoadingState message="Loading payroll…" />
      </div>
    );
  }

  // CASHIER VIEW — strictly own payslips & own clock in/out (zero access to other salaries)
  if (!isOwner) {
    const selectedSlip = ownPayslips.find((s) => s.item.id === selectedOwnPayslipId) || ownPayslips[0] || null;
    return (
      <div className="h-full overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
                <Wallet className="h-6 w-6 text-primary" />
                My Pay & Shifts
              </h1>
              <p className="text-xs text-muted">
                Private view for {currentUser?.name}. Only your own payslips and shifts are visible here.
              </p>
            </div>
            {offline && (
              <Badge tone="warning">
                <WifiOff className="h-3 w-3" /> Working offline
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCashierTab('mypayslips')}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
                cashierTab === 'mypayslips'
                  ? 'bg-primary text-white'
                  : 'bg-white text-muted shadow-xs dark:bg-slate-900'
              }`}
            >
              My Payslips ({ownPayslips.length})
            </button>
            <button
              type="button"
              onClick={() => setCashierTab('myattendance')}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
                cashierTab === 'myattendance'
                  ? 'bg-primary text-white'
                  : 'bg-white text-muted shadow-xs dark:bg-slate-900'
              }`}
            >
              Clock In / Out
            </button>
          </div>

          {cashierTab === 'myattendance' ? (
            <AttendancePanel
              storeId={storeId}
              payMonth={payMonth}
              onChangeMonth={setPayMonth}
              staffList={ownStaff ? [ownStaff] : []}
              attendance={attendance}
              actor={actor}
              selfOnlyStaff={ownStaff}
              onRefresh={loadData}
            />
          ) : ownPayslips.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-10 w-10 text-muted" />}
              title="No payslips available yet"
              description={
                ownStaff
                  ? 'Your approved monthly payslips will appear here as soon as the store owner approves payroll.'
                  : 'Ask the store owner to link your POS login to your staff profile in Payroll.'
              }
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {ownPayslips.map((entry) => (
                  <button
                    key={entry.item.id}
                    type="button"
                    onClick={() => setSelectedOwnPayslipId(entry.item.id)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      selectedSlip?.item.id === entry.item.id
                        ? 'bg-primary text-white'
                        : 'bg-white text-muted shadow-xs dark:bg-slate-900'
                    }`}
                  >
                    {entry.item.pay_month} · {formatPesewas(entry.item.net_pay_pesewas)}
                  </button>
                ))}
              </div>
              {selectedSlip && (
                <Card>
                  <PayslipCard
                    store={currentStore}
                    item={selectedSlip.item}
                    adjustments={selectedSlip.adjustments}
                    staffPhone={ownStaff?.phone || currentUser?.phone || ''}
                  />
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // OWNER FULL PAYROLL WORKSPACE
  const ownerTabs: Array<{ id: OwnerTab; label: string; icon: typeof Calculator }> = [
    { id: 'payrun', label: 'Pay Run', icon: Calculator },
    { id: 'staff', label: `Staff (${staffList.filter((s) => s.is_active === 1).length})`, icon: Users },
    { id: 'attendance', label: 'Shifts', icon: Clock },
    { id: 'deductions', label: 'Loans & Fines', icon: ReceiptText },
    { id: 'reports', label: 'Filing & Reports', icon: ShieldCheck },
    { id: 'settings', label: 'Tax & Rules', icon: Settings },
  ];

  return (
    <div className="h-full overflow-y-auto px-3 py-4 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
              <Wallet className="h-6 w-6 text-primary" />
              Payroll
            </h1>
            <p className="text-xs text-muted">
              Pay staff accurately, track shop wage costs, and prepare monthly GRA PAYE & SSNIT summaries — fully offline.
            </p>
          </div>
          {offline && (
            <Badge tone="warning">
              <WifiOff className="h-3.5 w-3.5" /> Offline mode — saves locally & syncs later
            </Badge>
          )}
        </div>

        {/* Scrollable Mobile-First Tab Bar */}
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {ownerTabs.map((tab) => {
            const Icon = tab.icon;
            const active = ownerTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setOwnerTab(tab.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-primary text-white shadow-xs'
                    : 'bg-white text-muted shadow-xs hover:text-ink dark:bg-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {ownerTab === 'payrun' && rules && (
          <PayRunFlow
            store={currentStore}
            storeId={storeId}
            payMonth={payMonth}
            onChangeMonth={setPayMonth}
            runs={runs}
            staffList={staffList}
            rules={rules}
            activeTaxConfig={activeTaxConfig}
            actor={actor}
            onRefresh={loadData}
            onOpenSettings={() => setOwnerTab('settings')}
          />
        )}

        {ownerTab === 'staff' && (
          <StaffManager
            storeId={storeId}
            staffList={staffList}
            locations={locations}
            users={users}
            actor={actor}
            onRefresh={loadData}
          />
        )}

        {ownerTab === 'attendance' && (
          <AttendancePanel
            storeId={storeId}
            payMonth={payMonth}
            onChangeMonth={setPayMonth}
            staffList={staffList}
            attendance={attendance}
            actor={actor}
            onRefresh={loadData}
          />
        )}

        {ownerTab === 'deductions' && (
          <DeductionsManager
            storeId={storeId}
            staffList={staffList}
            deductions={deductions}
            repayments={repayments}
            actor={actor}
            onRefresh={loadData}
          />
        )}

        {ownerTab === 'reports' && (
          <ComplianceReports
            store={currentStore}
            storeId={storeId}
            payMonth={payMonth}
            onChangeMonth={setPayMonth}
            refreshTick={refreshTick}
          />
        )}

        {ownerTab === 'settings' && rules && (
          <PayrollSettingsPanel
            storeId={storeId}
            taxConfigs={taxConfigs}
            rules={rules}
            actor={actor}
            onRefresh={loadData}
          />
        )}
      </div>
    </div>
  );
}
