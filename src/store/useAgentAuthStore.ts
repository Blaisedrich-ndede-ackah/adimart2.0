import { create } from 'zustand';
import {
  LocalAgent,
  createLocalAgent,
  deleteLocalAgent,
  getLocalAgent,
  listLocalAgents,
  updateLocalAgent,
  verifyAgentPin,
} from '@/lib/dexie';

interface AgentAuthState {
  currentAgent: LocalAgent | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginError: string;

  initialize: () => Promise<void>;
  login: (phone: string, pin: string) => Promise<boolean>;
  logout: () => void;
  listAgents: () => Promise<LocalAgent[]>;
  createAgent: (agent: Omit<LocalAgent, 'synced'>) => Promise<void>;
  updateAgent: (id: string, patch: Partial<LocalAgent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  refreshAgent: () => Promise<void>;
}

export const useAgentAuthStore = create<AgentAuthState>((set, get) => ({
  currentAgent: null,
  isAuthenticated: false,
  isLoading: true,
  loginError: '',

  initialize: async () => {
    set({ isLoading: true });
    const agents = await listLocalAgents();
    // No auto-persist for agents; agent must log in with PIN each session.
    // Keep the last agent as a candidate for rehydration if desired.
    set({ isLoading: false, isAuthenticated: false, currentAgent: null });
  },

  login: async (phone: string, pin: string) => {
    set({ isLoading: true, loginError: '' });
    try {
      const agent = await verifyAgentPin(phone, pin);
      if (agent) {
        if (agent.status !== 'active') {
          set({ loginError: 'Your agent account is not active. Contact the administrator.', isLoading: false, isAuthenticated: false });
          return false;
        }
        // Update last login
        await updateLocalAgent(agent.id, { last_login_at: new Date().toISOString() });
        const refreshed = await getLocalAgent(agent.id);
        set({
          currentAgent: refreshed ?? agent,
          isAuthenticated: true,
          isLoading: false,
          loginError: '',
        });
        return true;
      }
      set({ loginError: 'Invalid phone or PIN.', isLoading: false, isAuthenticated: false });
      return false;
    } catch (error) {
      set({ loginError: error instanceof Error ? error.message : 'Login failed.', isLoading: false, isAuthenticated: false });
      return false;
    }
  },

  logout: () => {
    set({ currentAgent: null, isAuthenticated: false, loginError: '' });
  },

  listAgents: async () => listLocalAgents(),

  createAgent: async (agent) => {
    await createLocalAgent(agent);
  },

  updateAgent: async (id, patch) => {
    await updateLocalAgent(id, patch);
  },

  deleteAgent: async (id) => {
    await deleteLocalAgent(id);
  },

  refreshAgent: async () => {
    const agent = get().currentAgent;
    if (!agent) return;
    const refreshed = await getLocalAgent(agent.id);
    set({ currentAgent: refreshed ?? agent });
  },
}));
