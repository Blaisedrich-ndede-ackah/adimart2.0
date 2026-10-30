import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, MessageSquare, Search, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';

interface SupportTicket {
  id: string;
  ticket_number?: number;
  requester_name: string;
  requester_email: string;
  store_name: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  last_message_preview: string;
  last_message_at: string;
  created_at: string;
}

interface TicketMessage {
  id: string;
  author_name: string;
  author_role: string;
  body: string;
  created_at: string;
  is_internal: boolean;
}

const filters = ['all', 'open', 'pending', 'resolved', 'closed'] as const;

function formatWhen(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function AdminSupportAgent() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<(typeof filters)[number]>('all');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('support_tickets')
      .select('id, ticket_number, requester_name, requester_email, store_name, subject, status, priority, last_message_preview, last_message_at, created_at')
      .order('last_message_at', { ascending: false })
      .limit(200);
    if (queryError) {
      const denied = /permission denied|42501/i.test(queryError.message);
      setError(denied
        ? 'permission denied for table support_tickets. Run supabase-migrate-stock-approvals-activity.sql in the Supabase SQL editor so the admin portal can read customer queries.'
        : queryError.message);
      setTickets([]);
    } else {
      setTickets((data || []) as SupportTicket[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (filter !== 'all' && ticket.status !== filter) return false;
      if (!needle) return true;
      return `${ticket.subject} ${ticket.requester_name} ${ticket.store_name} ${ticket.requester_email} ${ticket.ticket_number || ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [tickets, filter, search]);

  const selected = visible.find((ticket) => ticket.id === selectedId) || visible[0] || null;

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    let active = true;
    setMessageLoading(true);
    void supabase
      .from('support_ticket_messages')
      .select('id, author_name, author_role, body, created_at, is_internal')
      .eq('ticket_id', selected.id)
      .order('created_at', { ascending: true })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(queryError.message);
        else setMessages((data || []) as TicketMessage[]);
        setMessageLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected?.id]);

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    const body = reply.trim();
    if (!selected || !body) return;
    setSending(true);
    setError('');
    const { error: insertError } = await supabase.from('support_ticket_messages').insert({
      ticket_id: selected.id,
      author_name: 'Administrator',
      author_role: 'support_agent',
      body,
      is_internal: false,
    });
    setSending(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setReply('');
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        author_name: 'Administrator',
        author_role: 'support_agent',
        body,
        created_at: new Date().toISOString(),
        is_internal: false,
      },
    ]);
    await supabase.from('support_tickets').update({ status: 'pending' }).eq('id', selected.id);
    void loadTickets();
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-slate-700" />
            <h2 className="font-bold text-slate-900">Customer queries</h2>
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search queries"
              className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-1">
            {filters.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${filter === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-500">No customer queries yet.</p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            {visible.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedId(ticket.id)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left ${selected?.id === ticket.id ? 'bg-slate-50' : ''}`}
              >
                <p className="truncate text-sm font-semibold text-slate-900">{ticket.subject}</p>
                <p className="truncate text-[11px] text-slate-500">
                  {ticket.requester_name || 'Customer'}
                  {ticket.store_name ? ` · ${ticket.store_name}` : ''}
                  {ticket.ticket_number ? ` · #${ticket.ticket_number}` : ''}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{ticket.last_message_preview}</p>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        {error && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
        {!selected ? (
          <p className="py-16 text-center text-sm text-slate-500">Select a customer query to read it.</p>
        ) : (
          <div className="flex h-full min-h-[24rem] flex-col">
            <div className="border-b border-slate-100 pb-3">
              <p className="font-semibold text-slate-900">{selected.subject}</p>
              <p className="text-xs text-slate-500">
                {selected.requester_name || 'Customer'}
                {selected.requester_email ? ` · ${selected.requester_email}` : ''}
                {selected.store_name ? ` · ${selected.store_name}` : ''}
                {' · '}{selected.status} · {selected.priority}
              </p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto py-4">
              {messageLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              ) : messages.length === 0 ? (
                <p className="text-sm text-slate-600">{selected.last_message_preview || 'No messages on this query yet.'}</p>
              ) : messages.map((message) => (
                <article key={message.id} className={`rounded-xl px-3 py-2 text-sm ${message.author_role === 'support_agent' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  <p className="text-[11px] opacity-70">{message.author_name || message.author_role} · {formatWhen(message.created_at)}</p>
                  <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
                </article>
              ))}
            </div>
            <form onSubmit={(event) => void sendReply(event)} className="flex gap-2 border-t border-slate-100 pt-3">
              <input
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Reply to this query"
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <button type="submit" disabled={sending || !reply.trim()} className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                <Send className="h-4 w-4" /> Send
              </button>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
