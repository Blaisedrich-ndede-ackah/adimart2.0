import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Search, FileText, CreditCard, Phone, Clock, RefreshCcw,
  ChevronRight, Download, Share2, ArrowRight,
} from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  createLocalAgentInvoice,
  listLocalAgentInvoices,
  updateLocalAgentInvoice,
  deleteLocalAgentInvoice,
  listLocalProspects,
  type LocalAgentInvoice,
  type LocalProspect,
} from '@/lib/dexie';
import { generateAgentInvoicePdf, downloadAgentInvoicePdf, shareAgentInvoiceViaWhatsApp } from '@/lib/agentInvoicePdf';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { LinkButton } from '@/components/ui/Button';
import { formatOfficialMoney } from '@/lib/currency';
import { initializePaystack, isPaystackConfigured, generatePaystackReference } from '@/lib/paystack';

type InvoiceStatusFilter = 'all' | 'issued' | 'paid' | 'partial' | 'overdue' | 'cancelled';

const STATUS_LABELS: Record<string, string> = {
  issued: 'Issued',
  paid: 'Paid',
  partial: 'Partial',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  issued: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  partial: 'bg-amber-50 text-amber-700 border-amber-100',
  overdue: 'bg-red-50 text-red-700 border-red-100',
  cancelled: 'bg-gray-50 text-gray-700 border-gray-100',
};

export default function AgentInvoicesPage() {
  const { currentAgent } = useAgentAuthStore();
  const [invoices, setInvoices] = useState<LocalAgentInvoice[]>([]);
  const [prospects, setProspects] = useState<LocalProspect[]>([]);
  const [filter, setFilter] = useState<InvoiceStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [form, setForm] = useState({
    prospect_id: '',
    amount_ghs: '',
    due_date: '',
    description: '',
  });
  const [createError, setCreateError] = useState('');


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invData, prosData] = await Promise.all([
        listLocalAgentInvoices(currentAgent?.id),
        listLocalProspects(currentAgent?.id),
      ]);
      setInvoices(invData);
      setProspects(prosData);
    } finally {
      setLoading(false);
    }
  }, [currentAgent?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = invoices.filter((inv) => {
    const matchFilter = filter === 'all' || inv.status === filter;
    const term = search.toLowerCase();
    const matchSearch = inv.invoice_number.toLowerCase().includes(term);
    return matchFilter && matchSearch;
  });

  const prospectFor = (id: string) => prospects.find((p) => p.id === id);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!form.prospect_id || !form.amount_ghs || !form.due_date) {
      setCreateError('Prospect, amount, and due date are required.');
      return;
    }
    const amount = Number(form.amount_ghs);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCreateError('Enter a valid amount.');
      return;
    }
    if (!isPaystackConfigured()) {
      setCreateError('Paystack is not configured. Add VITE_PAYSTACK_PUBLIC_KEY.');
      return;
    }
    try {
      const invoiceNumber = `#INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      await createLocalAgentInvoice({
        id: generateInvoiceId(),
        invoice_number: invoiceNumber,
        prospect_id: form.prospect_id,
        agent_id: currentAgent!.id,
        amount_ghs: amount,
        currency_code: 'GHS',
        due_date: form.due_date,
        status: 'issued',
        description: form.description,
        paystack_reference: '',
        pdf_url: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as LocalAgentInvoice);
      setOpenCreate(false);
      setForm({ prospect_id: '', amount_ghs: '', due_date: '', description: '' });
      void load();
    } catch (err: any) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invoice.');
    }
  };

  const handlePaystack = async (invoice: LocalAgentInvoice) => {
    const pros = prospectFor(invoice.prospect_id);
    if (!pros) return;
    const ref = generatePaystackReference();
    try {
      await initializePaystack({
        email: pros.owner_email || `customer+${ref}@adimatpos.com`,
        amount: invoice.amount_ghs * 100, // pesewas
        reference: ref,
        paymentFor: `Subscription Invoice ${invoice.invoice_number}`,
        metadata: { invoice_id: invoice.id, prospect_id: invoice.prospect_id },
        onSuccess: (paystackRef) => {
          updateLocalAgentInvoice(invoice.id, {
            paystack_reference: paystackRef,
            status: 'paid',
          });
          void load();
        },
        onClose: () => {},
      });
    } catch (err: any) {
      setCreateError(err instanceof Error ? err.message : 'Paystack payment failed.');
    }
  };
  const handleDownload = (invoice: LocalAgentInvoice) => {
    const pros = prospectFor(invoice.prospect_id);
    downloadAgentInvoicePdf({
      invoiceNumber: invoice.invoice_number,
      agentName: currentAgent?.full_name || 'Agent',
      agentPhone: currentAgent?.phone || '',
      storeName: pros?.store_name || 'Store',
      ownerName: pros?.owner_full_name || 'Owner',
      ownerPhone: pros?.owner_phone || '',
      subscriptionPackage: pros?.subscription_package || '—',
      amountGhs: invoice.amount_ghs,
      dueDate: invoice.due_date ?? null,
      description: invoice.description,
      paystackReference: invoice.paystack_reference || undefined,
      status: invoice.status as any,
      paystackPayUrl: undefined,
      generatedAt: invoice.created_at,
    });
  };

  const handleShare = (invoice: LocalAgentInvoice) => {
    const pros = prospectFor(invoice.prospect_id);
    shareAgentInvoiceViaWhatsApp(
      {
        invoiceNumber: invoice.invoice_number,
        agentName: currentAgent?.full_name || 'Agent',
        agentPhone: currentAgent?.phone || '',
        storeName: pros?.store_name || 'Store',
        ownerName: pros?.owner_full_name || 'Owner',
        ownerPhone: pros?.owner_phone || '',
        subscriptionPackage: pros?.subscription_package || '—',
        amountGhs: invoice.amount_ghs,
        dueDate: invoice.due_date ?? null,
        description: invoice.description,
        paystackReference: invoice.paystack_reference || undefined,
        status: invoice.status as any,
        paystackPayUrl: undefined,
        generatedAt: invoice.created_at,
      },
      pros?.owner_phone || ''
    );
  };

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[400px]">
        <RefreshCcw className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="page-shell p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500">Subscription invoices issued to store prospects.</p>
        </div>
        <LinkButton
          onClick={() => setOpenCreate(true)}
          variant="primary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
        >
          Create Invoice
        </LinkButton>
      </div>

      <div className="rounded-xl bg-white border border-gray-100 p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice number…"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as InvoiceStatusFilter)}
            className="rounded-xl border border-gray-200 bg-gray-50 pl-3 pr-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Status</option>
            <option value="issued">Issued</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <div className="col-span-1 md:col-span-1"></div>
        </div>
      </div>
      {/* Create invoice form */}
      {openCreate && (
        <div className="rounded-xl bg-white border border-gray-100 shadow-lg p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Create Subscription Invoice</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Prospect / Store</label>
              <select
                value={form.prospect_id}
                onChange={(e) => setForm({ ...form, prospect_id: e.target.value })}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">Select a prospect</option>
                {prospects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.store_name} — {p.owner_full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Amount (GHS)</label>
              <input
                type="number"
                step="0.01"
                value={form.amount_ghs}
                onChange={(e) => setForm({ ...form, amount_ghs: e.target.value })}
                placeholder="0.00"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Silver Monthly Subscription"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            {createError && (
              <div className="md:col-span-2 rounded-lg bg-red-50 border border-red-100 p-3">
                <p className="text-sm text-red-700">{createError}</p>
              </div>
            )}
            <div className="md:col-span-2 flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpenCreate(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700 shadow-sm shadow-emerald-100">
                Create Invoice
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="rounded-xl bg-white border border-gray-100 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Store / Owner</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Due Date</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No invoices yet. Create your first invoice for a prospect.
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const pros = prospectFor(inv.prospect_id);
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4">
                        <div className="font-medium text-gray-900">{inv.invoice_number}</div>
                      </td>
                      <td className="py-4">
                        <div className="text-sm text-gray-900">{pros?.store_name || '—'}</div>
                        <div className="text-xs text-gray-500">{pros?.owner_full_name || '—'}</div>
                      </td>
                      <td className="py-4 text-gray-900">{formatOfficialMoney(inv.amount_ghs, 'GHS')}</td>
                      <td className="py-4 text-gray-700">{inv.due_date || '—'}</td>
                      <td className="py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${STATUS_COLORS[inv.status]}`}>
                          {STATUS_LABELS[inv.status]}
                        </span>
                      </td>
                      <td className="py-4 text-right">
                        <div className="flex items-center gap-1">
                          <LinkButton
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(inv)}
                            icon={<Download className="w-3 h-3" />}
                          >
                            PDF
                          </LinkButton>
                          <LinkButton
                            variant="outline"
                            size="sm"
                            onClick={() => handleShare(inv)}
                            icon={<Share2 className="w-3 h-3" />}
                          >
                            Share
                          </LinkButton>
                          {inv.status === 'issued' && isPaystackConfigured() && (
                            <LinkButton
                              variant="success"
                              size="sm"
                              onClick={() => handlePaystack(inv)}
                              icon={<CreditCard className="w-3 h-3" />}
                            >
                              Paystack
                            </LinkButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-50 p-3 flex items-center justify-between text-xs text-gray-500">
          <span>{filtered.length} invoice(s)</span>
          <span>Paystack: {isPaystackConfigured() ? 'Configured' : 'Not configured'}</span>
        </div>
      </div>
    </div>
  );
}

function generateInvoiceId(): string {
  return 'inv_' + Math.random().toString(36).substring(2, 15);
}

