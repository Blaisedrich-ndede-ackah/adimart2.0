import { useState } from 'react';
import { FileText, MessageCircle, Printer } from 'lucide-react';
import type { LocalCustomer, LocalStore } from '@/lib/dexie';
import { useFormatMoney } from '@/lib/currency';
import {
  buildCustomerStatement,
  statementPdf,
  statementText,
  type StatementLine,
} from '@/lib/customerStatement';

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CustomerStatementPanel({
  customer,
  store,
}: {
  customer: LocalCustomer;
  store: LocalStore;
}) {
  const money = useFormatMoney();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [opening, setOpening] = useState<number | null>(null);
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [closing, setClosing] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    if (!from || !to || from > to) {
      setError('Choose a start date on or before the end date.');
      return null;
    }
    setBusy(true);
    try {
      const statement = await buildCustomerStatement(customer.id, from, to);
      setOpening(statement.opening);
      setLines(statement.lines);
      setClosing(statement.closing);
      return statement;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the statement.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const shareWhatsApp = async () => {
    const statement = opening == null ? await load() : { opening, lines, closing };
    if (!statement || statement.opening == null) return;
    const text = statementText({
      storeName: store.name,
      customerName: customer.name,
      from,
      to,
      opening: statement.opening,
      lines: statement.lines,
      closing: statement.closing,
      currency: store.currency_code || 'GHS',
    });
    const phone = customer.phone.replace(/\D/g, '');
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const savePdf = async () => {
    const statement = await load();
    if (!statement) return;
    const blob = await statementPdf({
      store,
      customerName: customer.name,
      from,
      to,
      opening: statement.opening,
      lines: statement.lines,
      closing: statement.closing,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${customer.name.replace(/\s+/g, '-')}-statement.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printStatement = async () => {
    const statement = await load();
    if (!statement) return;
    const blob = await statementPdf({
      store,
      customerName: customer.name,
      from,
      to,
      opening: statement.opening,
      lines: statement.lines,
      closing: statement.closing,
    });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="ios-glass space-y-3 rounded-2xl p-4">
      <h3 className="font-bold text-gray-900">Account statement</h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-600">
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-white/70 bg-white/80 px-2 py-2 text-sm" />
        </label>
        <label className="text-xs text-gray-600">
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-lg border border-white/70 bg-white/80 px-2 py-2 text-sm" />
        </label>
      </div>
      <button type="button" onClick={() => void load()} disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
        {busy ? 'Building…' : 'Show statement'}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {opening != null && (
        <div className="space-y-2 text-sm">
          <p className="flex justify-between"><span>Opening balance</span><strong>{money(opening)}</strong></p>
          {lines.length === 0 && <p className="text-xs text-gray-500">No account activity in this range.</p>}
          {lines.map((line, index) => (
            <div key={`${line.at}-${index}`} className="rounded-xl bg-white/70 px-3 py-2">
              <p className="font-medium">{line.label}</p>
              <p className="text-xs text-gray-500">
                {line.at.slice(0, 10)}
                {line.debit ? ` · charged ${money(line.debit)}` : ''}
                {line.credit ? ` · paid ${money(line.credit)}` : ''}
                {line.points ? ` · points ${line.points > 0 ? '+' : ''}${line.points}` : ''}
                {' · balance '}{money(line.balance)}
              </p>
            </div>
          ))}
          <p className="flex justify-between border-t border-white/70 pt-2"><span>Closing balance</span><strong>{money(closing)}</strong></p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void printStatement()} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold"><Printer className="h-3.5 w-3.5" /> Print</button>
            <button type="button" onClick={() => void savePdf()} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold"><FileText className="h-3.5 w-3.5" /> PDF</button>
            <button type="button" onClick={() => void shareWhatsApp()} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
          </div>
        </div>
      )}
    </section>
  );
}
