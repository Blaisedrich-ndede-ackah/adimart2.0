import { useMemo, useState } from 'react';
import { Clock, LogIn, LogOut, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import {
  clockInStaff,
  clockOutStaff,
  deleteAttendanceRecord,
  saveAttendanceRecord,
  summarizeMonthlyAttendance,
  todayDateOnly,
  type PayrollActor,
} from '@/lib/payroll/store';
import type {
  LocalPayrollAttendance,
  LocalPayrollStaff,
  PayrollAttendanceStatus,
} from '@/lib/payroll/types';

interface AttendancePanelProps {
  storeId: string;
  payMonth: string;
  onChangeMonth: (month: string) => void;
  staffList: LocalPayrollStaff[];
  attendance: LocalPayrollAttendance[];
  actor: PayrollActor;
  /** When true, locks view to a single cashier's own clock-in/out & shift history. */
  selfOnlyStaff?: LocalPayrollStaff | null;
  onRefresh: () => Promise<void>;
}

const STATUS_LABELS: Record<PayrollAttendanceStatus, string> = {
  present: 'Present',
  half_day: 'Half day',
  absent: 'Absent (unpaid)',
  paid_leave: 'Paid leave',
  unpaid_leave: 'Unpaid leave',
};

function formatTimeShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AttendancePanel({
  storeId,
  payMonth,
  onChangeMonth,
  staffList,
  attendance,
  actor,
  selfOnlyStaff,
  onRefresh,
}: AttendancePanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualStaffId, setManualStaffId] = useState('');
  const [manualDate, setManualDate] = useState(() => todayDateOnly());
  const [manualStatus, setManualStatus] = useState<PayrollAttendanceStatus>('present');
  const [manualHours, setManualHours] = useState('8');
  const [manualOtHours, setManualOtHours] = useState('0');
  const [manualNotes, setManualNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const visibleStaff = useMemo(
    () => (selfOnlyStaff ? [selfOnlyStaff] : staffList.filter((s) => s.is_active === 1)),
    [selfOnlyStaff, staffList]
  );

  const staffMap = useMemo(() => new Map(staffList.map((s) => [s.id, s])), [staffList]);
  const today = todayDateOnly();

  const visibleLogs = useMemo(() => {
    const allowed = new Set(visibleStaff.map((s) => s.id));
    return attendance.filter((a) => allowed.has(a.staff_id) && a.work_date.startsWith(payMonth));
  }, [attendance, visibleStaff, payMonth]);

  const handleClockIn = async (staff: LocalPayrollStaff) => {
    setBusyId(staff.id);
    try {
      await clockInStaff(storeId, staff, actor);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleClockOut = async (attId: string) => {
    setBusyId(attId);
    try {
      await clockOutStaff(storeId, attId, actor);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = staffMap.get(manualStaffId);
    if (!s) return;
    setSaving(true);
    try {
      await saveAttendanceRecord(
        storeId,
        {
          staff_id: s.id,
          location_id: s.location_id,
          work_date: manualDate,
          worked_minutes: manualStatus === 'absent' || manualStatus === 'unpaid_leave'
            ? 0
            : Math.round((Number(manualHours) || 0) * 60),
          overtime_minutes: Math.round((Number(manualOtHours) || 0) * 60),
          status: manualStatus,
          notes: manualNotes,
        },
        actor
      );
      await onRefresh();
      setManualOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted">Month</label>
          <input
            type="month"
            value={payMonth}
            onChange={(e) => onChangeMonth(e.target.value)}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-ink dark:border-white/15 dark:bg-slate-900"
          />
        </div>
        {!selfOnlyStaff && visibleStaff.length > 0 && (
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setManualStaffId(visibleStaff[0]?.id || '');
              setManualDate(todayDateOnly());
              setManualStatus('present');
              setManualHours('8');
              setManualOtHours('0');
              setManualNotes('');
              setManualOpen(true);
            }}
          >
            Record Shift / Absence
          </Button>
        )}
      </div>

      {/* Offline Clock In / Out Cards */}
      {visibleStaff.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-10 w-10 text-muted" />}
          title="No staff available"
          description={
            selfOnlyStaff === null
              ? 'Ask the store owner to link your POS account to a staff payroll profile so you can clock in and view your payslips.'
              : 'Add staff members first so they can clock in and out offline.'
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleStaff.map((staff) => {
            const openShift = attendance.find(
              (a) => a.staff_id === staff.id && a.work_date === today && a.clock_in_at && !a.clock_out_at
            );
            const summary = summarizeMonthlyAttendance(attendance, staff.id, payMonth);

            return (
              <Card key={staff.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-ink">{staff.full_name}</h3>
                    <p className="text-xs text-muted">{staff.role_title}</p>
                  </div>
                  {openShift ? (
                    <Badge tone="success" dot>
                      Clocked in {formatTimeShort(openShift.clock_in_at)}
                    </Badge>
                  ) : (
                    <Badge tone="muted">Off shift</Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center text-xs dark:bg-slate-800/60">
                  <div>
                    <p className="text-muted">Days</p>
                    <p className="font-bold text-ink">{summary.daysWorked}</p>
                  </div>
                  <div>
                    <p className="text-muted">Hours</p>
                    <p className="font-bold text-ink">{(summary.workedMinutes / 60).toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-muted">Overtime</p>
                    <p className="font-bold text-emerald-700 dark:text-emerald-400">
                      {(summary.overtimeMinutes / 60).toFixed(1)}h
                    </p>
                  </div>
                </div>

                {openShift ? (
                  <Button
                    block
                    variant="danger"
                    loading={busyId === openShift.id}
                    leftIcon={<LogOut className="h-4 w-4" />}
                    onClick={() => void handleClockOut(openShift.id)}
                  >
                    Clock Out (Saves Offline)
                  </Button>
                ) : (
                  <Button
                    block
                    variant="success"
                    loading={busyId === staff.id}
                    leftIcon={<LogIn className="h-4 w-4" />}
                    onClick={() => void handleClockIn(staff)}
                  >
                    Clock In Now (Works Offline)
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Attendance Log for Month */}
      {visibleLogs.length > 0 && (
        <Card className="space-y-2.5">
          <h4 className="text-sm font-bold text-ink">
            Shift & Attendance Log ({payMonth})
          </h4>
          <div className="divide-y divide-black/10 dark:divide-white/10">
            {visibleLogs.map((log) => {
              const s = staffMap.get(log.staff_id);
              return (
                <div key={log.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-ink">{s?.full_name || 'Staff'}</span>
                      <Badge
                        tone={
                          log.status === 'present' || log.status === 'paid_leave'
                            ? 'success'
                            : log.status === 'half_day'
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {STATUS_LABELS[log.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted">
                      {log.work_date}
                      {log.clock_in_at ? ` · In ${formatTimeShort(log.clock_in_at)}` : ''}
                      {log.clock_out_at ? ` · Out ${formatTimeShort(log.clock_out_at)}` : ''}
                      {log.worked_minutes > 0 ? ` · ${(log.worked_minutes / 60).toFixed(1)}h` : ''}
                      {log.overtime_minutes > 0 ? ` (+${(log.overtime_minutes / 60).toFixed(1)}h OT)` : ''}
                    </p>
                    {log.notes && <p className="text-xs text-muted">{log.notes}</p>}
                  </div>
                  {!selfOnlyStaff && (
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteAttendanceRecord(storeId, log.id);
                        await onRefresh();
                      }}
                      className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"
                      aria-label="Delete attendance log"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Owner Manual Attendance Modal */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <form
            onSubmit={handleSaveManual}
            className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5 dark:bg-slate-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Record Shift or Absence</h3>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="rounded-full p-2 text-muted hover:bg-black/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Staff member</label>
                <select
                  value={manualStaffId}
                  onChange={(e) => setManualStaffId(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                >
                  {visibleStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Date</label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink">Status</label>
                  <select
                    value={manualStatus}
                    onChange={(e) => setManualStatus(e.target.value as PayrollAttendanceStatus)}
                    className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                  >
                    {Object.entries(STATUS_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {manualStatus !== 'absent' && manualStatus !== 'unpaid_leave' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink">Hours worked</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="24"
                      value={manualHours}
                      onChange={(e) => setManualHours(e.target.value)}
                      className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink">Overtime hours</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="16"
                      value={manualOtHours}
                      onChange={(e) => setManualOtHours(e.target.value)}
                      className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink">Notes (optional)</label>
                <input
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="e.g. Stayed late for stock count"
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink dark:border-white/15 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setManualOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save Shift
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
