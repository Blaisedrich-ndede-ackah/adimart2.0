import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquareText,
  ShieldOff,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import {
  getDebtReminderHistory,
  isReminderDue,
  listDebtReminderCandidates,
  resolveDebtReminderSettings,
  sendDebtRemindersForStore,
  type DebtReminderCandidate,
} from '@/lib/debtReminders';
import type { LocalDebtReminder } from '@/lib/dexie';
import { triggerPushSync } from '@/lib/sync';

interface DebtRemindersPanelProps {
  onOpenSettings?: () => void;
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Owner panel for the automated debt-reminder chase.
 *
 * Shows who owes money, who is due a reminder, and lets the owner send a
 * round of reminders immediately instead of waiting for the next
 * automatic sweep.
 */
export default function DebtRemindersPanel({ onOpenSettings }: DebtRemindersPanelProps) {
  const { currentStore, currentUser } = useAuthStore();
  const money = useFormatMoney();
  const t = useT();
  const [candidates, setCandidates] = useState<DebtReminderCandidate[]>([]);
  const [history, setHistory] = useState<LocalDebtReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const isOwner = currentUser?.role === 'owner';

  const load = useCallback(async () => {
    if (!currentStore?.id) return;
    setError('');
    try {
      const settings = resolveDebtReminderSettings(currentStore);
      const [all, reminders] = await Promise.all([
        listDebtReminderCandidates(currentStore.id, settings, { includeOptedOut: true }),
        getDebtReminderHistory(currentStore.id, 8),
      ]);
      setCandidates(all);
      setHistory(reminders);
    } catch (loadError) {
      console.error('[DebtReminders] Could not load reminder panel:', loadError);
      setError('Could not load the reminder list.');
    } finally {
      setLoading(false);
    }
  }, [currentStore]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSendNow = async () => {
    if (!currentStore) return;
    setSending(true);
    setError('');
    setStatus('');
    try {
      const result = await sendDebtRemindersForStore(currentStore, { force: true });
      setStatus(result.reason);
      await load();
      void triggerPushSync('debt-reminders');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send reminders.');
    } finally {
      setSending(false);
    }
  };

  if (!isOwner) return null;

  const settings = resolveDebtReminderSettings(currentStore);
  const optedOutCount = candidates.filter((candidate) => (candidate.customer.debt_reminder_opt_out ?? 0) === 1).length;
  const totalOwed = candidates.reduce((total, candidate) => total + candidate.balance, 0);
  const dueCount = candidates.filter(
    (candidate) =>
      (candidate.customer.debt_reminder_opt_out ?? 0) !== 1 &&
      isReminderDue(candidate, settings.intervalDays)
  ).length;

  return (
    <section className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="rounded-lg bg-amber-100 p-1.5">
          <BellRing className="h-4 w-4 text-amber-600" />
        </div>
        <h2 className="font-semibold text-gray-900">{t('debtReminders.title')}</h2>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            settings.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {settings.enabled ? t('debtReminders.automaticOn') : t('debtReminders.automaticOff')}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Chase outstanding customer credit by SMS. Adimat sends one reminder per customer every{' '}
        {settings.intervalDays} day{settings.intervalDays === 1 ? '' : 's'}
        {settings.minBalance > 0 ? `, and only for balances of ${money(settings.minBalance)} or more` : ''}.
      </p>

      {error && (
        <p role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {status && (
        <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{status}</span>
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customers owing</p>
          <p className="mt-0.5 text-lg font-bold text-gray-900">{loading ? '…' : candidates.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Due a reminder</p>
          <p className="mt-0.5 text-lg font-bold text-gray-900">{loading ? '…' : dueCount}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Total owed</p>
          <p className="mt-0.5 text-lg font-bold text-amber-800">{loading ? '…' : money(totalOwed)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSendNow()}
          disabled={sending || candidates.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 disabled:hover:bg-amber-600 transition-all"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
          {sending ? 'Sending…' : t('debtReminders.sendNow')}
        </button>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-700 touch-target"
          >
            Reminder settings
          </button>
        )}
        {optedOutCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
            <ShieldOff className="h-3.5 w-3.5" />
            {optedOutCount} customer{optedOutCount === 1 ? '' : 's'} opted out
          </span>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            {t('debtReminders.whoOwes')}
          </p>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-white">
            {candidates.slice(0, 8).map((candidate) => {
              const optedOut = (candidate.customer.debt_reminder_opt_out ?? 0) === 1;
              return (
                <li key={candidate.customer.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {candidate.customer.name}
                      {optedOut && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                          Opted out
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {candidate.customer.phone || 'No phone number'}
                      {candidate.lastReminderAt
                        ? ` · last reminded ${formatStamp(candidate.lastReminderAt)}`
                        : ' · never reminded'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-amber-700">{money(candidate.balance)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            {t('debtReminders.history')}
          </p>
          <ul className="space-y-1.5">
            {history.map((reminder) => (
              <li
                key={reminder.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-gray-900">
                    {reminder.customer_name}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {formatStamp(reminder.sent_at)} · {money(reminder.balance)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    reminder.status === 'sent'
                      ? 'bg-emerald-100 text-emerald-700'
                      : reminder.status === 'skipped'
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-red-100 text-red-700'
                  }`}
                >
                  {reminder.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
