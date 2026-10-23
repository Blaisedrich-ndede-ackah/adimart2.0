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
    <div className="flex h-full min-h-0 flex-col bg-[#F2F2F7]">
      <header className="ios-bar flex items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">Adimat agent</p>
          <h1 className="truncate text-[22px] font-bold tracking-tight text-ink md:text-[28px]">{agent?.full_name || 'Agent portal'}</h1>
        </div>
        <button
          type="button"
          onClick={leave}
          className="inline-flex min-h-11 items-center gap-1 rounded-full bg-black/[0.05] px-3 py-2 text-[13px] font-semibold text-primary"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </header>
      <nav className="hidden gap-1 overflow-x-auto border-b border-black/10 bg-[#F2F2F7] px-4 py-2 md:flex md:px-6">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = screen === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setScreen(item.id)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-[15px] font-medium ${
                active ? 'bg-white text-primary shadow-[0_0_0_0.5px_rgba(60,60,67,0.12)]' : 'text-muted'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
      {syncNote && (
        <p className="border-b border-black/5 bg-white px-4 py-2 text-[13px] text-ink md:px-6">{syncNote}</p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6">
        {screen === 'home' && <AgentDashboardPage onNavigate={setScreen} />}
        {screen === 'prospects' && <AgentProspectsPage onCreateInvoice={() => setScreen('invoices')} />}
        {screen === 'followups' && <AgentFollowUpsPage />}
        {screen === 'invoices' && <AgentInvoicesPage />}
        {screen === 'wallet' && <AgentWalletPage />}
      </div>
      <nav
        className="ios-tabbar fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 md:hidden"
        style={{
          left: 'env(safe-area-inset-left)',
          right: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = screen === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setScreen(item.id)}
              data-active={active}
              className="ios-tab-item flex flex-col items-center gap-0.5 px-1 py-1.5 text-[10px] font-medium"
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.8} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
