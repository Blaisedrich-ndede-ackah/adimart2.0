import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LocalStore } from '@/lib/dexie';
import { useT } from '@/lib/i18n';
import { summarizeTickets } from '@/lib/support/reports';
import { slaClock } from '@/lib/support/sla';
import { pullSupportChanges, storeProfile } from '@/lib/support/cloud';
import { notifyTicketReply } from '@/lib/support/notify';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from '@/lib/support/types';
import {
  addMessage,
  createTicket,
  ensureCannedReplies,
  listMessages,
  readAttachmentFile,
  statusLabel,
  updateTicket,
} from '@/lib/support/repository';
import { triggerPushSync } from '@/lib/sync';
import { issueAdminSupportToken } from '@/lib/support/access';

export default function CustomerCarePanel() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SupportStatus | 'all'>('all');
  const [category, setCategory] = useState<SupportCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState('');
  const [cloudNote, setCloudNote] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePlan, setProfilePlan] = useState('');
  const [profileActivity, setProfileActivity] = useState<string[]>([]);
  const tickets = useLiveQuery(() => db.support_tickets.toArray(), []) || [];
  const canned = useLiveQuery(() => db.support_canned_replies.toArray(), []) || [];
  const stores = useLiveQuery(() => db.stores.toArray(), []) || [];

  useEffect(() => {
    void ensureCannedReplies();
    void issueAdminSupportToken().then(() => pullSupportChanges(null)).then((message) => {
      if (message) setCloudNote(message);
    });
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tickets
      .filter((ticket) => status === 'all' || ticket.status === status)
      .filter((ticket) => category === 'all' || ticket.category === category)
      .filter((ticket) => {
        if (!needle) return true;
        return `${ticket.subject} ${ticket.reference} ${ticket.customer_name} ${ticket.customer_phone}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [tickets, query, status, category]);
  const selected = filtered.find((ticket) => ticket.id === selectedId) || filtered[0] || null;
  const messages = useLiveQuery(
    () => (selected ? listMessages(selected.id, true) : Promise.resolve([])),
    [selected?.id, selected?.updated_at]
  ) || [];
  const report = useMemo(() => summarizeTickets(tickets), [tickets]);

  useEffect(() => {
    if (!selected) return;
    setAssignee(selected.assignee_name);
    void storeProfile(selected.store_id).then(({ store, recent }) => {
      setProfileName(store?.name || selected.customer_name || selected.store_id);
      setProfilePlan(planLabel(store));
      setProfileActivity(recent.map((row) => `${row.receipt_number} · ${row.total_amount}`));
    });
  }, [selected?.id, selected?.store_id, selected?.assignee_name, selected?.customer_name]);

  async function saveAssignee(nextStatus?: SupportStatus) {
    if (!selected) return;
    await updateTicket(selected, {
      assignee_name: assignee,
      status: nextStatus || selected.status,
    });
    void triggerPushSync('support-update');
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setError('');
    try {
      await addMessage({
        ticket: selected,
        authorRole: 'admin',
        authorName: assignee || 'Customer care',
        body: reply,
        visibility: internal ? 'internal' : 'public',
      });
      if (!internal) await notifyTicketReply({ ...selected, updated_at: new Date().toISOString() }, reply, true);
      setReply('');
      void triggerPushSync('support-reply');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('care.saveError'));
    }
  }

  async function openForStore(store: LocalStore) {
    const ticket = await createTicket({
      storeId: store.id,
      source: 'admin',
      customerName: store.name,
      customerPhone: store.support_number || '',
      customerEmail: '',
      category: 'account',
      priority: 'normal',
      subject: `Care follow-up for ${store.name}`,
      body: 'Opened by customer care.',
      openedByName: 'Customer care',
      authorRole: 'admin',
    });
    setSelectedId(ticket.id);
    void triggerPushSync('support-ticket');
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-ink">{t('care.helpTitle')}</h2>
        <p className="text-sm text-muted">{t('care.helpSubtitle')}</p>
      </header>
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('care.volume')} value={String(report.volume)} />
        <Stat label={t('care.resolutionRate')} value={`${report.resolutionRate}%`} />
        <Stat label={t('care.avgFirst')} value={report.avgFirstResponseMinutes === null ? '—' : `${report.avgFirstResponseMinutes}m`} />
        <Stat label={t('care.avgResolve')} value={report.avgResolutionMinutes === null ? '—' : `${report.avgResolutionMinutes}m`} />
      </section>
      <p className="text-xs text-muted">
        {t('care.topCategories')}: {report.topCategories.slice(0, 3).map((row) => `${t(`care.cat.${row.category}`)} (${row.count})`).join(', ') || '—'}
      </p>
      {cloudNote && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{cloudNote}</p>}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_260px]">
        <section className="ios-pane rounded-2xl p-3">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('care.search')} className="mb-2 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
          <div className="mb-2 grid grid-cols-2 gap-2">
            <select value={status} onChange={(event) => setStatus(event.target.value as SupportStatus | 'all')} className="rounded-xl border border-black/10 bg-white/80 px-2 py-2 text-sm">
              <option value="all">{t('care.allStatuses')}</option>
              {SUPPORT_STATUSES.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
            </select>
            <select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory | 'all')} className="rounded-xl border border-black/10 bg-white/80 px-2 py-2 text-sm">
              <option value="all">{t('care.allCategories')}</option>
              {SUPPORT_CATEGORIES.map((item) => <option key={item} value={item}>{t(`care.cat.${item}`)}</option>)}
            </select>
          </div>
          {filtered.length === 0 && <p className="py-6 text-sm text-muted">{t('care.empty')}</p>}
          {filtered.map((ticket) => (
            <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className={`mb-1 w-full rounded-xl px-3 py-2 text-left ${selected?.id === ticket.id ? 'bg-white' : ''}`}>
              <p className="truncate text-sm font-semibold">{ticket.subject}</p>
              <p className="text-xs text-muted">{ticket.reference} · {statusLabel(ticket.status)} · {slaClock(ticket.sla_first_response_due, ticket.first_response_at)}</p>
            </button>
          ))}
          {stores[0] && (
            <button type="button" onClick={() => void openForStore(stores[0])} className="mt-2 w-full rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white">
              {t('care.newTicket')}
            </button>
          )}
        </section>

        <section className="ios-glass rounded-2xl p-4">
          {!selected && <p className="text-sm text-muted">{t('care.pick')}</p>}
          {selected && (
            <>
              <h2 className="text-lg font-bold">{selected.subject}</h2>
              <p className="text-xs text-muted">{selected.reference} · {selected.customer_name} · {selected.customer_phone}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select value={selected.status} onChange={(event) => void saveAssignee(event.target.value as SupportStatus)} className="rounded-xl border border-black/10 bg-white/80 px-2 py-2 text-sm">
                  {SUPPORT_STATUSES.map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}
                </select>
                <input value={assignee} onChange={(event) => setAssignee(event.target.value)} onBlur={() => void saveAssignee()} placeholder={t('care.assignee')} className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
                <select
                  value=""
                  onChange={(event) => {
                    const found = canned.find((replyRow) => replyRow.id === event.target.value);
                    if (found) setReply(found.body);
                  }}
                  className="rounded-xl border border-black/10 bg-white/80 px-2 py-2 text-sm"
                >
                  <option value="">{t('care.canned')}</option>
                  {canned.map((replyRow) => <option key={replyRow.id} value={replyRow.id}>{replyRow.title}</option>)}
                </select>
              </div>
              <div className="mt-4 space-y-2">
                {messages.map((message) => (
                  <article key={message.id} className={`rounded-xl px-3 py-2 ${message.visibility === 'internal' ? 'bg-amber-50' : 'bg-white/80'}`}>
                    <p className="text-xs font-semibold text-muted">{message.author_name} · {message.visibility === 'internal' ? t('care.internal') : message.author_role}</p>
                    <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                    {message.attachment_data_url && (
                      <a href={message.attachment_data_url} download={message.attachment_name} className="text-xs font-semibold text-primary">{message.attachment_name}</a>
                    )}
                  </article>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                {t('care.internal')}
              </label>
              <div className="mt-2 flex gap-2">
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" placeholder={t('care.reply')} />
                <button type="button" onClick={() => void sendReply()} className="rounded-xl bg-primary px-4 text-sm font-semibold text-white">{t('care.send')}</button>
              </div>
              <label className="mt-2 inline-flex cursor-pointer text-xs font-semibold text-primary">
                {t('care.attach')}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file || !selected) return;
                    void readAttachmentFile(file).then((fileData) => addMessage({
                      ticket: selected,
                      authorRole: 'admin',
                      authorName: assignee || 'Customer care',
                      body: fileData.name,
                      visibility: internal ? 'internal' : 'public',
                      attachmentName: fileData.name,
                      attachmentDataUrl: fileData.dataUrl,
                    })).then(() => triggerPushSync('support-attachment'));
                  }}
                />
              </label>
              {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            </>
          )}
        </section>

        <aside className="ios-pane rounded-2xl p-4">
          <h3 className="text-sm font-bold">{t('care.profile')}</h3>
          {!selected && <p className="mt-2 text-sm text-muted">{t('care.pick')}</p>}
          {selected && (
            <div className="mt-2 space-y-2 text-sm">
              <p className="font-semibold">{profileName}</p>
              <p className="text-muted">{t('care.plan')}: {profilePlan}</p>
              <p className="text-muted">{t('care.priority')}: {t(`care.pri.${selected.priority}`)}</p>
              <p className="text-xs text-muted">{t('care.firstResponse')} {slaClock(selected.sla_first_response_due, selected.first_response_at)} · {t('care.resolution')} {slaClock(selected.sla_resolution_due, selected.resolved_at)}</p>
              <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('care.activity')}</p>
              {profileActivity.length === 0 && <p className="text-xs text-muted">{t('care.noActivity')}</p>}
              {profileActivity.map((line) => <p key={line} className="text-xs">{line}</p>)}
            </div>
          )}
          {stores.length > 1 && (
            <label className="mt-4 block text-xs">
              {t('care.openForStore')}
              <select
                className="mt-1 w-full rounded-xl border border-black/10 bg-white/80 px-2 py-2"
                defaultValue=""
                onChange={(event) => {
                  const store = stores.find((item) => item.id === event.target.value);
                  if (store) void openForStore(store);
                }}
              >
                <option value="">{t('care.pick')}</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
          )}
          <p className="mt-4 text-[11px] text-muted">{SUPPORT_PRIORITIES.length} priorities · {SUPPORT_STATUSES.length} statuses</p>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ios-glass rounded-2xl px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-bold text-ink">{value}</p>
    </div>
  );
}

function planLabel(store: LocalStore | null): string {
  if (!store) return 'Unknown until this store syncs to this browser';
  const expires = store.subscription_expires_at ? `until ${store.subscription_expires_at.slice(0, 10)}` : 'no expiry on file';
  const blocked = store.access_blocked ? 'blocked' : 'active';
  return `${blocked}, ${expires}`;
}
