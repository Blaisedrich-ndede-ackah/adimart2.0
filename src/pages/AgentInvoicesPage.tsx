import { useCallback, useEffect, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  createLocalAgentInvoice,
  generateId,
  listLocalAgentInvoices,
  listLocalProspects,
  updateLocalAgentInvoice,
  type AgentPaymentMethod,
  type LocalAgentInvoice,
  type LocalProspect,
} from '@/lib/dexie';
import {
  generateAgentInvoiceNumber,
  invoicePdfPayload,
  packagePrice,
  refreshOverdueInvoices,
  settleAgentInvoice,
  syncAgentPortal,
  type SettlementResult,
} from '@/lib/agentPortal';
import { downloadAgentInvoicePdf, shareAgentInvoiceViaWhatsApp } from '@/lib/agentInvoicePdf';
import { formatOfficialMoney } from '@/lib/currency';
import { generatePaystackReference, initializePaystack, isPaystackConfigured } from '@/lib/paystack';
import { Button } from '@/components/ui/Button';

const METHODS: AgentPaymentMethod[] = ['cash', 'momo', 'bank_transfer'];

export default function AgentInvoicesPage() {
  const agent = useAgentAuthStore((state) => state.currentAgent);
  const [invoices, setInvoices] = useState<LocalAgentInvoice[]>([]);
  const [prospects, setProspects] = useState<LocalProspect[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [prospectId, setProspectId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<SettlementResult | null>(null);
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<AgentPaymentMethod>('cash');
  const [payReference, setPayReference] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!agent) return;
    setLoading(true);
    await refreshOverdueInvoices(agent.id);
    const [invoiceRows, prospectRows] = await Promise.all([
      listLocalAgentInvoices(agent.id),
      listLocalProspects(agent.id),
    ]);
    setInvoices(invoiceRows.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setProspects(prospectRows);
    setLoading(false);
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  const prospectFor = (id: string) => prospects.find((row) => row.id === id);

  const onPickProspect = (id: string) => {
    setProspectId(id);
    const prospect = prospectFor(id);
    const price = prospect ? packagePrice(prospect.subscription_package) : 0;
    if (price > 0) setAmount(String(price));
    if (prospect) setDescription(`${prospect.subscription_package || 'Subscription'} for ${prospect.store_name}`);
  };

  const createInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!agent) return;
    const value = Number(amount);
    if (!prospectId || !dueDate || !Number.isFinite(value) || value <= 0) {
      setError('Choose a prospect, amount, and due date.');
      return;
    }
    const now = new Date().toISOString();
    await createLocalAgentInvoice({
      id: generateId(),
      invoice_number: generateAgentInvoiceNumber(),
      prospect_id: prospectId,
      agent_id: agent.id,
      amount_ghs: Math.round(value * 100) / 100,
      currency_code: 'GHS',
      due_date: dueDate,
      status: 'issued',
      description: description.trim(),
      paystack_reference: '',
      pdf_url: '',
      created_at: now,
      updated_at: now,
    });
    setOpenCreate(false);
    setProspectId('');
    setAmount('');
    setDueDate('');
    setDescription('');
    await syncAgentPortal();
    await load();
  };

  const recordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!payInvoiceId) return;
    setError('');
    setNotice(null);
    try {
      const result = await settleAgentInvoice({
        invoiceId: payInvoiceId,
        amountGhs: Number(payAmount),
        method: payMethod,
        reference: payReference,
      });
      setNotice(result);
      setPayInvoiceId(null);
      await syncAgentPortal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  const payWithPaystack = async (invoice: LocalAgentInvoice) => {
    setError('');
    const prospect = prospectFor(invoice.prospect_id);
    const reference = generatePaystackReference();
    try {
      await initializePaystack({
        email: prospect?.owner_email || '',
        amount: Math.round(invoice.amount_ghs * 100),
        reference,
        paymentFor: `Subscription ${invoice.invoice_number}`,
        metadata: { invoice_id: invoice.id, prospect_id: invoice.prospect_id },
        onSuccess: (paystackReference) => {
          void settleAgentInvoice({
            invoiceId: invoice.id,
            amountGhs: invoice.amount_ghs,
            method: 'paystack',
            reference: paystackReference,
          }).then(async (result) => {
            setNotice(result);
            await syncAgentPortal();
            await load();
          });
        },
        onClose: () => undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paystack could not open.');
    }
  };

  const pdfFor = (invoice: LocalAgentInvoice) =>
    invoicePdfPayload(invoice, agent, prospectFor(invoice.prospect_id));

  if (loading) return <p className="p-6 text-sm text-gray-500">Loading invoices…</p>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Invoices</h2>
          <p className="text-sm text-gray-500">Subscription invoices for store prospects.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setOpenCreate((open) => !open)}>
          {openCreate ? 'Close' : 'Create invoice'}
        </Button>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>}
      {notice && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-sm text-emerald-900 space-y-1">
          <p className="font-semibold">Payment recorded. Invoice is {notice.status}.</p>
          {notice.commissionAmount ? <p>Commission accrued: {formatOfficialMoney(notice.commissionAmount, 'GHS')}</p> : null}
          {notice.storeId && (
            <p>
              Store opened for {notice.storeName}. Store ID {notice.storeId}. Owner PIN {notice.ownerPin}. Share the PIN once, then ask the owner to change it.
            </p>
          )}
          {notice.activationError && <p className="text-amber-800">{notice.activationError}</p>}
        </div>
      )}

      {openCreate && (
        <form onSubmit={createInvoice} className="rounded-xl bg-white border border-gray-100 p-4 grid gap-3">
          <label className="text-xs font-medium text-gray-500">
            Prospect
            <select
              value={prospectId}
              onChange={(event) => onPickProspect(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Select a prospect</option>
              {prospects.map((prospect) => (
                <option key={prospect.id} value={prospect.id}>
                  {prospect.store_name} — {prospect.owner_full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500">
            Amount (GHS)
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-gray-500">
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-medium text-gray-500">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <Button type="submit" variant="primary">Save invoice</Button>
        </form>
      )}

      <div className="space-y-3">
        {invoices.length === 0 && (
          <p className="rounded-xl bg-white border border-gray-100 p-6 text-sm text-gray-500 text-center">No invoices yet.</p>
        )}
        {invoices.map((invoice) => {
          const prospect = prospectFor(invoice.prospect_id);
          const open = invoice.status !== 'paid' && invoice.status !== 'cancelled';
          return (
            <article key={invoice.id} className="rounded-xl bg-white border border-gray-100 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{invoice.invoice_number}</p>
                  <p className="text-xs text-gray-500">
                    {prospect?.store_name || 'Prospect'} · due {invoice.due_date || '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{formatOfficialMoney(invoice.amount_ghs, 'GHS')}</p>
                  <p className="text-xs uppercase text-emerald-700">{invoice.status}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" leftIcon={<Download className="w-3 h-3" />} onClick={() => downloadAgentInvoicePdf(pdfFor(invoice))}>
                  PDF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<Share2 className="w-3 h-3" />}
                  onClick={() => shareAgentInvoiceViaWhatsApp(pdfFor(invoice), prospect?.owner_phone || '')}
                >
                  WhatsApp
                </Button>
                {open && isPaystackConfigured() && (
                  <Button size="sm" variant="primary" onClick={() => void payWithPaystack(invoice)}>
                    Paystack
                  </Button>
                )}
                {open && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPayInvoiceId(invoice.id);
                      setPayAmount(String(invoice.amount_ghs));
                      setPayReference('');
                    }}
                  >
                    Record payment
                  </Button>
                )}
                {open && (
                  <Button size="sm" variant="ghost" onClick={() => void updateLocalAgentInvoice(invoice.id, { status: 'cancelled' }).then(load)}>
                    Cancel
                  </Button>
                )}
              </div>
              {payInvoiceId === invoice.id && (
                <form onSubmit={recordPayment} className="grid grid-cols-1 md:grid-cols-3 gap-2 border-t border-gray-100 pt-3">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={payAmount}
                    onChange={(event) => setPayAmount(event.target.value)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    aria-label="Payment amount"
                  />
                  <select
                    value={payMethod}
                    onChange={(event) => setPayMethod(event.target.value as AgentPaymentMethod)}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                    aria-label="Payment method"
                  >
                    {METHODS.map((method) => (
                      <option key={method} value={method}>{method.replace('_', ' ')}</option>
                    ))}
                  </select>
                  <input
                    value={payReference}
                    onChange={(event) => setPayReference(event.target.value)}
                    placeholder="Reference"
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  />
                  <Button type="submit" size="sm" variant="primary">Save payment</Button>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
