import { create } from 'zustand';
import { 
  LocalUser, 
  LocalStore,
  authenticateByPin, 
  verifyOwnerPin as dbVerifyOwnerPin,
  getCurrentStoreUsers,
  getCurrentStore,
  getCurrentStoreId,
  hasAnyStore
} from '@/lib/dexie';

interface AuthState {
  currentUser: LocalUser | null;
  currentStore: LocalStore | null;
  isAuthenticated: boolean;
  isStoreSetup: boolean;
  loginError: string;
  isLoading: boolean;
  
  initialize: () => Promise<void>;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  switchUser: () => void;
  verifyOwnerPin: (pin: string) => Promise<boolean>;
  getAllUsers: () => Promise<LocalUser[]>;
  refreshStore: () => Promise<void>;
  setStoreSetup: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  currentStore: null,
  isAuthenticated: false,
  isStoreSetup: false,
  loginError: '',
  isLoading: true,

  initialize: async () => {
    set({ isLoading: true });
    
    const hasStore = await hasAnyStore();
    if (!hasStore) {
      set({ isStoreSetup: false, isLoading: false });
      return;
    }
    
    const store = await getCurrentStore();
    set({ 
      currentStore: store, 
      isStoreSetup: true, 
      isLoading: false 
    });
  },

  login: async (pin: string) => {
    const storeId = await getCurrentStoreId();
    if (!storeId) {
      set({ loginError: 'No store configured. Please set up your store first.' });
      return false;
    }

    const user = await authenticateByPin(pin);
    if (user) {
      const store = await getCurrentStore();
      set({ 
        currentUser: user, 
        currentStore: store,
        isAuthenticated: true, 
        loginError: '' 
      });
      return true;
    }
    
    set({ loginError: 'Invalid PIN. Please try again.' });
    return false;
  },

  logout: () => {
    set({ currentUser: null, isAuthenticated: false, loginError: '' });
  },

  switchUser: () => {
    set({ currentUser: null, isAuthenticated: false, loginError: '' });
  },

  verifyOwnerPin: async (pin: string) => {
    return dbVerifyOwnerPin(pin);
  },

  getAllUsers: async () => {
    return getCurrentStoreUsers();
  },

  refreshStore: async () => {
    const store = await getCurrentStore();
    set({ currentStore: store });
  },

  setStoreSetup: (value: boolean) => {
    set({ isStoreSetup: value });
  },
}));
