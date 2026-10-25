import { useEffect, useState } from 'react';
import { Clock, FileText, LayoutDashboard, LogOut, Users, Wallet } from 'lucide-react';
import { useAgentAuthStore } from '@/store/useAgentAuthStore';
import { syncAgentPortal } from '@/lib/agentPortal';
import AgentDashboardPage from '@/pages/AgentDashboardPage';
import AgentProspectsPage from '@/pages/AgentProspectsPage';
import AgentInvoicesPage from '@/pages/AgentInvoicesPage';
import AgentFollowUpsPage from '@/pages/AgentFollowUpsPage';
import AgentWalletPage from '@/pages/AgentWalletPage';

export type AgentScreen = 'home' | 'prospects' | 'invoices' | 'followups' | 'wallet';

const NAV: { id: AgentScreen; label: string; icon: typeof Users }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'prospects', label: 'Prospects', icon: Users },
  { id: 'followups', label: 'Follow-ups', icon: Clock },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
];

interface AgentShellProps {
  onLogout: () => void;
}

export default function AgentShell({ onLogout }: AgentShellProps) {
  const [screen, setScreen] = useState<AgentScreen>('home');
  const [syncNote, setSyncNote] = useState('');
  const logout = useAgentAuthStore((state) => state.logout);
  const agent = useAgentAuthStore((state) => state.currentAgent);

  useEffect(() => {
    void syncAgentPortal().then((result) => setSyncNote(result.message));
  }, []);

  const leave = () => {
    logout();
    onLogout();
  };

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <header className="bg-emerald-700 text-white px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-emerald-100">Adimat agent</p>
          <h1 className="text-base font-bold truncate">{agent?.full_name || 'Agent portal'}</h1>
        </div>
        <button
          type="button"
          onClick={leave}
          className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </header>
      {syncNote && (
        <p className="px-4 py-2 text-xs text-emerald-900 bg-emerald-50 border-b border-emerald-100">{syncNote}</p>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        {screen === 'home' && <AgentDashboardPage onNavigate={setScreen} />}
        {screen === 'prospects' && <AgentProspectsPage onCreateInvoice={() => setScreen('invoices')} />}
        {screen === 'followups' && <AgentFollowUpsPage />}
        {screen === 'invoices' && <AgentInvoicesPage />}
        {screen === 'wallet' && <AgentWalletPage />}
      </div>
      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-emerald-100 bg-white grid grid-cols-5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = screen === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setScreen(item.id)}
              className={`flex flex-col items-center gap-1 py-2 text-[11px] font-semibold ${
                active ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
