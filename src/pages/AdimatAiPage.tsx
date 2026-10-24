import { useEffect, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { saveDraftPurchaseOrder } from '@/lib/adimatAi/draftPo';
import { fitSms } from '@/lib/adimatAi/debt';
import { periodLabel } from '@/lib/adimatAi/heatmap';
import { useAdimatAi } from '@/lib/adimatAi/useAdimatAi';
import { sendPreparedDebtReminder } from '@/lib/debtReminders';
import { useFormatMoney } from '@/lib/currency';
import { useI18nStore, useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/useAuthStore';
import type { Why } from '@/lib/adimatAi/types';

interface AdimatAiPageProps {
  onNavigate: (page: string) => void;
}

function localizeVars(
  vars: Record<string, string | number>,
  money: (amount: number) => string
): Record<string, string | number> {
  const next: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(vars)) {
    next[key] = key.endsWith('Money') && typeof value === 'number' ? money(value) : value;
  }
  return next;
}

export default function AdimatAiPage({ onNavigate }: AdimatAiPageProps) {
  const t = useT();
  const money = useFormatMoney();
  const language = useI18nStore((state) => state.language);
  const { currentStore, currentUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const ai = useAdimatAi(currentStore?.id, isOwner);
  const report = ai.report;
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [sendNote, setSendNote] = useState('');
  const [seedError, setSeedError] = useState('');
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!report) return;
    const next: Record<string, string> = {};
    for (const row of report.debt) next[row.customerId] = row.message;
    setMessages(next);
  }, [report]);

  const why = (item: Why) => t(item.whyKey, localizeVars(item.whyVars, money));
  const confidence = (level: string) => t(`ai.confidence.${level}`);

  const hourLabel = (weekday: number, hour: number) => {
    if (language === 'en') return periodLabel(weekday, hour);
    const base = new Date(2026, 0, 4 + weekday, hour);
    const day = new Intl.DateTimeFormat('fr', { weekday: 'long' }).format(base);
    return `${day} ${hour}:00`;
  };

  const sendReminder = async (customerId: string) => {
    if (!currentStore?.id || !report) return;
    const row = report.debt.find((item) => item.customerId === customerId);
    if (!row || row.optOut) return;
    const message = fitSms(messages[customerId] || row.message);
    if (!window.confirm(t('ai.debt.confirm', { name: row.name }))) return;
    setSendNote('');
    try {
      const result = await sendPreparedDebtReminder({
        storeId: currentStore.id,
        customerId: row.customerId,
        customerName: row.name,
        phone: row.phone,
        balance: row.owed,
        message,
      });
      setSendNote(result.ok ? t('ai.debt.sent', { name: row.name }) : result.error || t('ai.debt.failed'));
    } catch (error) {
      setSendNote(error instanceof Error ? error.message : t('ai.debt.failed'));
    }
  };

  const openDraft = (supplierId: string) => {
    const group = report?.restock.find((item) => item.supplierId === supplierId);
    if (!group) return;
    saveDraftPurchaseOrder({
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      notes: t('ai.restock.draftNote'),
      lines: group.lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.suggestedQty,
        unitCost: line.unitCost,
      })),
      createdAt: new Date().toISOString(),
    });
    onNavigate('purchasing');
  };

  const loadSample = async () => {
    if (!currentStore?.id || !import.meta.env.DEV) return;
    setSeeding(true);
    setSeedError('');
    try {
      const seed = await import('@/lib/adimatAi/previewSeed');
      await seed.seedAdimatAiPreview(currentStore.id);
      ai.refresh();
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : 'Sample data could not be loaded.');
    } finally {
      setSeeding(false);
    }
  };

  const maxHeat = Math.max(1, ...(report?.heatmap.cells.map((cell) => cell.total) || [1]));

  return (
    <div className="page-shell">
      <div className="page-header">
        <p className="text-emerald-200 text-xs font-semibold uppercase tracking-wide">ADIMAT AI</p>
        <h1 className="mt-1 text-white text-xl font-bold">ADIMAT AI</h1>
        <p className="mt-1 text-emerald-100 text-xs">{t('ai.subtitle')}</p>
      </div>
      <div className="page-body no-scrollbar space-y-4">
        <p className="text-xs leading-5 text-gray-600">{t('ai.disclaimer')}</p>
        {report?.lowHistory && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('ai.notEnough')}</p>
        )}
        {ai.status === 'error' && <p className="text-sm text-red-700">{ai.error}</p>}
        {ai.locations.length > 1 && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('common.store')}</span>
            <select
              value={ai.locationId || ''}
              onChange={(event) => ai.setLocationId(event.target.value)}
              className="w-full rounded-xl border border-white/70 bg-white px-3 py-2"
            >
              {ai.locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
        )}

        {report && (
          <section className="ios-glass rounded-2xl p-4" aria-label={t('ai.brief.title')}>
            <h2 className="text-sm font-bold">{t('ai.brief.title')}</h2>
            <p className="mt-2 text-2xl font-bold">{money(report.brief.sales)}</p>
            <p className="text-xs text-gray-600">{t('ai.brief.yesterdaySales')}</p>
            {report.brief.profit != null && (
              <p className="mt-1 text-sm">{t('ai.brief.profit')}: {money(report.brief.profit)}</p>
            )}
            <p className="mt-2 text-xs leading-5 text-gray-700">
              {t(report.brief.whyKey, localizeVars(report.brief.whyVars, money))}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-gray-700">
              {report.brief.topItems.map((item) => (
                <li key={item.productId}>{item.name} · {item.qty} · {money(item.sales)}</li>
              ))}
            </ul>
            {report.brief.topDebtors.length > 0 && (
              <p className="mt-2 text-xs text-gray-600">
                {t('ai.brief.debtors')}: {report.brief.topDebtors.map((row) => `${row.name} ${money(row.owed)}`).join(', ')}
              </p>
            )}
          </section>
        )}

        <Section title={t('ai.expiry.title')}>
          {report && report.expiry.length === 0 && report.deadStock.length === 0 ? (
            <Empty>{t('ai.empty')}</Empty>
          ) : (
            <div className="space-y-3">
              {report?.expiry.map((alert) => (
                <article key={alert.id} className="rounded-xl bg-white/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold">{alert.productName}</h3>
                    <Confidence label={confidence(alert.confidence)} />
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{t('ai.expiry.markdown', { percent: alert.markdownPercent })}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-700">{why(alert)}</p>
                  {alert.transfer && <p className="mt-1 text-xs leading-5 text-emerald-800">{why(alert.transfer)}</p>}
                </article>
              ))}
              {report?.deadStock.map((alert) => (
                <article key={alert.id} className="rounded-xl bg-white/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold">{alert.productName}</h3>
                    <Confidence label={confidence(alert.confidence)} />
                  </div>
                  <p className="mt-1 text-[11px] font-semibold uppercase text-amber-700">{t('ai.expiry.dead')}</p>
                  <p className="mt-1 text-xs text-gray-600">{t('ai.expiry.markdown', { percent: alert.markdownPercent })}</p>
                  <p className="mt-1 text-xs leading-5 text-gray-700">{why(alert)}</p>
                  {alert.transfer && <p className="mt-1 text-xs leading-5 text-emerald-800">{why(alert.transfer)}</p>}
                </article>
              ))}
            </div>
          )}
        </Section>

        {isOwner && (
          <Section title={t('ai.restock.title')}>
            {!report || report.restock.length === 0 ? <Empty>{report?.lowHistory ? t('ai.notEnough') : t('ai.empty')}</Empty> : (
              <div className="space-y-4">
                {report.restock.map((group) => (
                  <div key={group.supplierId || 'none'} className="rounded-xl bg-white/60 p-3">
                    <h3 className="text-sm font-bold">{group.supplierName}</h3>
                    <ul className="mt-2 space-y-2">
                      {group.lines.map((line) => (
                        <li key={line.productId}>
                          <p className="text-sm font-semibold">{line.productName} · {t('ai.restock.suggest', { qty: line.suggestedQty })}</p>
                          <p className="text-[11px] text-gray-500">{t('ai.confidence.' + line.confidence)} · {line.daysOfStock == null ? t('ai.notEnough') : t('ai.restock.daysLeft', { days: line.daysOfStock })}</p>
                          <p className="text-xs leading-5 text-gray-700">{why(line)}</p>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => openDraft(group.supplierId)}
                      className="mt-3 w-full rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-white touch-target"
                    >
                      {t('ai.restock.draft')}
                    </button>
                  </div>
                ))}
                <p className="text-[11px] text-gray-500">{t('ai.restock.draftNote')}</p>
              </div>
            )}
          </Section>
        )}

        {isOwner && (
          <Section title={t('ai.debt.title')}>
            {!report || report.debt.length === 0 ? <Empty>{t('ai.empty')}</Empty> : (
              <div className="space-y-3">
                {report.debt.map((row) => (
                  <article key={row.customerId} className="rounded-xl bg-white/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold">{row.name}</h3>
                      <span className="text-sm font-bold text-rose-800">{money(row.owed)}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-700">{why(row)}</p>
                    <textarea
                      aria-label={t('ai.debt.message')}
                      value={messages[row.customerId] ?? row.message}
                      maxLength={160}
                      onChange={(event) => setMessages((current) => ({ ...current, [row.customerId]: fitSms(event.target.value) }))}
                      className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs"
                      rows={3}
                    />
                    <p className="mt-1 text-[10px] text-gray-500">{(messages[row.customerId] ?? row.message).length}/160</p>
                    <button
                      type="button"
                      disabled={row.optOut || !row.phone}
                      onClick={() => void sendReminder(row.customerId)}
                      className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 touch-target"
                    >
                      {t('ai.debt.send')}
                    </button>
                    {row.optOut && <p className="mt-1 text-[11px] text-gray-500">{t('ai.debt.optOut')}</p>}
                  </article>
                ))}
                {sendNote && <p className="text-xs text-gray-700">{sendNote}</p>}
              </div>
            )}
          </Section>
        )}

        {isOwner && (
          <Section title={t('ai.cashier.title')}>
            <p className="mb-2 text-xs text-gray-600">{t('ai.cashier.reviewOnly')}</p>
            {!report || report.cashierFlags.length === 0 ? <Empty>{report?.lowHistory ? t('ai.notEnough') : t('ai.empty')}</Empty> : (
              <div className="space-y-2">
                {report.cashierFlags.map((flag) => (
                  <article key={flag.id} className="rounded-xl bg-white/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold">{flag.cashierName}</h3>
                      <Confidence label={confidence(flag.confidence)} />
                    </div>
                    <p className="mt-1 text-xs leading-5 text-gray-700">{why(flag)}</p>
                  </article>
                ))}
              </div>
            )}
          </Section>
        )}

        {isOwner && (
          <Section title={t('ai.margin.title')}>
            {!report || report.margins.length === 0 ? <Empty>{t('ai.empty')}</Empty> : (
              <div className="space-y-2">
                {report.margins.map((alert) => (
                  <article key={alert.productId} className="rounded-xl bg-white/60 p-3">
                    <h3 className="text-sm font-bold">{alert.productName}</h3>
                    <p className="mt-1 text-xs text-gray-600">
                      {t('ai.margin.before')} {alert.marginBefore}% · {t('ai.margin.after')} {alert.marginAfter}% · {t('ai.margin.suggested')} {money(alert.suggestedPrice)}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-700">{why(alert)}</p>
                  </article>
                ))}
              </div>
            )}
          </Section>
        )}

        <Section title={t('ai.heatmap.title')}>
          {report?.heatmap.enough ? (
            <>
              <div className="overflow-x-auto">
                <div className="min-w-[520px]">
                  {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                    <div key={weekday} className="mb-1 grid grid-cols-[72px_repeat(14,minmax(0,1fr))] gap-1">
                      <span className="text-[10px] leading-4 text-gray-500">{hourLabel(weekday, 12).split(' ')[0]}</span>
                      {Array.from({ length: 14 }, (_, index) => index + 7).map((hour) => {
                        const cell = report.heatmap.cells.find((item) => item.weekday === weekday && item.hour === hour);
                        const total = cell?.total || 0;
                        return (
                          <span
                            key={hour}
                            title={hourLabel(weekday, hour)}
                            className="h-4 rounded-sm"
                            style={{ backgroundColor: `rgba(16, 122, 87, ${total <= 0 ? 0.08 : 0.2 + (total / maxHeat) * 0.75})` }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-700">
                {t('ai.why.heatmap', {
                  busy: report.heatmap.busiest.map((cell) => hourLabel(cell.weekday, cell.hour)).join(', '),
                  slow: report.heatmap.slowest.map((cell) => hourLabel(cell.weekday, cell.hour)).join(', '),
                })}
              </p>
            </>
          ) : (
            <Empty>{t('ai.notEnough')}</Empty>
          )}
        </Section>

        <Section title={t('ai.settings.title')}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('ai.settings.expiryDays')} value={ai.settings.expiryDays} onChange={(value) => ai.setSettings({ ...ai.settings, expiryDays: value })} />
            <Field label={t('ai.settings.deadWeeks')} value={ai.settings.deadStockWeeks} onChange={(value) => ai.setSettings({ ...ai.settings, deadStockWeeks: value })} />
            <Field label={t('ai.settings.leadDays')} value={ai.settings.leadTimeDays} onChange={(value) => ai.setSettings({ ...ai.settings, leadTimeDays: value })} />
            <Field label={t('ai.settings.open')} value={ai.settings.openingHour} onChange={(value) => ai.setSettings({ ...ai.settings, openingHour: value })} />
            <Field label={t('ai.settings.close')} value={ai.settings.closingHour} onChange={(value) => ai.setSettings({ ...ai.settings, closingHour: value })} />
          </div>
          <p className="mt-2 text-[11px] text-gray-500">{t('ai.settings.saved')}</p>
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() => void loadSample()}
              disabled={seeding}
              className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold"
            >
              {seeding ? t('common.loading') : t('ai.seed')}
            </button>
          )}
          {seedError && <p className="mt-2 text-xs text-red-700">{seedError}</p>}
        </Section>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Sparkles className="h-3.5 w-3.5" />
          {ai.status === 'loading' ? t('common.loading') : t('ai.offline')}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ios-glass rounded-2xl p-4">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>;
}

function Confidence({ label }: { label: string }) {
  return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">{label}</span>;
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-gray-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm"
      />
    </label>
  );
}
