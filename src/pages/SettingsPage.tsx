import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Store, Shield, Percent, RefreshCcw,
  Save, Loader2, CheckCircle2, WifiOff, UserPlus,
  Trash2, Users, Fingerprint, AlertCircle, Key, Smartphone, Ban, ImagePlus
} from 'lucide-react';
import ChangePinModal from '@/components/ChangePinModal';
import ResetUserPinModal from '@/components/ResetUserPinModal';
import BluetoothHardwareSettings from '@/components/BluetoothHardwareSettings';
import { 
  db, 
  LocalUser,
  LocalLocation,
  syncToSupabase,
  syncFromSupabase,
  syncBidirectional,
  getLastSyncTime, 
  getCurrentStoreId,
  getCurrentStoreUsersIncludingBlocked,
  addUserToStore,
  deleteUser,
  deactivateUser,
  activateUser,
} from '@/lib/dexie';
import { ensureStoreLocations, listLocations } from '@/lib/warehouse';
import { isAutoSyncEnabled, setAutoSyncEnabled, startAutoSync, stopAutoSync } from '@/lib/sync';
import { useAuthStore } from '@/store/useAuthStore';
import { isBiometricAvailable, registerBiometric, hasBiometricRegistered, clearBiometricRegistration } from '@/lib/biometric';
import { isSupabaseConfigured } from '@/lib/supabase';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { fileToStoreLogoDataUrl, hasStoreLogo } from '@/lib/productImage';
import StoresPortalSection from '@/components/StoresPortalSection';
import WarehousePortalSection from '@/components/WarehousePortalSection';

interface SettingsPageProps {
  onNavigate?: (page: string) => void;
}

export default function SettingsPage({ onNavigate }: SettingsPageProps) {
  const { currentUser, currentStore, refreshStore } = useAuthStore();
  const logoInputRef = useRef<HTMLInputElement>(null);
  
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [supportNumber, setSupportNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [discountCap, setDiscountCap] = useState('10');
  const [pinOnDiscount, setPinOnDiscount] = useState(true);
  const [allowPercentage, setAllowPercentage] = useState(true);
  const [allowFixed, setAllowFixed] = useState(true);
  const [cashierCanDiscount, setCashierCanDiscount] = useState(true);
  const [momoAccountName, setMomoAccountName] = useState('');
  const [momoNumber, setMomoNumber] = useState('');
  const [momoNetwork, setMomoNetwork] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  
  const [syncStatus, setSyncStatus] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [supabaseReady, setSupabaseReady] = useState(false);
  const [autoSync, setAutoSync] = useState(isAutoSyncEnabled());
  const [storeId, setStoreId] = useState<string | null>(null);
  
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserPin, setNewUserPin] = useState('');
  const [newUserRole, setNewUserRole] = useState<'cashier' | 'owner'>('cashier');
  const [addUserError, setAddUserError] = useState('');

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [registeringBiometric, setRegisteringBiometric] = useState(false);
  const [biometricError, setBiometricError] = useState('');
  
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [resetPinUser, setResetPinUser] = useState<LocalUser | null>(null);
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [permUserId, setPermUserId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (currentStore) {
      setStoreName(currentStore.name);
      setStoreAddress(currentStore.address);
      setSupportNumber(currentStore.support_number);
      setLogoUrl(currentStore.logo_url || '');
      setDiscountCap(String(currentStore.discount_cap_percentage));
      setPinOnDiscount(currentStore.pin_on_discount_enabled === 1);
      setAllowPercentage((currentStore.discount_allow_percentage ?? 1) === 1);
      setAllowFixed((currentStore.discount_allow_fixed ?? 1) === 1);
      setCashierCanDiscount((currentStore.cashier_can_discount ?? 1) === 1);
      setMomoAccountName(currentStore.momo_account_name || '');
      setMomoNumber(currentStore.momo_number || '');
      setMomoNetwork(currentStore.momo_network || '');
      await ensureStoreLocations(currentStore.id);
      setLocations(await listLocations(currentStore.id));
    }
    
    const syncTime = await getLastSyncTime();
    setLastSync(syncTime);
    setSupabaseReady(isSupabaseConfigured());
    setStoreId(await getCurrentStoreId());
    setAutoSync(isAutoSyncEnabled());

    const storeUsers = await getCurrentStoreUsersIncludingBlocked();
    setUsers(storeUsers);

    const bioAvailable = await isBiometricAvailable();
    setBiometricSupported(bioAvailable);
    setBiometricRegistered(hasBiometricRegistered());
  }, [currentStore]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    const storeId = await getCurrentStoreId();
    if (!storeId) return;
    
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    
    try {
      if (!storeName.trim()) {
        setSaveError('Store name is required.');
        setSaving(false);
        return;
      }
      if (!storeAddress.trim()) {
        setSaveError('Store address is required.');
        setSaving(false);
        return;
      }
      if (!supportNumber.trim()) {
        setSaveError('Support phone number is required.');
        setSaving(false);
        return;
      }
      if (!isValidGhanaPhone(supportNumber)) {
        setSaveError('Enter a valid Ghana phone number (e.g. 024XXXXXXX or +23324XXXXXXX).');
        setSaving(false);
        return;
      }
      if (!allowPercentage && !allowFixed) {
        setSaveError('Enable at least one discount type (percentage or fixed).');
        setSaving(false);
        return;
      }

      await db.stores.update(storeId, {
        name: storeName.trim(),
        address: storeAddress.trim(),
        support_number: supportNumber.trim(),
        logo_url: logoUrl || '',
        discount_cap_percentage: Math.max(0, Math.min(100, parseInt(discountCap) || 10)),
        pin_on_discount_enabled: pinOnDiscount ? 1 : 0,
        discount_allow_percentage: allowPercentage ? 1 : 0,
        discount_allow_fixed: allowFixed ? 1 : 0,
        cashier_can_discount: cashierCanDiscount ? 1 : 0,
        momo_account_name: momoAccountName.trim(),
        momo_number: momoNumber.trim(),
        momo_network: momoNetwork.trim(),
        synced: 0,
      });
      
      await refreshStore();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError('Failed to save: ' + msg);
    }
    
    setSaving(false);
  };

  const handleLogoPick = async (file: File | null) => {
    if (!file) return;
    setLogoBusy(true);
    setSaveError('');
    try {
      const dataUrl = await fileToStoreLogoDataUrl(file);
      setLogoUrl(dataUrl);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to process logo');
    }
    setLogoBusy(false);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleSync = async (mode: 'push' | 'pull' | 'full' = 'push') => {
    if (!supabaseReady) {
      setSyncStatus('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.');
      return;
    }
    
    setIsSyncing(true);
    setSyncStatus(
      mode === 'pull' ? 'Pulling from cloud...' :
      mode === 'full' ? 'Running full sync...' :
      'Pushing to cloud...'
    );
    
    try {
      const result =
        mode === 'pull' ? await syncFromSupabase() :
        mode === 'full' ? await syncBidirectional() :
        await syncToSupabase();
      setSyncStatus(result.message);
      
      if (result.success) {
        const syncTime = await getLastSyncTime();
        setLastSync(syncTime);
        await refreshStore();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncStatus('Sync error: ' + msg);
    }
    
    setIsSyncing(false);
    setTimeout(() => setSyncStatus(''), 8000);
  };

  const handleAutoSyncToggle = (enabled: boolean) => {
    setAutoSync(enabled);
    setAutoSyncEnabled(enabled);
    if (enabled) {
      startAutoSync();
      setSyncStatus('Auto-sync enabled');
    } else {
      stopAutoSync();
      setSyncStatus('Auto-sync disabled');
    }
    setTimeout(() => setSyncStatus(''), 4000);
  };

  const handleAddUser = async () => {
    setAddUserError('');
    
    if (!newUserName.trim()) {
      setAddUserError('Name is required');
      return;
    }
    if (!isValidGhanaPhone(newUserPhone)) {
      setAddUserError('Valid Ghana phone is required for PIN reset');
      return;
    }
    if (newUserPin.length !== 4) {
      setAddUserError('PIN must be 4 digits');
      return;
    }

    try {
      await addUserToStore(newUserName.trim(), newUserPin, newUserRole, newUserPhone.trim());
      setNewUserName('');
      setNewUserPhone('');
      setNewUserPin('');
      setShowAddUser(false);
      
      const storeUsers = await getCurrentStoreUsersIncludingBlocked();
      setUsers(storeUsers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddUserError('Failed to add user: ' + msg);
    }
  };

  const refreshUsers = async () => {
    setUsers(await getCurrentStoreUsersIncludingBlocked());
  };

  const handleBlockUser = async (user: LocalUser) => {
    if (user.id === currentUser?.id) {
      alert('You cannot block your own account while logged in.');
      return;
    }
    if (user.role === 'owner') {
      alert('Owner accounts cannot be blocked from here.');
      return;
    }
    if (confirm(`Block ${user.name}? They can still enter their PIN, but will only see a message to contact you until unblocked.`)) {
      await deactivateUser(user.id);
      await refreshUsers();
    }
  };

  const handleUnblockUser = async (user: LocalUser) => {
    await activateUser(user.id);
    await refreshUsers();
  };

  const updateCashierPerms = async (
    user: LocalUser,
    patch: Partial<
      Pick<
        LocalUser,
        | 'assigned_location_id'
        | 'can_wholesale'
        | 'can_sell_from_warehouse'
        | 'can_manage_ecommerce'
        | 'phone'
      >
    >
  ) => {
    await db.users.update(user.id, { ...patch, synced: 0 });
    await refreshUsers();
  };

  const handleDeleteUser = async (userId: string) => {
    if (userId === currentUser?.id) {
      alert('You cannot delete your own account while logged in.');
      return;
    }
    
    if (confirm('Delete this user permanently? Prefer Block if you may need them later.')) {
      await deleteUser(userId);
      await refreshUsers();
    }
  };

  const handleRegisterBiometric = async () => {
    if (!currentUser) return;
    
    setRegisteringBiometric(true);
    setBiometricError('');
    
    const result = await registerBiometric(currentUser.id, currentUser.name);
    
    if (result.success) {
      setBiometricRegistered(true);
    } else {
      setBiometricError(result.error || 'Registration failed');
    }
    
    setRegisteringBiometric(false);
  };

  const handleClearBiometric = () => {
    if (confirm('Remove biometric login? You will need to register again to use it.')) {
      clearBiometricRegistration();
      setBiometricRegistered(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1 className="text-white font-bold text-lg">Settings</h1>
        <p className="text-emerald-200 text-xs">Manage your store configuration</p>
      </div>

      <div className="page-body no-scrollbar">
        <StoresPortalSection />
        <WarehousePortalSection
          onOpenWarehouse={() => {
            onNavigate?.('warehouse');
          }}
        />

        {/* Store Profile */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-gray-900">Store Profile</h3>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-xl border border-gray-100 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {hasStoreLogo(logoUrl) ? (
                    <img src={logoUrl} alt="Store logo" className="w-full h-full object-cover" />
                  ) : (
                    <Store className="w-7 h-7 text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">Store logo</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Shown at the top for you and your cashiers after login. Tap Save after changing.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary/10 text-primary rounded-lg text-xs font-medium touch-target disabled:opacity-50"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      {logoBusy ? 'Processing…' : hasStoreLogo(logoUrl) ? 'Change logo' : 'Upload logo'}
                    </button>
                    {hasStoreLogo(logoUrl) && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl('')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium touch-target"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleLogoPick(e.target.files?.[0] || null)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Store Name *</label>
              <input
                type="text"
                value={storeName}
                onChange={e => setStoreName(e.target.value)}
                placeholder="Enter your store name"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Address *</label>
              <input
                type="text"
                value={storeAddress}
                onChange={e => setStoreAddress(e.target.value)}
                placeholder="Store address"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Support Phone *</label>
              <input
                type="tel"
                value={supportNumber}
                onChange={e => setSupportNumber(e.target.value)}
                placeholder="024 XXX XXXX or +23324XXXXXXX"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* MoMo payout account — used by platform admin for weekly Paystack remittances */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-gray-900">Mobile Money Payout</h3>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Enter the MoMo account where Adimat should send your weekly Paystack (online) collections.
          </p>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Account Name</label>
              <input
                type="text"
                value={momoAccountName}
                onChange={e => setMomoAccountName(e.target.value)}
                placeholder="Name on MoMo wallet"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">MoMo Number</label>
              <input
                type="tel"
                value={momoNumber}
                onChange={e => setMomoNumber(e.target.value)}
                placeholder="024 XXX XXXX"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Network</label>
              <select
                value={momoNetwork}
                onChange={e => setMomoNetwork(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none bg-white focus:ring-2 focus:ring-primary focus:border-primary"
              >
                <option value="">Select network</option>
                <option value="MTN">MTN</option>
                <option value="Vodafone">Vodafone</option>
                <option value="AirtelTigo">AirtelTigo</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        {/* Discount Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-4">
            <Percent className="w-5 h-5 text-accent" />
            <h3 className="font-bold text-gray-900">Discount Controls</h3>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Allow percentage discounts</p>
                <p className="text-xs text-gray-500">e.g. 10% off the cart</p>
              </div>
              <button
                onClick={() => setAllowPercentage(!allowPercentage)}
                className={`w-12 h-7 rounded-full transition-colors flex items-center px-0.5 touch-target ${
                  allowPercentage ? 'bg-primary justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <div className="w-6 h-6 bg-white rounded-full shadow" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Allow fixed-amount discounts</p>
                <p className="text-xs text-gray-500">e.g. GH₵5 off the cart</p>
              </div>
              <button
                onClick={() => setAllowFixed(!allowFixed)}
                className={`w-12 h-7 rounded-full transition-colors flex items-center px-0.5 touch-target ${
                  allowFixed ? 'bg-primary justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <div className="w-6 h-6 bg-white rounded-full shadow" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Cashiers can apply discounts</p>
                <p className="text-xs text-gray-500">Turn off to restrict discounts to owners</p>
              </div>
              <button
                onClick={() => setCashierCanDiscount(!cashierCanDiscount)}
                className={`w-12 h-7 rounded-full transition-colors flex items-center px-0.5 touch-target ${
                  cashierCanDiscount ? 'bg-primary justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <div className="w-6 h-6 bg-white rounded-full shadow" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Require PIN for High Discounts</p>
                <p className="text-xs text-gray-500">Owner PIN needed when exceeding cap</p>
              </div>
              <button
                onClick={() => setPinOnDiscount(!pinOnDiscount)}
                className={`w-12 h-7 rounded-full transition-colors flex items-center px-0.5 touch-target ${
                  pinOnDiscount ? 'bg-primary justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <div className="w-6 h-6 bg-white rounded-full shadow" />
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Discount Cap (%)
              </label>
              <input
                type="number"
                value={discountCap}
                onChange={e => setDiscountCap(e.target.value)}
                min="0"
                max="100"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Applies to percentage discounts and as a % of subtotal for fixed discounts
              </p>
            </div>
          </div>
        </div>

        {/* Security / Change PIN */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-gray-900">Security</h3>
          </div>

          <button
            onClick={() => setShowChangePinModal(true)}
            className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition touch-target"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                <Key className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900">Change PIN</p>
                <p className="text-xs text-gray-500">Update your login PIN</p>
              </div>
            </div>
            <span className="text-gray-400">→</span>
          </button>
        </div>

        {/* Biometric Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-4">
            <Fingerprint className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-gray-900">Biometric Login</h3>
          </div>

          {!biometricSupported ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>Biometrics not available on this device</span>
            </div>
          ) : biometricRegistered ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Biometric login is enabled</span>
              </div>
              <button
                onClick={handleClearBiometric}
                className="w-full py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-medium touch-target"
              >
                Remove Biometric Login
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Use fingerprint or face to login quickly without entering your PIN.
              </p>
              <button
                onClick={handleRegisterBiometric}
                disabled={registeringBiometric}
                className="w-full py-3 bg-blue-50 text-blue-700 rounded-xl font-medium text-sm flex items-center justify-center gap-2 touch-target disabled:opacity-50"
              >
                {registeringBiometric ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-4 h-4" />
                    Set Up Biometric Login
                  </>
                )}
              </button>
              {biometricError && (
                <p className="text-red-500 text-xs">{biometricError}</p>
              )}
            </div>
          )}
        </div>

        {/* User Management */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-600" />
              <h3 className="font-bold text-gray-900">Staff Members</h3>
            </div>
            <button
              onClick={() => setShowAddUser(!showAddUser)}
              className="flex items-center gap-1 text-primary text-xs font-medium touch-target"
            >
              <UserPlus className="w-4 h-4" />
              Add Staff
            </button>
          </div>

          {showAddUser && (
            <div className="bg-gray-50 rounded-xl p-3 mb-3 space-y-2 animate-fade-in">
              <input
                type="text"
                value={newUserName}
                onChange={e => setNewUserName(e.target.value)}
                placeholder="Staff name *"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="tel"
                value={newUserPhone}
                onChange={e => setNewUserPhone(e.target.value)}
                placeholder="Phone * (024…) — for PIN reset"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={newUserPin}
                onChange={e => setNewUserPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4-digit PIN *"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <select
                value={newUserRole}
                onChange={e => setNewUserRole(e.target.value as 'cashier' | 'owner')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none bg-white focus:ring-2 focus:ring-primary"
              >
                <option value="cashier">Cashier</option>
                <option value="owner">Owner</option>
              </select>
              {addUserError && (
                <p className="text-red-500 text-xs">{addUserError}</p>
              )}
              <button
                onClick={handleAddUser}
                className="w-full py-2 bg-primary text-white rounded-lg text-sm font-medium touch-target"
              >
                Add Staff Member
              </button>
            </div>
          )}

          <div className="space-y-2">
            {users.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No staff members yet</p>
            ) : (
              users.map(user => (
                <div key={user.id} className={`py-2 border-b border-gray-50 last:border-0 ${user.is_active === 0 ? 'opacity-70' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {user.name}
                        {user.id === currentUser?.id && (
                          <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">You</span>
                        )}
                        {user.is_active === 0 && (
                          <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Blocked</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 capitalize">
                        {user.role}
                        {user.phone ? ` · ${user.phone}` : ' · no phone'}
                        {user.role === 'cashier' && (user.can_wholesale === 1 ? ' · wholesale' : '')}
                        {user.role === 'cashier' && (user.can_sell_from_warehouse === 1 ? ' · warehouse sales' : '')}
                        {user.role === 'cashier' && (user.can_manage_ecommerce === 1 ? ' · online shop' : '')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {user.role === 'cashier' && (
                        <button
                          type="button"
                          onClick={() => setPermUserId(permUserId === user.id ? null : user.id)}
                          className="px-2 py-1 text-[10px] font-semibold rounded-lg bg-slate-100 text-slate-700 touch-target"
                        >
                          Perms
                        </button>
                      )}
                      {user.id !== currentUser?.id && (
                        <>
                          <button
                            onClick={() => setResetPinUser(user)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 touch-target"
                            title="Reset PIN"
                          >
                            <Key className="w-4 h-4 text-blue-500" />
                          </button>
                          {user.role !== 'owner' && (
                            user.is_active === 1 ? (
                              <button
                                onClick={() => void handleBlockUser(user)}
                                className="p-1.5 rounded-lg hover:bg-amber-50 touch-target"
                                title="Block cashier"
                              >
                                <Ban className="w-4 h-4 text-amber-600" />
                              </button>
                            ) : (
                              <button
                                onClick={() => void handleUnblockUser(user)}
                                className="p-1.5 rounded-lg hover:bg-emerald-50 touch-target"
                                title="Unblock cashier"
                              >
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              </button>
                            )
                          )}
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 touch-target"
                            title="Delete User"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {permUserId === user.id && user.role === 'cashier' && (
                    <div className="mt-2 bg-slate-50 rounded-xl p-3 space-y-2 text-xs">
                      <div>
                        <label className="text-gray-500 font-medium block mb-1">Phone (PIN reset)</label>
                        <input
                          type="tel"
                          defaultValue={user.phone || ''}
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (value && !isValidGhanaPhone(value)) {
                              alert('Enter a valid Ghana phone number');
                              return;
                            }
                            void updateCashierPerms(user, { phone: value });
                          }}
                          placeholder="024 XXX XXXX"
                          className="w-full px-2 py-2 border border-gray-200 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-gray-500 font-medium block mb-1">Assigned location</label>
                        <select
                          value={user.assigned_location_id || ''}
                          onChange={(e) =>
                            void updateCashierPerms(user, {
                              assigned_location_id: e.target.value || null,
                            })
                          }
                          className="w-full px-2 py-2 border border-gray-200 rounded-lg bg-white"
                        >
                          <option value="">Default shop</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name} ({loc.location_type})
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center justify-between gap-2 py-1">
                        <span className="text-gray-700 font-medium">Can sell wholesale</span>
                        <input
                          type="checkbox"
                          checked={(user.can_wholesale ?? 0) === 1}
                          onChange={(e) =>
                            void updateCashierPerms(user, { can_wholesale: e.target.checked ? 1 : 0 })
                          }
                        />
                      </label>
                      {(currentStore?.warehouse_enabled ?? 0) === 1 && (
                        <label className="flex items-center justify-between gap-2 py-1">
                          <span className="text-gray-700 font-medium">Can sell from warehouse</span>
                          <input
                            type="checkbox"
                            checked={(user.can_sell_from_warehouse ?? 0) === 1}
                            onChange={(e) =>
                              void updateCashierPerms(user, {
                                can_sell_from_warehouse: e.target.checked ? 1 : 0,
                              })
                            }
                          />
                        </label>
                      )}
                      {(currentStore?.ecommerce_enabled ?? 0) === 1 && (
                        <label className="flex items-center justify-between gap-2 py-1">
                          <span className="text-gray-700 font-medium">Can manage online shop</span>
                          <input
                            type="checkbox"
                            checked={(user.can_manage_ecommerce ?? 0) === 1}
                            onChange={(e) =>
                              void updateCashierPerms(user, {
                                can_manage_ecommerce: e.target.checked ? 1 : 0,
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Bluetooth also available under Devices for cashiers */}
        <BluetoothHardwareSettings />

        {/* Cloud Sync */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-4">
            <RefreshCcw className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-gray-900">Cloud Sync</h3>
          </div>

          {!supabaseReady && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              <p className="text-amber-800 text-xs">
                <strong>Not configured:</strong> Add Supabase credentials to enable cloud sync.
              </p>
            </div>
          )}

          {storeId && (
            <div className="bg-gray-50 rounded-lg p-3 mb-3">
              <p className="text-[10px] text-gray-500 mb-1">
                Store ID (open this store on another device via My Stores / Restore)
              </p>
              <p className="text-xs font-mono text-gray-800 break-all">{storeId}</p>
            </div>
          )}

          <label className="flex items-center justify-between py-2 mb-3">
            <span className="text-sm text-gray-700">Auto-sync when online</span>
            <button
              onClick={() => handleAutoSyncToggle(!autoSync)}
              className={`w-12 h-7 rounded-full transition-colors ${autoSync ? 'bg-primary' : 'bg-gray-300'}`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full transition-transform mx-1 ${autoSync ? 'translate-x-5' : ''}`} />
            </button>
          </label>

          <div className="grid grid-cols-1 gap-2 mb-2">
            <button
              onClick={() => handleSync('full')}
              disabled={isSyncing}
              className="w-full py-3 bg-primary text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              Full Sync (Pull + Push)
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleSync('pull')}
                disabled={isSyncing}
                className="py-3 border border-primary text-primary rounded-xl font-medium text-xs disabled:opacity-50"
              >
                Pull from Cloud
              </button>
              <button
                onClick={() => handleSync('push')}
                disabled={isSyncing}
                className="py-3 border border-gray-300 text-gray-700 rounded-xl font-medium text-xs disabled:opacity-50"
              >
                Push to Cloud
              </button>
            </div>
          </div>

          {syncStatus && (
            <p className={`text-xs mt-2 text-center ${
              syncStatus.includes('error') || syncStatus.includes('failed') || syncStatus.includes('not configured')
                ? 'text-amber-600'
                : 'text-green-600'
            }`}>
              {syncStatus}
            </p>
          )}

          <div className="flex items-center gap-1.5 mt-3 justify-center">
            {lastSync ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                <span className="text-[10px] text-gray-500">
                  Last synced: {new Date(lastSync).toLocaleString()}
                </span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-gray-400" />
                <span className="text-[10px] text-gray-500">Never synced</span>
              </>
            )}
          </div>
        </div>

        {/* Save Button */}
        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
            <p className="text-red-700 text-sm">{saveError}</p>
          </div>
        )}
        
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 touch-target mb-6 transition-colors ${
            saveSuccess
              ? 'bg-green-500 text-white'
              : 'bg-primary text-white disabled:opacity-50'
          }`}
        >
          {saving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Saving...
            </>
          ) : saveSuccess ? (
            <>
              <CheckCircle2 className="w-5 h-5" />
              Settings Saved!
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              Save All Settings
            </>
          )}
        </button>
      </div>

      {/* Change PIN Modal */}
      <ChangePinModal 
        isOpen={showChangePinModal} 
        onClose={() => setShowChangePinModal(false)} 
      />

      {/* Reset User PIN Modal */}
      <ResetUserPinModal
        isOpen={resetPinUser !== null}
        user={resetPinUser}
        onClose={() => setResetPinUser(null)}
        onSuccess={loadData}
      />
    </div>
  );
}
