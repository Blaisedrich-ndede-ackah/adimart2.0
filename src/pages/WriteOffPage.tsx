import { useCallback, useEffect, useMemo, useState } from 'react';
import WriteOffEntry from '@/components/WriteOffEntry';
import { db } from '@/lib/dexie';
import { getWriteOffSummary, listWriteOffs, syncWriteOffs, type StockWriteOff } from '@/lib/writeOff';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';

function dateValue(date: Date): string { return date.toISOString().slice(0, 10); }
function dayStart(value: string): string { return new Date(`${value}T00:00:00`).toISOString(); }
function dayEnd(value: string): string { return new Date(`${value}T23:59:59.999`).toISOString(); }

export default function WriteOffPage() {
  const { currentStore, currentUser } = useAuthStore();
  const t = useT();
  const money = useFormatMoney();
  const [from, setFrom] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 6); return dateValue(date); });
  const [to, setTo] = useState(() => dateValue(new Date()));
  const [rows, setRows] = useState<StockWriteOff[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState({ totalItems: 0, totalValue: 0, byReason: { expired: 0, damaged: 0, other: 0 } });
  const refresh = useCallback(async () => {
    if (!currentStore?.id) return;
    const [nextRows, nextSummary, products] = await Promise.all([
      listWriteOffs(currentStore.id, dayStart(from), dayEnd(to)),
      getWriteOffSummary(currentStore.id, dayStart(from), dayEnd(to)),
      db.products.where('store_id').equals(currentStore.id).toArray(),
    ]);
    setRows(nextRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setSummary(nextSummary);
    setNames(Object.fromEntries(products.map((product) => [product.id, product.name])));
  }, [currentStore?.id, from, to]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!currentStore?.id) return;
    const sync = () => { void syncWriteOffs(currentStore.id).then(refresh).catch(() => undefined); };
    sync(); window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [currentStore?.id, refresh]);

  const allowed = currentUser?.role === 'owner' || (currentUser?.role === 'cashier' && currentStore?.cashiers_can_record_expenses === 1);
  const reasonRows = useMemo(() => [
    ['expired', summary.byReason.expired], ['damaged', summary.byReason.damaged], ['other', summary.byReason.other],
  ] as const, [summary]);
  const exportCsv = () => {
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = [
      ['Product', 'Quantity', 'Reason', 'Date', 'Recorded by', 'Note'].map(cell).join(','),
      ...rows.map((row) => [names[row.product_id] || row.product_name, row.quantity, row.reason, row.created_at, row.created_by_name, row.note].map(cell).join(',')),
    ];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    link.download = `adimat-write-offs-${from}-${to}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  };
  if (!currentStore || !allowed || currentStore.writeoff_enabled === 0) return <main className="p-6 text-center text-gray-600">{t('writeoff.noAccess')}</main>;

  return <div className="page-shell">
    <header className="page-header"><h1 className="text-xl font-bold text-white">{t('writeoff.title')}</h1></header>
    <main className="page-body no-scrollbar space-y-4">
      <WriteOffEntry onSaved={() => {
        if (currentStore?.id) void syncWriteOffs(currentStore.id).catch(() => 0).then(refresh);
        else void refresh();
      }} />
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-bold">{t('writeoff.weeklyReview')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold">{t('common.from')}<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block min-h-10 rounded-lg border px-2" /></label>
            <label className="text-xs font-semibold">{t('common.to')}<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 block min-h-10 rounded-lg border px-2" /></label>
            <button type="button" onClick={exportCsv} disabled={!rows.length} className="min-h-10 rounded-lg border px-3 font-semibold disabled:opacity-50 print:hidden">{t('writeoff.export')}</button>
            <button type="button" onClick={() => window.print()} className="min-h-10 rounded-lg border px-3 font-semibold print:hidden">{t('common.print')}</button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-gray-600">{t('writeoff.totalItems')}</p><p className="mt-1 text-xl font-extrabold">{summary.totalItems}</p></div>
          <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-gray-600">{t('writeoff.totalValue')}</p><p className="mt-1 text-xl font-extrabold">{money(summary.totalValue)}</p></div>
          {reasonRows.map(([reason, count]) => <div key={reason} className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-600">{t(`writeoff.${reason}`)}</p><p className="mt-1 text-xl font-extrabold">{count}</p></div>)}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b text-xs uppercase text-gray-500"><tr><th className="py-2">{t('common.product')}</th><th>{t('common.quantity')}</th><th>{t('writeoff.reason')}</th><th>{t('common.date')}</th><th>{t('writeoff.user')}</th><th>{t('writeoff.photo')}</th><th>{t('writeoff.note')}</th></tr></thead>
            <tbody className="divide-y">{rows.length ? rows.map((row) => <tr key={row.id}><td className="py-3 font-semibold">{names[row.product_id] || row.product_name || t('common.unknown')}</td><td>{row.quantity}</td><td>{t(`writeoff.${row.reason}`)}</td><td>{new Date(row.created_at).toLocaleString()}</td><td>{row.created_by_name}</td><td>{row.photo_data_url ? <a href={row.photo_data_url} target="_blank" rel="noreferrer"><img src={row.photo_data_url} alt={t('writeoff.photo')} className="h-12 w-12 rounded object-cover" /></a> : '—'}</td><td className="max-w-48 truncate">{row.note || '—'}</td></tr>) : <tr><td colSpan={7} className="py-8 text-center text-gray-500">{t('writeoff.empty')}</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </main>
  </div>;
}
