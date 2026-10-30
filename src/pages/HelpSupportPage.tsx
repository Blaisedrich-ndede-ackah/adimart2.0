import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LifeBuoy, Paperclip, Send } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useT } from '@/lib/i18n';
import { db } from '@/lib/dexie';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  type SupportCategory,
  type SupportPriority,
} from '@/lib/support/types';
import { slaClock } from '@/lib/support/sla';
import {
  addMessage,
  createTicket,
  listMessages,
  markNotificationsRead,
  readAttachmentFile,
  statusLabel,
} from '@/lib/support/repository';
import { notifyNewTicket } from '@/lib/support/notify';
import { triggerPushSync } from '@/lib/sync';

export default function HelpSupportPage() {
  const t = useT();
  const { currentStore, currentUser } = useAuthStore();
  const storeId = currentStore?.id || '';
  const isOwner = currentUser?.role === 'owner';
  const tickets = useLiveQuery(
    async () => {
      if (!storeId) return [];
      const rows = await db.support_tickets.where('store_id').equals(storeId).toArray();
      const visible = isOwner ? rows : rows.filter((row) => row.opened_by_name === (currentUser?.name || ''));
      return visible.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    [storeId, isOwner, currentUser?.name]
  ) || [];
  const notices = useLiveQuery(
    () => (storeId ? db.support_notifications.where('store_id').equals(storeId).toArray() : []),
    [storeId]
  ) || [];
  const unread = notices.filter((notice) => notice.read === 0).length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tickets.find((ticket) => ticket.id === selectedId) || tickets[0] || null;
  const messages = useLiveQuery(
    () => (selected ? listMessages(selected.id, false) : Promise.resolve([])),
    [selected?.id, selected?.updated_at]
  ) || [];
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [category, setCategory] = useState<SupportCategory>('technical');
  const [priority, setPriority] = useState<SupportPriority>('normal');
  const [phone, setPhone] = useState(currentStore?.support_number || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string } | null>(null);

  const sla = useMemo(() => {
    if (!selected) return null;
    return {
      first: slaClock(selected.sla_first_response_due, selected.first_response_at),
      resolution: slaClock(selected.sla_resolution_due, selected.resolved_at),
    };
  }, [selected]);

  async function onCreate() {
    if (!storeId || !subject.trim() || !body.trim()) {
      setError(t('care.required'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const ticket = await createTicket({
        storeId,
        source: 'owner',
        customerName: currentStore?.name || '',
        customerPhone: phone,
        customerEmail: '',
        category,
        priority,
        subject,
        body,
        openedByName: currentUser?.name || 'Owner',
        authorRole: currentUser?.role === 'cashier' ? 'cashier' : 'owner',
        attachmentName: attachment?.name,
        attachmentDataUrl: attachment?.dataUrl,
      });
      await notifyNewTicket(ticket);
      setSubject('');
      setBody('');
      setAttachment(null);
      setSelectedId(ticket.id);
      void triggerPushSync('support-ticket');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('care.saveError'));
    }
    setBusy(false);
  }

  async function onReply() {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    setError('');
    try {
      await addMessage({
        ticket: selected,
        authorRole: currentUser?.role === 'cashier' ? 'cashier' : 'owner',
        authorName: currentUser?.name || 'Owner',
        body: reply,
        visibility: 'public',
        attachmentName: attachment?.name,
        attachmentDataUrl: attachment?.dataUrl,
      });
      setReply('');
      setAttachment(null);
      void triggerPushSync('support-reply');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('care.saveError'));
    }
    setBusy(false);
  }

  return (
    <div className="page-body h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="ios-pane rounded-2xl px-4 py-4">
          <div className="flex items-center gap-3">
            <LifeBuoy className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-ink">{t('care.helpTitle')}</h1>
              <p className="text-sm text-muted">{t('care.helpSubtitle')}</p>
            </div>
          </div>
          {unread > 0 && (
            <button
              type="button"
              className="mt-3 text-sm font-semibold text-primary"
              onClick={() => storeId && void markNotificationsRead(storeId)}
            >
              {t('care.unread', { count: unread })}
            </button>
          )}
        </header>

        <section className="ios-glass rounded-2xl p-4">
          <h2 className="text-sm font-bold text-ink">{t('care.newTicket')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted">{t('care.subject')}</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">{t('care.phone')}</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">{t('care.category')}</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)} className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2">
                {SUPPORT_CATEGORIES.map((item) => <option key={item} value={item}>{t(`care.cat.${item}`)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">{t('care.priority')}</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as SupportPriority)} className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2">
                {SUPPORT_PRIORITIES.map((item) => <option key={item} value={item}>{t(`care.pri.${item}`)}</option>)}
              </select>
            </label>
          </div>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} placeholder={t('care.message')} className="mt-3 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-white/70 px-3 py-2 text-sm">
              <Paperclip className="h-4 w-4" />
              {attachment?.name || t('care.attach')}
              <input
                type="file"
                accept="image/*,.pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void readAttachmentFile(file).then(setAttachment).catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : t('care.saveError'));
                  });
                }}
              />
            </label>
            <button type="button" disabled={busy} onClick={() => void onCreate()} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {t('care.send')}
            </button>
          </div>
        </section>

        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="ios-pane rounded-2xl p-2">
            {tickets.length === 0 && <p className="px-2 py-6 text-sm text-muted">{t('care.empty')}</p>}
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedId(ticket.id)}
                className={`mb-1 w-full rounded-xl px-3 py-2 text-left ${selected?.id === ticket.id ? 'bg-white' : ''}`}
              >
                <p className="truncate text-sm font-semibold text-ink">{ticket.subject}</p>
                <p className="text-xs text-muted">{ticket.reference} · {statusLabel(ticket.status)}</p>
              </button>
            ))}
          </div>
          <section className="ios-glass rounded-2xl p-4">
            {!selected && <p className="text-sm text-muted">{t('care.pick')}</p>}
            {selected && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-ink">{selected.subject}</h2>
                    <p className="text-xs text-muted">{selected.reference} · {t(`care.cat.${selected.category}`)} · {t(`care.pri.${selected.priority}`)}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{statusLabel(selected.status)}</span>
                </div>
                {sla && (
                  <p className="mt-2 text-xs text-muted">
                    {t('care.firstResponse')}: {sla.first} · {t('care.resolution')}: {sla.resolution}
                  </p>
                )}
                <div className="mt-4 space-y-2">
                  {messages.map((message) => (
                    <article key={message.id} className="rounded-xl bg-white/80 px-3 py-2">
                      <p className="text-xs font-semibold text-muted">{message.author_name} · {message.author_role}</p>
                      <p className="whitespace-pre-wrap text-sm text-ink">{message.body}</p>
                      {message.attachment_data_url && (
                        <a href={message.attachment_data_url} download={message.attachment_name} className="mt-1 inline-block text-xs font-semibold text-primary">
                          {message.attachment_name || t('care.attach')}
                        </a>
                      )}
                    </article>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input value={reply} onChange={(event) => setReply(event.target.value)} placeholder={t('care.reply')} className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white/80 px-3 py-2" />
                  <button type="button" disabled={busy} onClick={() => void onReply()} className="rounded-xl bg-primary px-3 text-white" aria-label={t('care.reply')}>
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
