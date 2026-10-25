import { useMemo, useState } from 'react';
import { Bot, Check, Clock3, Inbox, MessageSquare, MoreHorizontal, Search, Send, Sparkles } from 'lucide-react';

type TicketStatus = 'Open' | 'Pending' | 'Resolved';

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

const initialTickets: SupportTicket[] = [
  { id: 'AD-1048', name: 'Ama Mensah', store: 'Ama Beauty Store', subject: 'Sales totals are different on my devices', preview: 'The phone and computer show different totals after syncing.', time: '8 min ago', status: 'Open', priority: 'High', initials: 'AM' },
  { id: 'AD-1047', name: 'Kwame Boateng', store: 'K. Boateng Mart', subject: 'How do I restore a store branch?', preview: 'I want to add my existing store to a new tablet.', time: '32 min ago', status: 'Pending', priority: 'Normal', initials: 'KB' },
  { id: 'AD-1046', name: 'Esi Owusu', store: 'Esi Cosmetics', subject: 'Subscription payment question', preview: 'Can I change the phone number used for alerts?', time: '1 hr ago', status: 'Open', priority: 'Normal', initials: 'EO' },
  { id: 'AD-1045', name: 'Yaw Asante', store: 'Asante Provision Shop', subject: 'Bluetooth printer is not connecting', preview: 'The printer worked yesterday but is not showing today.', time: '3 hrs ago', status: 'Resolved', priority: 'Normal', initials: 'YA' },
];

const statusStyles: Record<TicketStatus, string> = {
  Open: 'bg-blue-500/15 text-blue-300',
  Pending: 'bg-amber-500/15 text-amber-300',
  Resolved: 'bg-slate-500/15 text-slate-300',
};

export default function AdminSupportAgent() {
  const [tickets, setTickets] = useState(initialTickets);
  const [selectedId, setSelectedId] = useState(initialTickets[0].id);
  const [filter, setFilter] = useState<'All' | TicketStatus>('All');
  const [search, setSearch] = useState('');
  const [reply, setReply] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiReply, setAiReply] = useState('I can help you find a fast, clear response for this store owner.');

  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0];
  const filteredTickets = useMemo(() => tickets.filter((ticket) => {
    const matchesFilter = filter === 'All' || ticket.status === filter;
    const query = search.trim().toLowerCase();
    return matchesFilter && (!query || `${ticket.name} ${ticket.store} ${ticket.subject}`.toLowerCase().includes(query));
  }), [filter, search, tickets]);

  const sendReply = () => {
    if (!reply.trim()) return;
    setReply('');
    setTickets((current) => current.map((ticket) => ticket.id === selected.id ? { ...ticket, preview: 'You replied: ' + reply.trim(), time: 'Just now', status: 'Pending' } : ticket));
  };

  const suggestReply = () => {
    setAiReply('Thanks for reporting this. I’m checking the store sync history now. Please keep both devices online and run Cloud Sync once; I’ll compare the sales records and follow up with the exact mismatch.');
  };

  return (
    <section className="flex min-h-[calc(100vh-10rem)] flex-col gap-4 text-slate-100">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Customer support</p>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Support agent workspace</h1>
          <p className="mt-1 text-sm text-slate-400">Resolve store-owner questions, manage tickets, and draft replies with AI assistance.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300"><span className="size-2 rounded-full bg-blue-400" /> 3 agents online</div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Open tickets', '24', Inbox], ['Needs reply', '8', MessageSquare], ['Resolved today', '17', Check], ['Avg. response', '12m', Clock3]].map(([label, value, Icon]) => (
          <div key={label as string} className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/10">
            <div className="flex items-center justify-between text-xs text-slate-400"><span>{label as string}</span><Icon className="size-4 text-blue-300" /></div>
            <p className="mt-3 text-2xl font-semibold text-white">{value as string}</p>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/50 lg:grid-cols-[320px_minmax(0,1fr)_280px]">
        <aside className="flex min-h-[28rem] flex-col border-b border-slate-700/80 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-700/80 p-3">
            <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tickets" className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500" /></div>
            <div className="mt-3 flex gap-1 overflow-auto">{(['All', 'Open', 'Pending', 'Resolved'] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${filter === item ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>{item}</button>)}</div>
          </div>
          <div className="flex-1 overflow-y-auto">{filteredTickets.map((ticket) => <button key={ticket.id} onClick={() => setSelectedId(ticket.id)} className={`w-full border-b border-slate-800 p-4 text-left transition ${selected.id === ticket.id ? 'bg-blue-500/10' : 'hover:bg-slate-900'}`}><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-200">{ticket.initials}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-sm text-slate-100">{ticket.name}</strong><time className="shrink-0 text-[10px] text-slate-500">{ticket.time}</time></span><span className="mt-1 block truncate text-xs text-slate-400">{ticket.subject}</span><span className="mt-2 flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyles[ticket.status]}`}>{ticket.status}</span>{ticket.priority === 'High' && <span className="text-[10px] font-semibold text-rose-300">High priority</span>}</span></span></div></button>)}</div>
        </aside>

        <main className="flex min-h-[34rem] flex-col">
          <div className="flex items-center justify-between border-b border-slate-700/80 p-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-blue-500/15 text-sm font-bold text-blue-200">{selected.initials}</span><div><h2 className="font-semibold text-white">{selected.subject}</h2><p className="text-xs text-slate-400">{selected.name} · {selected.store} · {selected.id}</p></div></div><button className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><MoreHorizontal className="size-5" /></button></div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4"><div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-slate-700 bg-slate-900 p-4"><p className="text-sm leading-6 text-slate-200">{selected.preview}</p><p className="mt-2 text-[11px] text-slate-500">Store owner · {selected.time}</p></div><div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-blue-600/90 p-4"><p className="text-sm leading-6 text-white">Hi {selected.name.split(' ')[0]}, thanks for reaching out. I’m looking into this and will get back to you shortly.</p><p className="mt-2 text-[11px] text-blue-100">Support team · Today</p></div></div>
          <div className="border-t border-slate-700/80 p-3"><div className="flex gap-2"><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a reply…" rows={2} className="min-h-12 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-500" /><button onClick={sendReply} className="self-end rounded-xl bg-blue-600 p-3 text-white hover:bg-blue-500" aria-label="Send reply"><Send className="size-4" /></button></div></div>
        </main>

        <aside className="border-t border-slate-700/80 bg-slate-900/40 p-4 lg:border-l lg:border-t-0"><div className="flex items-center gap-2"><Sparkles className="size-4 text-violet-300" /><h2 className="font-semibold text-white">AI copilot</h2></div><p className="mt-1 text-xs leading-5 text-slate-400">Draft helpful replies while keeping the agent in control.</p><div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-500/10 p-3"><p className="text-xs leading-5 text-slate-200">{aiReply}</p><button onClick={() => setReply(aiReply)} className="mt-3 text-xs font-semibold text-violet-300 hover:text-violet-200">Use this reply</button></div><button onClick={suggestReply} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-semibold text-slate-200 hover:border-violet-400/50"><Bot className="size-4" /> Suggest a reply</button><div className="mt-6"><label className="text-xs font-semibold text-slate-300" htmlFor="ai-question">Ask about this ticket</label><textarea id="ai-question" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="e.g. What should I check first?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-400" /><button onClick={() => setAiReply(aiPrompt.trim() ? `Based on this ticket, start by checking the store sync status and the last successful cloud upload. ${aiPrompt.trim()}` : 'Ask a question about the selected ticket.')} className="mt-2 w-full rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-violet-500">Ask AI</button></div><div className="mt-6 border-t border-slate-700/80 pt-4"><p className="text-xs font-semibold text-slate-300">Ticket details</p><div className="mt-3 space-y-3 text-xs"><div className="flex justify-between gap-3"><span className="text-slate-500">Status</span><span className={`rounded-full px-2 py-0.5 ${statusStyles[selected.status]}`}>{selected.status}</span></div><div className="flex justify-between gap-3"><span className="text-slate-500">Assignee</span><span className="text-slate-200">You</span></div><div className="flex justify-between gap-3"><span className="text-slate-500">Store</span><span className="truncate text-slate-200">{selected.store}</span></div></div></div></aside>
      </div>
    </section>
  );
}
