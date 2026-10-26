import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Inbox,
  MessageSquare,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';

type TicketStatus = 'Open' | 'Pending' | 'Resolved';
type TicketFilter = 'All' | TicketStatus;

type SupportTicket = {
  id: string;
  name: string;
  store: string;
  subject: string;
  preview: string;
  time: string;
  status: TicketStatus;
  priority: 'High' | 'Normal';
  initials: string;
};

type TicketMessage = {
  id: string;
  author: 'owner' | 'support';
  body: string;
  time: string;
};

const initialTickets: SupportTicket[] = [
  {
    id: 'AD-1048',
    name: 'Ama Mensah',
    store: 'Ama Beauty Store',
    subject: 'Sales totals differ between devices',
    preview: 'The phone and computer show different totals after syncing.',
    time: '8 min ago',
    status: 'Open',
    priority: 'High',
    initials: 'AM',
  },
  {
    id: 'AD-1047',
    name: 'Kwame Boateng',
    store: 'K. Boateng Mart',
    subject: 'Restore a store branch',
    preview: 'I want to add my existing store to a new tablet.',
    time: '32 min ago',
    status: 'Pending',
    priority: 'Normal',
    initials: 'KB',
  },
  {
    id: 'AD-1046',
    name: 'Esi Owusu',
    store: 'Esi Cosmetics',
    subject: 'Subscription payment question',
    preview: 'Can I change the phone number used for alerts?',
    time: '1 hr ago',
    status: 'Open',
    priority: 'Normal',
    initials: 'EO',
  },
  {
    id: 'AD-1045',
    name: 'Yaw Asante',
    store: 'Asante Provision Shop',
    subject: 'Bluetooth printer will not connect',
    preview: 'The printer worked yesterday but is not showing today.',
    time: '3 hrs ago',
    status: 'Resolved',
    priority: 'Normal',
    initials: 'YA',
  },
];

const filters: TicketFilter[] = ['All', 'Open', 'Pending', 'Resolved'];

const statusStyles: Record<TicketStatus, string> = {
  Open: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
  Pending: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  Resolved: 'bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-200',
};

export default function AdminSupportAgent() {
  const [tickets, setTickets] = useState(initialTickets);
  const [selectedId, setSelectedId] = useState(initialTickets[0].id);
  const [mobilePane, setMobilePane] = useState<'inbox' | 'conversation'>('inbox');
  const [filter, setFilter] = useState<TicketFilter>('All');
  const [search, setSearch] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [aiPrompts, setAiPrompts] = useState<Record<string, string>>({});
  const [aiReplies, setAiReplies] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, TicketMessage[]>>(() =>
    Object.fromEntries(
      initialTickets.map((ticket) => [
        ticket.id,
        [{ id: `${ticket.id}-owner`, author: 'owner', body: ticket.preview, time: ticket.time }],
      ]),
    ),
  );

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const matchesFilter = filter === 'All' || ticket.status === filter;
      const searchableText = `${ticket.id} ${ticket.name} ${ticket.store} ${ticket.subject}`.toLowerCase();
      return matchesFilter && (!query || searchableText.includes(query));
    });
  }, [filter, search, tickets]);

  const selected = filteredTickets.find((ticket) => ticket.id === selectedId) ?? filteredTickets[0] ?? null;
  const selectedMessages = selected ? messages[selected.id] ?? [] : [];
  const replyDraft = selected ? replyDrafts[selected.id] ?? '' : '';
  const aiPrompt = selected ? aiPrompts[selected.id] ?? '' : '';
  const aiReply = selected ? aiReplies[selected.id] ?? '' : '';
  const openCount = tickets.filter((ticket) => ticket.status === 'Open').length;

  const selectTicket = (ticketId: string) => {
    setSelectedId(ticketId);
    setMobilePane('conversation');
  };

  const sendReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = selected ? (replyDrafts[selected.id] ?? '').trim() : '';
    if (!selected || !body) return;

    const sentMessage: TicketMessage = {
      id: `${selected.id}-${Date.now()}`,
      author: 'support',
      body,
      time: 'Just now',
    };

    setMessages((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), sentMessage],
    }));
    setTickets((current) => current.map((ticket) =>
      ticket.id === selected.id
        ? { ...ticket, preview: `You: ${body}`, time: 'Just now', status: 'Pending' }
        : ticket,
    ));
    setReplyDrafts((current) => ({ ...current, [selected.id]: '' }));
  };

  const updateSelectedStatus = (status: TicketStatus) => {
    if (!selected) return;
    setTickets((current) => current.map((ticket) =>
      ticket.id === selected.id ? { ...ticket, status } : ticket,
    ));
  };

  const suggestReply = () => {
    if (!selected) return;
    const draft = `Hi ${selected.name.split(' ')[0]}, thanks for the details. I’m checking this for ${selected.store}. Could you confirm the last time you ran Cloud Sync on each device? I’ll follow up once I’ve reviewed the records.`;
    setAiReplies((current) => ({ ...current, [selected.id]: draft }));
  };

  const askHelper = () => {
    if (!selected) return;
    const question = (aiPrompts[selected.id] ?? '').trim();
    const guidance = question
      ? `Sample guidance for “${question}”: confirm the store ID, check the latest cloud sync time on each device, and compare the affected records before making changes.`
      : 'Add a question about this ticket to get a sample guidance response.';
    setAiReplies((current) => ({ ...current, [selected.id]: guidance }));
  };

  const useAiReply = () => {
    if (!selected || !aiReply) return;
    setReplyDrafts((current) => ({ ...current, [selected.id]: aiReply }));
  };

  return (
    <section className="mx-auto flex min-h-[min(78vh,900px)] max-w-[1500px] flex-col gap-4 text-slate-900 dark:text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
            Administrator portal
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
            Support desk
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Review store-owner requests, reply, and prepare a suggested response.
          </p>
        </div>
        <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-200">
          <span className="size-2 rounded-full bg-blue-500 dark:bg-blue-300" aria-hidden="true" />
          Sample inbox · {tickets.length} tickets · {openCount} open
        </span>
      </header>

      <div className="grid min-h-[38rem] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950/70 lg:grid-cols-[minmax(17rem,19rem)_minmax(0,1fr)_minmax(16rem,18rem)]">
        <aside
          aria-label="Support inbox"
          className={`${mobilePane === 'conversation' ? 'hidden' : 'flex'} min-h-[32rem] flex-col border-b border-slate-200 dark:border-slate-700 lg:flex lg:border-b-0 lg:border-r`}
        >
          <div className="border-b border-slate-200 p-4 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Inbox</h2>
            <label className="relative mt-3 block">
              <span className="sr-only">Search support tickets</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tickets"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-1" role="group" aria-label="Filter tickets by status">
              {filters.map((item) => {
                const count = item === 'All' ? tickets.length : tickets.filter((ticket) => ticket.status === item).length;
                const active = filter === item;

                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    aria-pressed={active}
                    className={`inline-flex min-h-11 w-full items-center justify-between gap-1.5 rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                  >
                    {item}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredTickets.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <Search className="size-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">No matching tickets</p>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Try another search or select a different status.</p>
                <button
                  type="button"
                  onClick={() => { setSearch(''); setFilter('All'); }}
                  className="mt-3 inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-500/10"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              filteredTickets.map((ticket) => {
                const active = selected?.id === ticket.id;

                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => selectTicket(ticket.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full border-b border-slate-100 p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:border-slate-800 ${active ? 'bg-blue-50/80 dark:bg-blue-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-900'}`}
                  >
                    <span className="flex items-start gap-3">
                      <span className={`grid size-10 shrink-0 place-items-center rounded-full text-xs font-bold ${active ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200'}`}>
                        {ticket.initials}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{ticket.name}</span>
                          <time className="shrink-0 pt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{ticket.time}</time>
                        </span>
                        <span className="mt-1 block truncate text-xs text-slate-700 dark:text-slate-300">{ticket.subject}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusStyles[ticket.status]}`}>{ticket.status}</span>
                          {ticket.priority === 'High' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                              <span className="size-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                              High priority
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div
          role="region"
          aria-label="Ticket conversation"
          className={`${mobilePane === 'inbox' ? 'hidden' : 'flex'} min-h-[34rem] min-w-0 flex-col lg:flex`}
        >
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
                <div className="flex min-w-0 items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setMobilePane('inbox')}
                    aria-label="Back to inbox"
                    className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
                  >
                    <ArrowLeft className="size-5" aria-hidden="true" />
                  </button>
                  <span className="hidden size-10 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-bold text-blue-800 dark:bg-blue-500/15 dark:text-blue-200 sm:grid">
                    {selected.initials}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 text-base font-semibold leading-6 text-slate-950 dark:text-white">{selected.subject}</h2>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusStyles[selected.status]}`}>{selected.status}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {selected.name} <span aria-hidden="true">·</span> {selected.store} <span aria-hidden="true">·</span> {selected.id}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => updateSelectedStatus(selected.status === 'Resolved' ? 'Open' : 'Resolved')}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {selected.status === 'Resolved' ? <Inbox className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                  {selected.status === 'Resolved' ? 'Reopen' : 'Resolve'}
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/70 p-4 sm:p-6 dark:bg-slate-950/50" aria-live="polite">
                <p className="text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">Ticket {selected.id} · {selected.time}</p>
                {selectedMessages.map((message) => {
                  const fromSupport = message.author === 'support';

                  return (
                    <div key={message.id} className={`flex ${fromSupport ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[88%] rounded-2xl px-4 py-3 ${fromSupport ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
                        <p className="text-[11px] font-semibold opacity-80">{fromSupport ? 'Support team' : `${selected.name} · ${selected.store}`}</p>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                        <p className={`mt-2 text-[10px] ${fromSupport ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'}`}>{message.time}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={sendReply} className="border-t border-slate-200 p-3 sm:p-4 dark:border-slate-700">
                <label htmlFor="support-reply" className="sr-only">Write a reply to {selected.name}</label>
                <div className="flex items-end gap-2">
                  <textarea
                    id="support-reply"
                    value={replyDraft}
                    onChange={(event) => {
                      if (!selected) return;
                      setReplyDrafts((current) => ({ ...current, [selected.id]: event.target.value }));
                    }}
                    placeholder="Write a clear reply…"
                    rows={2}
                    className="min-h-12 flex-1 resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    disabled={!replyDraft.trim()}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-950"
                    aria-label="Send reply"
                  >
                    <Send className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Replies are added to this local preview only.</p>
              </form>
            </>
          ) : (
            <div className="flex min-h-[34rem] flex-col items-center justify-center px-6 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <MessageSquare className="size-5" aria-hidden="true" />
              </span>
              <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">No ticket selected</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Clear the filters or choose a ticket from the inbox.</p>
              <button type="button" onClick={() => { setSearch(''); setFilter('All'); }} className="mt-3 inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10">Show all tickets</button>
            </div>
          )}
        </div>

        <aside aria-label="Ticket assistance and details" className={`${mobilePane === 'inbox' ? 'hidden' : 'flex'} flex-col border-t border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/70 lg:flex lg:border-l lg:border-t-0`}>
          <section>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
                  <Sparkles className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Reply helper</h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Sample output</p>
                </div>
              </div>
              <Bot className="size-4 text-violet-600 dark:text-violet-300" aria-hidden="true" />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Review and edit every suggestion before sending. This demo does not call an AI service.</p>

            {aiReply ? (
              <div className="mt-3 rounded-xl border border-violet-200 bg-white p-3 dark:border-violet-400/20 dark:bg-slate-950/70" aria-live="polite">
                <p className="text-xs leading-5 text-slate-700 dark:text-slate-200">{aiReply}</p>
                <button
                  type="button"
                  onClick={useAiReply}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-500/10"
                >
                  <Check className="size-4" aria-hidden="true" />
                  Use draft
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Create a draft to see a suggested reply here. You stay in control of what gets sent.
              </div>
            )}

            <button
              type="button"
              onClick={suggestReply}
              disabled={!selected}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:border-violet-400/20 dark:bg-slate-950/70 dark:text-violet-200 dark:hover:bg-violet-500/10"
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Create sample draft
            </button>

            <details className="group mt-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/50">
              <summary className="min-h-11 cursor-pointer list-none text-xs font-semibold text-slate-800 marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-slate-200">
                Ask for sample guidance
              </summary>
              <label htmlFor="ai-question" className="sr-only">Ask a question about this ticket</label>
              <textarea
                id="ai-question"
                value={aiPrompt}
                onChange={(event) => {
                  if (!selected) return;
                  setAiPrompts((current) => ({ ...current, [selected.id]: event.target.value }));
                }}
                disabled={!selected}
                placeholder="What should I check first?"
                rows={3}
                className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={askHelper}
                disabled={!selected}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-violet-700 px-3 text-xs font-semibold text-white transition hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50"
              >
                Ask helper
              </button>
            </details>
          </section>

          <section className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ticket details</h2>
            {selected ? (
              <dl className="mt-3 flex flex-col gap-3 text-xs">
                <div className="flex items-start justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">Requester</dt><dd className="text-right font-medium text-slate-800 dark:text-slate-200">{selected.name}</dd></div>
                <div className="flex items-start justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">Store</dt><dd className="text-right font-medium text-slate-800 dark:text-slate-200">{selected.store}</dd></div>
                <div className="flex items-start justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">Priority</dt><dd className={`font-semibold ${selected.priority === 'High' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-200'}`}>{selected.priority}</dd></div>
                <div className="flex items-start justify-between gap-3"><dt className="text-slate-500 dark:text-slate-400">Ticket ID</dt><dd className="font-mono font-medium text-slate-800 dark:text-slate-200">{selected.id}</dd></div>
              </dl>
            ) : (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Select a ticket to view its details.</p>
            )}
          </section>
        </aside>
      </div>

      <p className="inline-flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400" role="note">
        <Clock3 className="size-3.5" aria-hidden="true" />
        Prototype mode: tickets, replies, and helper output are example data and are not saved to a support service.
      </p>
    </section>
  );
}
