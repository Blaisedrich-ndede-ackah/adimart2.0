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
  updateUserPhoto,
} from '@/lib/dexie';
import { clearAllWarehouseSessions, clearWarehouseUnlock } from '@/lib/warehouseAccess';
import { applyStoreLanguageDefault, tNow } from '@/lib/i18n';
import {
  isSessionIdle,
  markIdleLock,
  normalizeSessionTimeoutMinutes,
  touchLastActivity,
} from '@/lib/sessionTimeout';
import { useCartStore } from '@/store/useCartStore';
import { recordLogin, recordLogout } from '@/lib/activityLog';

interface AuthState {
  currentUser: LocalUser | null;
  currentStore: LocalStore | null;
  isAuthenticated: boolean;
  isStoreSetup: boolean;
  loginError: string;
  startupError: string;
  isLoading: boolean;
  
  initialize: (localOnly?: boolean) => Promise<void>;
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
  setMyPhoto: (photoUrl: string) => Promise<void>;
  setStoreSetup: (value: boolean) => void;
}

function refreshLimitsInBackground(
  storeId: string,
  onUpdated: (store: LocalStore) => void
): void {
  void pullAdminStoreLimits(storeId)
    .then((store) => {
      if (store) onUpdated(store);
    })
    .catch((error: unknown) => {
      console.warn('[Startup] Could not refresh store limits from cloud:', error);
    });
}

let authInitializationAttempt = 0;
const AUTH_INITIALIZATION_TIMEOUT_MS = 15_000;

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  currentStore: null,
  isAuthenticated: false,
  isStoreSetup: false,
  loginError: '',
  startupError: '',
  isLoading: true,

  initialize: async (localOnly = false) => {
    const attempt = ++authInitializationAttempt;
    set({ isLoading: true, startupError: '' });
    const timeoutId = globalThis.setTimeout(() => {
      if (attempt !== authInitializationAttempt) return;
      console.error('[Startup] Local store initialization timed out.');
      set({ startupError: 'startup_timeout', isLoading: false });
    }, AUTH_INITIALIZATION_TIMEOUT_MS);
    try {
      const hasStore = await hasAnyStore();
      if (attempt !== authInitializationAttempt) return;
      if (!hasStore) {
        set({
          isStoreSetup: false,
          isLoading: false,
          currentStore: null,
          currentUser: null,
          isAuthenticated: false,
          startupError: '',
        });
        return;
      }

      const store = await getCurrentStore();
      if (attempt !== authInitializationAttempt) return;
      if (store?.id) applyStoreLanguageDefault(store.preferred_language);

      const persistedUser = await getPersistedCurrentUser();
      if (attempt !== authInitializationAttempt) return;
      if (persistedUser) {
        const timeoutMinutes = normalizeSessionTimeoutMinutes(store?.session_timeout_minutes);
        if (store?.id && isSessionIdle(store.id, timeoutMinutes)) {
          await setCurrentUserId(null);
          if (attempt !== authInitializationAttempt) return;
          markIdleLock();
          useCartStore.getState().clearCart();
          useCartStore.getState().clearParkedCarts();
          set({
            currentStore: store,
            currentUser: null,
            isAuthenticated: false,
            isStoreSetup: true,
            loginError: '',
            startupError: '',
            isLoading: false,
          });
          if (!localOnly && store.id) {
            refreshLimitsInBackground(store.id, (updated) => {
              if (get().currentStore?.id === store.id) set({ currentStore: updated });
            });
          }
          return;
        }
        set({
          currentStore: store,
          currentUser: persistedUser,
          isAuthenticated: true,
          isStoreSetup: true,
          loginError: '',
          startupError: '',
          isLoading: false,
        });
        if (!localOnly && store?.id) {
          refreshLimitsInBackground(store.id, (updated) => {
            if (get().currentStore?.id === store.id) set({ currentStore: updated });
          });
          void refreshStockFromCloud();
        }
        return;
      }

      set({
        currentStore: store,
        currentUser: null,
        isAuthenticated: false,
        isStoreSetup: true,
        startupError: '',
        isLoading: false,
      });
      if (!localOnly && store?.id) {
        refreshLimitsInBackground(store.id, (updated) => {
          if (get().currentStore?.id === store.id) set({ currentStore: updated });
        });
      }
    } catch (error) {
      if (attempt !== authInitializationAttempt) return;
      console.error('[Startup] Could not initialize the local store:', error);
      set({
        startupError: error instanceof Error ? error.message : 'startup_failed',
        isLoading: false,
      });
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  },

  login: async (pin: string) => {
    const storeId = await getCurrentStoreId();
    if (!storeId) {
      set({ loginError: tNow('login.noStore') });
      return false;
    }

    let user: LocalUser | null;
    try {
      user = await authenticateByPin(pin);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not verify PIN securely.';
      set({ loginError: message });
      return false;
    }
    if (user) {
      clearAllWarehouseSessions();
      await setCurrentUserId(user.id);
      touchLastActivity(storeId);
      const store = (await pullAdminStoreLimits(storeId)) || (await getCurrentStore());
      void refreshStockFromCloud();
      set({ 
        currentUser: user, 
        currentStore: store,
        isAuthenticated: true, 
        loginError: '' 
      });
      if (store?.id) {
        recordLogin({
          storeId: store.id,
          storeName: store.name,
          userId: user.id,
          username: user.name,
          role: user.role,
        });
      }
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
    if (storeId) touchLastActivity(storeId);
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
    if (store?.id) {
      recordLogin({
        storeId: store.id,
        storeName: store.name,
        userId: owner.id,
        username: owner.name,
        role: owner.role,
      });
    }
    return true;
  },

  logout: () => {
    recordLogout();
    clearAllWarehouseSessions();
    void setCurrentUserId(null);
    set({ currentUser: null, isAuthenticated: false, loginError: '' });
  },

  switchUser: () => {
    recordLogout();
    // Keep any pending warehouse login set by Settings → Open warehouse
    clearWarehouseUnlock();
    void setCurrentUserId(null);
    set({ currentUser: null, isAuthenticated: false, loginError: '' });
  },

  switchStore: async (storeId: string) => {
    recordLogout();
    clearAllWarehouseSessions();
    useCartStore.getState().clearParkedCarts();
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

  setMyPhoto: async (photoUrl: string) => {
    const user = get().currentUser;
    if (!user) throw new Error('Not signed in');
    await updateUserPhoto(user.id, photoUrl);
    const refreshed = await (await import('@/lib/dexie')).db.users.get(user.id);
    if (refreshed) set({ currentUser: refreshed });
  },

  setStoreSetup: (value: boolean) => {
    set({ isStoreSetup: value });
  },
}));
