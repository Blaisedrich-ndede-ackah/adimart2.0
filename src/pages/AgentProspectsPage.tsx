import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Users, Filter, ChevronRight, Phone, MapPin } from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import {
  createLocalProspect,
  deleteLocalProspect,
  getLocalProspect,
  listLocalProspects,
  updateLocalProspect,
  type LocalProspect,
  type ProspectStatus,
} from '@/lib/dexie';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { LinkButton } from '@/components/ui/Button';

type StatusFilter = 'all' | 'lead' | 'contacted' | 'follow_up' | 'converted' | 'lost';

const STATUS_LABELS: Record<ProspectStatus, string> = {
  lead: 'Lead',
  contacted: 'Contacted',
  follow_up: 'Follow Up',
  converted: 'Converted',
  lost: 'Lost',
};

const STATUS_COLORS: Record<ProspectStatus, string> = {
  lead: 'bg-blue-50 text-blue-700 border-blue-100',
  contacted: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  follow_up: 'bg-amber-50 text-amber-700 border-amber-100',
  converted: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  lost: 'bg-gray-50 text-gray-700 border-gray-100',
};

export default function AgentProspectsPage() {
  const { currentAgent } = useAgentAuthStore();
  const [prospects, setProspects] = useState<LocalProspect[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [openAdd, setOpenAdd] = useState(false);
  const [addError, setAddError] = useState('');
  const [addForm, setAddForm] = useState({
    store_name: '',
    owner_full_name: '',
    owner_phone: '',
    owner_email: '',
    address: '',
    city: '',
    business_type: '',
    subscription_package: '',
    source: 'walk-in',
    status: 'lead' as ProspectStatus,
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLocalProspects(currentAgent?.id);
      setProspects(data);
    } finally {
      setLoading(false);
    }
  }, [currentAgent?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = prospects.filter((p) => {
    const matchFilter = filter === 'all' || p.status === filter;
    const term = search.toLowerCase();
    const matchSearch =
      p.store_name.toLowerCase().includes(term) ||
      p.owner_full_name.toLowerCase().includes(term) ||
      p.owner_phone.includes(term);
    return matchFilter && matchSearch;
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    if (!addForm.store_name || !addForm.owner_full_name || !addForm.owner_phone) {
      setAddError('Store name, owner name, and phone are required.');
      return;
    }
    if (addForm.owner_phone && !isValidGhanaPhone(addForm.owner_phone)) {
      setAddError('Enter a valid Ghana phone number (e.g. 024XXXXXXX).');
      return;
    }
    try {
      await createLocalProspect({
        ...addForm,
        agent_id: currentAgent!.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as LocalProspect);
      setOpenAdd(false);
      setAddForm({
        store_name: '', owner_full_name: '', owner_phone: '', owner_email: '',
        address: '', city: '', business_type: '', subscription_package: '',
        source: 'walk-in', status: 'lead', notes: '',
      });
      void load();
    } catch (err: any) {
      setAddError(err instanceof Error ? err.message : 'Failed to create prospect.');
    }
  };

  const handleStatusChange = async (id: string, status: ProspectStatus) => {
    await updateLocalProspect(id, { status });
    void load();
  };

  if (loading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 animate-spin rounded-full border-2 border-t-transparent border-emerald-600" />
      </div>
    );
  }

  return (
    <div className="page-shell p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Prospects</h1>
          <p className="text-sm text-gray-500">Store leads recorded for follow-up and onboarding.</p>
        </div>
        <LinkButton
          onClick={() => setOpenAdd(true)}
          variant="primary"
          size="sm"
          icon={<Plus className="w-4 h-4" />}
        >
          Register Store
        </LinkButton>
      </div>

      <div className="rounded-xl bg-white border border-gray-100 p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search store or owner…"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="rounded-xl border border-gray-200 bg-gray-50 pl-3 pr-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Status</option>
            <option value="lead">Lead</option>
            <option value="contacted">Contacted</option>
            <option value="follow_up">Follow Up</option>
            <option value="converted">Converted</option>
            <option value="lost">Lost</option>
          </select>
          <div className="col-span-1 md:col-span-2 lg:col-span-2"></div>
        </div>
      </div>

      {openAdd && (
        <div className="rounded-xl bg-white border border-gray-100 shadow-lg p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-4">Register New Store Prospect</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Store Name</label>
              <input
                value={addForm.store_name}
                onChange={(e) => setAddForm({ ...addForm, store_name: e.target.value })}
                placeholder="e.g. Kings Supermarket"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Owner Full Name</label>
              <input
                value={addForm.owner_full_name}
                onChange={(e) => setAddForm({ ...addForm, owner_full_name: e.target.value })}
                placeholder="e.g. Ama Mensah"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Owner Phone</label>
              <input
                type="tel"
                value={addForm.owner_phone}
                onChange={(e) => setAddForm({ ...addForm, owner_phone: e.target.value.replace(/\D/g, '') })}
                placeholder="024XXXXXXX"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {!isValidGhanaPhone(addForm.owner_phone) && addForm.owner_phone && (
                <p className="text-xs text-red-500">Invalid Ghana phone</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Owner Email</label>
              <input
                type="email"
                value={addForm.owner_email}
                onChange={(e) => setAddForm({ ...addForm, owner_email: e.target.value })}
                placeholder="ama@example.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Business Type</label>
              <input
                value={addForm.business_type}
                onChange={(e) => setAddForm({ ...addForm, business_type: e.target.value })}
                placeholder="e.g. Grocery"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">City</label>
              <input
                value={addForm.city}
                onChange={(e) => setAddForm({ ...addForm, city: e.target.value })}
                placeholder="e.g. Accra"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Subscription Package</label>
              <input
                value={addForm.subscription_package}
                onChange={(e) => setAddForm({ ...addForm, subscription_package: e.target.value })}
                placeholder="e.g. Silver Monthly"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase">Notes</label>
              <textarea
                value={addForm.notes}
                onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                rows={2}
                placeholder="How did you hear about us? Any special notes?"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            {addError && (
              <div className="md:col-span-2 rounded-lg bg-red-50 border border-red-100 p-3">
                <p className="text-sm text-red-700">{addError}</p>
              </div>
            )}
            <div className="md:col-span-2 flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpenAdd(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700 shadow-sm shadow-emerald-100">
                Save Prospect
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
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Store</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Owner</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Package</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="pb-3 text-xs font-semibold text-gray-500 uppercase text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    No prospects match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-4">
                      <div className="font-medium text-gray-900">{p.store_name}</div>
                      <div className="text-xs text-gray-500">{p.address || p.city || '—'}</div>
                    </td>
                    <td className="py-4 text-gray-900">{p.owner_full_name}</td>
                    <td className="py-4">
                      <div className="flex items-center gap-1 text-sm text-gray-700">
                        <Phone className="w-3 h-3" />
                        {p.owner_phone}
                      </div>
                    </td>
                    <td className="py-4 text-gray-700">{p.subscription_package || '—'}</td>
                    <td className="py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${STATUS_COLORS[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="py-4 text-right">
                      <LinkButton
                        variant="outline"
                        size="sm"
                        onClick={() => {}}
                        icon={<ChevronRight className="w-3 h-3" />}
                      >
                        View
                      </LinkButton>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-50 p-3 flex items-center justify-between text-xs text-gray-500">
          <span>{filtered.length} prospect(s)</span>
          <span>{currentAgent?.commission_percentage}% commission rate</span>
        </div>
      </div>
    </div>
  );
}
