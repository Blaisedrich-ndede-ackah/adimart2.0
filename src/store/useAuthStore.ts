import { create } from 'zustand';
import { 
  LocalUser, 
  LocalStore,
  authenticateByPin, 
  verifyOwnerPin as dbVerifyOwnerPin,
  getActiveStoreOwner,
  getCurrentStoreUsers,
  getCurrentStore,
  getCurrentStoreId,
  getPersistedCurrentUser,
  hasAnyStore,
  listLocalStores,
  pullAdminStoreLimits,
  refreshStockFromCloud,
  setCurrentUserId,
  switchToStore,
  updateUserPhone,
} from '@/lib/dexie';
import { clearAllWarehouseSessions, clearWarehouseUnlock } from '@/lib/warehouseAccess';
import { applyStoreLanguageDefault, tNow } from '@/lib/i18n';

interface AuthState {
  currentUser: LocalUser | null;
  currentStore: LocalStore | null;
  isAuthenticated: boolean;
  isStoreSetup: boolean;
  loginError: string;
  isLoading: boolean;
  
  initialize: () => Promise<void>;
  login: (pin: string) => Promise<boolean>;
  /** After warehouse PIN succeeds — enter as the store owner. */
  loginAsStoreOwner: () => Promise<boolean>;
  logout: () => void;
  switchUser: () => void;
  /** Switch active store and require a fresh login for that store. */
  switchStore: (storeId: string) => Promise<void>;
  listStores: () => Promise<LocalStore[]>;
  verifyOwnerPin: (pin: string) => Promise<boolean>;
  getAllUsers: () => Promise<LocalUser[]>;
  refreshStore: () => Promise<void>;
  updateMyPhone: (phone: string) => Promise<void>;
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
      set({
        isStoreSetup: false,
        isLoading: false,
        currentStore: null,
        currentUser: null,
        isAuthenticated: false,
      });
      return;
    }
    
    let store = await getCurrentStore();
    if (store?.id) {
      store = (await pullAdminStoreLimits(store.id)) || store;
      applyStoreLanguageDefault(store.preferred_language);
    }

    const persistedUser = await getPersistedCurrentUser();
    if (persistedUser) {
      set({
        currentStore: store,
        currentUser: persistedUser,
        isAuthenticated: true,
        isStoreSetup: true,
        loginError: '',
      });
      void refreshStockFromCloud();
      set({ isLoading: false });
      return;
    }

    set({
      currentStore: store,
      currentUser: null,
      isAuthenticated: false,
      isStoreSetup: true,
      isLoading: false,
    });
  },

  login: async (pin: string) => {
    const storeId = await getCurrentStoreId();
    if (!storeId) {
      set({ loginError: tNow('login.noStore') });
      return false;
    }

    const user = await authenticateByPin(pin);
    if (user) {
      clearAllWarehouseSessions();
      await setCurrentUserId(user.id);
      const store = (await pullAdminStoreLimits(storeId)) || (await getCurrentStore());
      void refreshStockFromCloud();
      set({ 
        currentUser: user, 
        currentStore: store,
        isAuthenticated: true, 
        loginError: '' 
      });
      return true;
    }
    
    set({ loginError: tNow('login.invalidPin') });
    return false;
  },

  loginAsStoreOwner: async () => {
    const owner = await getActiveStoreOwner();
    if (!owner) {
      set({ loginError: 'No active store owner found for this warehouse.' });
      return false;
    }
    await setCurrentUserId(owner.id);
    const storeId = await getCurrentStoreId();
    const store = storeId
      ? (await pullAdminStoreLimits(storeId)) || (await getCurrentStore())
      : await getCurrentStore();
    void refreshStockFromCloud();
    set({
      currentUser: owner,
      currentStore: store,
      isAuthenticated: true,
      loginError: '',
    });
    return true;
  },

  logout: () => {
    clearAllWarehouseSessions();
    void setCurrentUserId(null);
    set({ currentUser: null, isAuthenticated: false, loginError: '' });
  },

  switchUser: () => {
    // Keep any pending warehouse login set by Settings → Open warehouse
    clearWarehouseUnlock();
    void setCurrentUserId(null);
    set({ currentUser: null, isAuthenticated: false, loginError: '' });
  },

  switchStore: async (storeId: string) => {
    clearAllWarehouseSessions();
    const store = await switchToStore(storeId);
    // switchToStore clears persisted user via setCurrentStoreId
    const refreshed = (await pullAdminStoreLimits(storeId)) || store;
    applyStoreLanguageDefault(refreshed.preferred_language);
    set({
      currentStore: refreshed,
      currentUser: null,
      isAuthenticated: false,
      isStoreSetup: true,
      loginError: '',
    });
  },

  listStores: async () => listLocalStores(),

  verifyOwnerPin: async (pin: string) => {
    return dbVerifyOwnerPin(pin);
  },

  getAllUsers: async () => {
    return getCurrentStoreUsers();
  },

  refreshStore: async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) {
      set({ currentStore: null });
      return;
    }
    const store = (await pullAdminStoreLimits(storeId)) || (await getCurrentStore());
    set({ currentStore: store });
  },

  updateMyPhone: async (phone: string) => {
    const user = get().currentUser;
    if (!user) throw new Error('Not signed in');
    const saved = await updateUserPhone(user.id, phone);
    const refreshed = await (await import('@/lib/dexie')).db.users.get(user.id);
    set({
      currentUser: refreshed
        ? refreshed
        : { ...user, phone: saved },
    });
  },

  setStoreSetup: (value: boolean) => {
    set({ isStoreSetup: value });
  },
}));
