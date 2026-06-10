import { useState, useEffect, useCallback } from 'react';
import {
  Store, Shield, Percent, Bluetooth, RefreshCcw,
  Save, Loader2, CheckCircle2, WifiOff, UserPlus,
  Trash2, Users, Fingerprint, AlertCircle, Key
} from 'lucide-react';
import ChangePinModal from '@/components/ChangePinModal';
import ResetUserPinModal from '@/components/ResetUserPinModal';
import { 
  db, 
  LocalStore,
  LocalUser,
  syncToSupabase, 
  getLastSyncTime, 
  getCurrentStoreId,
  getCurrentStoreUsers,
  addUserToStore,
  deleteUser
} from '@/lib/dexie';
import { connectPrinter, isPrinterConnected, getConnectedPrinterName, disconnectPrinter } from '@/lib/bluetoothPrinter';
import { useAuthStore } from '@/store/useAuthStore';
import { isBiometricAvailable, registerBiometric, hasBiometricRegistered, clearBiometricRegistration } from '@/lib/biometric';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function SettingsPage() {
  const { currentUser, currentStore, refreshStore } = useAuthStore();
  
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [supportNumber, setSupportNumber] = useState('');
  const [discountCap, setDiscountCap] = useState('10');
  const [pinOnDiscount, setPinOnDiscount] = useState(true);
  
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  
  const [syncStatus, setSyncStatus] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [supabaseReady, setSupabaseReady] = useState(false);
  
  const [printerName, setPrinterName] = useState<string | null>(null);
  const [connectingPrinter, setConnectingPrinter] = useState(false);
  const [printerError, setPrinterError] = useState('');

  const [users, setUsers] = useState<LocalUser[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPin, setNewUserPin] = useState('');
  const [newUserRole, setNewUserRole] = useState<'cashier' | 'owner'>('cashier');
  const [addUserError, setAddUserError] = useState('');

  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [registeringBiometric, setRegisteringBiometric] = useState(false);
  const [biometricError, setBiometricError] = useState('');
  
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [resetPinUser, setResetPinUser] = useState<LocalUser | null>(null);

  const loadData = useCallback(async () => {
    if (currentStore) {
      setStoreName(currentStore.name);
      setStoreAddress(currentStore.address);
      setSupportNumber(currentStore.support_number);
      setDiscountCap(String(currentStore.discount_cap_percentage));
      setPinOnDiscount(currentStore.pin_on_discount_enabled === 1);
    }
    
    const syncTime = await getLastSyncTime();
    setLastSync(syncTime);
    setPrinterName(getConnectedPrinterName());
    setSupabaseReady(isSupabaseConfigured());

    const storeUsers = await getCurrentStoreUsers();
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
      await db.stores.update(storeId, {
        name: storeName.trim(),
        address: storeAddress.trim(),
        support_number: supportNumber.trim(),
        discount_cap_percentage: Math.max(0, Math.min(100, parseInt(discountCap) || 10)),
        pin_on_discount_enabled: pinOnDiscount ? 1 : 0,
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

  const handleSync = async () => {
    if (!supabaseReady) {
      setSyncStatus('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment.');
      return;
    }
    
    setIsSyncing(true);
    setSyncStatus('Connecting to cloud...');
    
    try {
      const result = await syncToSupabase();
      setSyncStatus(result.message);
      
      if (result.success) {
        const syncTime = await getLastSyncTime();
        setLastSync(syncTime);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncStatus('Sync error: ' + msg);
    }
    
    setIsSyncing(false);
    setTimeout(() => setSyncStatus(''), 8000);
  };

  const handleConnectPrinter = async () => {
    setConnectingPrinter(true);
    setPrinterError('');
    
    try {
      const result = await connectPrinter();
      if (result.success) {
        setPrinterName(result.deviceName);
      } else {
        setPrinterError(result.error || 'Connection failed');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPrinterError('Error: ' + msg);
    }
    
    setConnectingPrinter(false);
  };

  const handleDisconnectPrinter = () => {
    disconnectPrinter();
    setPrinterName(null);
  };

  const handleAddUser = async () => {
    setAddUserError('');
    
    if (!newUserName.trim()) {
      setAddUserError('Name is required');
      return;
    }
    if (newUserPin.length !== 4) {
      setAddUserError('PIN must be 4 digits');
      return;
    }

    try {
      await addUserToStore(newUserName.trim(), newUserPin, newUserRole);
      setNewUserName('');
      setNewUserPin('');
      setShowAddUser(false);
      
      const storeUsers = await getCurrentStoreUsers();
      setUsers(storeUsers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAddUserError('Failed to add user: ' + msg);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (userId === currentUser?.id) {
      alert('You cannot delete your own account while logged in.');
      return;
    }
    
    if (confirm('Delete this user? This cannot be undone.')) {
      await deleteUser(userId);
      const storeUsers = await getCurrentStoreUsers();
      setUsers(storeUsers);
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
    <div className="flex flex-col h-full bg-gray-50">
      <div className="bg-primary px-4 py-3 flex-shrink-0">
        <h1 className="text-white font-bold text-lg">Settings</h1>
        <p className="text-emerald-200 text-xs">Manage your store configuration</p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-20 no-scrollbar">
        {/* Store Profile */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-gray-900">Store Profile</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Store Name</label>
              <input
                type="text"
                value={storeName}
                onChange={e => setStoreName(e.target.value)}
                placeholder="Enter your store name"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Address</label>
              <input
                type="text"
                value={storeAddress}
                onChange={e => setStoreAddress(e.target.value)}
                placeholder="Store address"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Support Phone</label>
              <input
                type="tel"
                value={supportNumber}
                onChange={e => setSupportNumber(e.target.value)}
                placeholder="+233 XX XXX XXXX"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
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
                Cashiers can apply up to this % without owner PIN
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
                placeholder="Staff name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={newUserPin}
                onChange={e => setNewUserPin(e.target.value.replace(/\D/g, ''))}
                placeholder="4-digit PIN"
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
                <div key={user.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {user.name}
                      {user.id === currentUser?.id && (
                        <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">You</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 capitalize">{user.role}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {user.id !== currentUser?.id && (
                      <>
                        <button
                          onClick={() => setResetPinUser(user)}
                          className="p-1.5 rounded-lg hover:bg-blue-50 touch-target"
                          title="Reset PIN"
                        >
                          <Key className="w-4 h-4 text-blue-500" />
                        </button>
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
              ))
            )}
          </div>
        </div>

        {/* Thermal Printer */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-4">
            <Bluetooth className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-gray-900">Thermal Printer</h3>
          </div>

          {isPrinterConnected() && printerName ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Connected
                </p>
                <p className="text-xs text-gray-500">{printerName}</p>
              </div>
              <button
                onClick={handleDisconnectPrinter}
                className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium touch-target"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <button
                onClick={handleConnectPrinter}
                disabled={connectingPrinter}
                className="w-full py-3 bg-blue-50 text-blue-700 rounded-xl font-medium text-sm flex items-center justify-center gap-2 touch-target disabled:opacity-50"
              >
                {connectingPrinter ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Searching for printers...
                  </>
                ) : (
                  <>
                    <Bluetooth className="w-4 h-4" />
                    Connect Bluetooth Printer
                  </>
                )}
              </button>
              {printerError && (
                <p className="text-red-500 text-xs mt-2">{printerError}</p>
              )}
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                Make sure your printer is on and in pairing mode
              </p>
            </div>
          )}
        </div>

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

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="w-full py-3 bg-primary text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 touch-target disabled:opacity-50"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCcw className="w-4 h-4" />
                Sync to Cloud
              </>
            )}
          </button>

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
