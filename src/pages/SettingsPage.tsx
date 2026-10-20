import { useState, useEffect, useCallback, useRef } from 'react';
import { Store, Shield, Percent,
  Save, Loader2, CheckCircle2, UserPlus,
  Trash2, Users, Fingerprint, AlertCircle, Key, Smartphone, Ban, ImagePlus, Timer,
  BellRing, Target
} from 'lucide-react';
import ChangePinModal from '@/components/ChangePinModal';
import ResetUserPinModal from '@/components/ResetUserPinModal';
import BluetoothHardwareSettings from '@/components/BluetoothHardwareSettings';
import CloudSyncPanel from '@/components/CloudSyncPanel';
import BackupSyncTools from '@/components/BackupSyncTools';
import { 
  db, 
  LocalUser,
  LocalLocation,
  getCurrentStoreId,
  getCurrentStoreUsersIncludingBlocked,
  addUserToStore,
  deleteUser,
  deactivateUser,
  activateUser,
  updateUserPhone,
} from '@/lib/dexie';
import { ensureStoreLocations, listLocations } from '@/lib/warehouse';
import { useAuthStore } from '@/store/useAuthStore';
import { isBiometricAvailable, registerBiometric, hasBiometricRegistered, clearBiometricRegistration } from '@/lib/biometric';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { fileToStoreLogoDataUrl, hasStoreLogo } from '@/lib/productImage';
import StoresPortalSection from '@/components/StoresPortalSection';
import WarehousePortalSection from '@/components/WarehousePortalSection';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import CurrencySelect from '@/components/CurrencySelect';
import { useI18nStore, useT } from '@/lib/i18n';
import { DEFAULT_CURRENCY, normalizeCurrencyCode, getStoreCurrency } from '@/lib/currency';
import { canAccessCashbook } from '@/lib/staffAccess';
import {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_OPTIONS,
  normalizeSessionTimeoutMinutes,
} from '@/lib/sessionTimeout';
import {
  DEBT_REMINDER_INTERVAL_OPTIONS,
  DEBT_REMINDER_MAX_CHARS,
  DEFAULT_DEBT_REMINDER_INTERVAL_DAYS,
  DEFAULT_DEBT_REMINDER_TEMPLATE,
  normalizeDebtReminderIntervalDays,
  normalizeDebtReminderMinBalance,
  normalizeDebtReminderTemplate,
} from '@/lib/debtReminderConfig';

interface SettingsPageProps {
  onNavigate?: (page: string) => void;
}

export default function SettingsPage({ onNavigate }: SettingsPageProps) {
  const { currentUser, currentStore, refreshStore } = useAuthStore();
  const t = useT();
  const language = useI18nStore((s) => s.language);
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
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(DEFAULT_SESSION_TIMEOUT_MINUTES);
  const [momoAccountName, setMomoAccountName] = useState('');
  const [momoNumber, setMomoNumber] = useState('');
  const [momoNetwork, setMomoNetwork] = useState('');
  const [currencyCode, setCurrencyCode] = useState(DEFAULT_CURRENCY);
  const [debtRemindersEnabled, setDebtRemindersEnabled] = useState(false);
  const [debtReminderIntervalDays, setDebtReminderIntervalDays] = useState(String(DEFAULT_DEBT_REMINDER_INTERVAL_DAYS));
  const [debtReminderMinBalance, setDebtReminderMinBalance] = useState('0');
  const [debtReminderMessage, setDebtReminderMessage] = useState(DEFAULT_DEBT_REMINDER_TEMPLATE);
  const [salesTargetDaily, setSalesTargetDaily] = useState('0');
  const [salesTargetMonthly, setSalesTargetMonthly] = useState('0');
  
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  
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
      setSessionTimeoutMinutes(normalizeSessionTimeoutMinutes(currentStore.session_timeout_minutes));
      setMomoAccountName(currentStore.momo_account_name || '');
      setMomoNumber(currentStore.momo_number || '');
      setMomoNetwork(currentStore.momo_network || '');
      setCurrencyCode(normalizeCurrencyCode(currentStore.currency_code));
      setDebtRemindersEnabled((currentStore.debt_reminders_enabled ?? 0) === 1);
      setDebtReminderIntervalDays(
        String(normalizeDebtReminderIntervalDays(currentStore.debt_reminder_interval_days))
      );
      setDebtReminderMinBalance(
        String(normalizeDebtReminderMinBalance(currentStore.debt_reminder_min_balance))
      );
      setDebtReminderMessage(
        normalizeDebtReminderTemplate(currentStore.debt_reminder_message)
      );
      setSalesTargetDaily(String(Number(currentStore.sales_target_daily) || 0));
      setSalesTargetMonthly(String(Number(currentStore.sales_target_monthly) || 0));
      await ensureStoreLocations(currentStore.id);
      setLocations(await listLocations(currentStore.id));
    }

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
        setSaveError(t('settings.storeNameRequired'));
        setSaving(false);
        return;
      }
      if (!storeAddress.trim()) {
        setSaveError(t('settings.addressRequired'));
        setSaving(false);
        return;
      }
      if (!supportNumber.trim()) {
        setSaveError(t('settings.phoneRequired'));
        setSaving(false);
        return;
      }
      if (!isValidGhanaPhone(supportNumber)) {
        setSaveError(t('settings.validPhone'));
        setSaving(false);
        return;
      }
      if (!allowPercentage && !allowFixed) {
        setSaveError(t('settings.discountType'));
        setSaving(false);
        return;
      }
      if (debtReminderMessage.trim().length > DEBT_REMINDER_MAX_CHARS) {
        setSaveError(`Debt reminder message is too long. Keep it under ${DEBT_REMINDER_MAX_CHARS} characters.`);
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
        session_timeout_minutes: normalizeSessionTimeoutMinutes(sessionTimeoutMinutes),
        momo_account_name: momoAccountName.trim(),
        momo_number: momoNumber.trim(),
        momo_network: momoNetwork.trim(),
        currency_code: normalizeCurrencyCode(currencyCode),
        preferred_language: language,
        debt_reminders_enabled: debtRemindersEnabled ? 1 : 0,
        debt_reminder_interval_days: normalizeDebtReminderIntervalDays(debtReminderIntervalDays),
        debt_reminder_min_balance: normalizeDebtReminderMinBalance(debtReminderMinBalance),
        debt_reminder_message: normalizeDebtReminderTemplate(debtReminderMessage),
        sales_target_daily: Math.max(0, Number(salesTargetDaily) || 0),
        sales_target_monthly: Math.max(0, Number(salesTargetMonthly) || 0),
        synced: 0,
      });
      
      await refreshStore();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(t('settings.saveFailed', { error: msg }));
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
        | 'can_access_cashbook'
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
        <h1 className="text-white font-bold text-lg">{t('settings.title')}</h1>
        <p className="text-emerald-200 text-xs">{t('settings.subtitle')}</p>
      </div>

      <div className="page-body no-scrollbar">
        <StoresPortalSection />
        <WarehousePortalSection />

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-bold text-gray-900">{t('settings.languageCurrency')}</h3>
          </div>
          <LanguageSwitcher />
          <p className="text-[11px] text-gray-500 mt-2 mb-4">{t('settings.languageHint')}</p>
          <label className="text-sm font-medium text-gray-800 mb-2 block">{t('settings.currency')}</label>
          <CurrencySelect value={currencyCode} onChange={setCurrencyCode} />
          <p className="text-[11px] text-gray-500 mt-2">{t('settings.currencyHint')}</p>
        </div>

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
                <p className="text-xs text-gray-500">e.g. {getStoreCurrency(currencyCode).symbol}5 off the cart</p>
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

        {/* Debt reminders */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <BellRing className="w-5 h-5 text-amber-600" />
            <h3 className="font-bold text-gray-900">Debt reminders</h3>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Automatically text customers who still owe money. Each customer is only chased once
            per interval, and customers can opt out from the Customers screen.
          </p>

          <button
            type="button"
            role="switch"
            aria-checked={debtRemindersEnabled}
            onClick={() => setDebtRemindersEnabled((value) => !value)}
            className="mb-3 flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-left"
          >
            <span>
              <span className="block text-sm font-medium text-gray-800">Send reminders automatically</span>
              <span className="block text-[11px] text-gray-500">
                {debtRemindersEnabled
                  ? 'Adimat chases overdue balances while the app is open.'
                  : 'Reminders are off. You can still send them from Customers.'}
              </span>
            </span>
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                debtRemindersEnabled ? 'bg-primary' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  debtRemindersEnabled ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </span>
          </button>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-gray-600">
              Remind me every (days)
              <select
                value={debtReminderIntervalDays}
                onChange={(event) => setDebtReminderIntervalDays(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-normal"
              >
                {DEBT_REMINDER_INTERVAL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option} day{option === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-gray-600">
              Only remind above
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={debtReminderMinBalance}
                onChange={(event) => setDebtReminderMinBalance(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
              />
            </label>
          </div>

          <label className="mt-3 block text-xs font-medium text-gray-600">
            Reminder message
            <textarea
              rows={3}
              maxLength={DEBT_REMINDER_MAX_CHARS}
              value={debtReminderMessage}
              onChange={(event) => setDebtReminderMessage(event.target.value)}
              className="mt-1 w-full resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
            />
            <span className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
              <span>Use {`{name}`}, {`{store}`} and {`{balance}`} to personalise it.</span>
              <span className={debtReminderMessage.length > DEBT_REMINDER_MAX_CHARS ? 'text-red-500 font-medium' : ''}>
                {debtReminderMessage.length}/{DEBT_REMINDER_MAX_CHARS}
              </span>
            </span>
          </label>
        </div>

        {/* Sales targets */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-gray-900">Sales targets</h3>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            Shown as progress on the owner dashboard. Leave at 0 to hide a target.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-gray-600">
              Daily target
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={salesTargetDaily}
                onChange={(event) => setSalesTargetDaily(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-gray-600">
              Monthly target
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={salesTargetMonthly}
                onChange={(event) => setSalesTargetMonthly(event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
              />
            </label>
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

          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <Timer className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-medium text-gray-700">{t('settings.sessionTimeout')}</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">{t('settings.sessionTimeoutHint')}</p>
            <select
              value={sessionTimeoutMinutes}
              onChange={(e) =>
                setSessionTimeoutMinutes(normalizeSessionTimeoutMinutes(e.target.value))
              }
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm outline-none bg-white focus:ring-2 focus:ring-primary focus:border-primary"
            >
              {SESSION_TIMEOUT_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0
                    ? t('settings.sessionTimeout.off')
                    : minutes === 1
                      ? t('settings.sessionTimeout.minute')
                      : minutes === DEFAULT_SESSION_TIMEOUT_MINUTES
                        ? t('settings.sessionTimeout.minutesRecommended', { n: minutes })
                        : t('settings.sessionTimeout.minutes', { n: minutes })}
                </option>
              ))}
            </select>
          </div>
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
                        {user.role === 'cashier' && canAccessCashbook(user) ? ' · cash book' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPermUserId(permUserId === user.id ? null : user.id)}
                        className="px-2 py-1 text-[10px] font-semibold rounded-lg bg-slate-100 text-slate-700 touch-target"
                      >
                        {user.role === 'cashier' ? 'Perms' : 'Phone'}
                      </button>
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
                  {permUserId === user.id && (
                    <div className="mt-2 bg-slate-50 rounded-xl p-3 space-y-2 text-xs">
                      <div>
                        <label className="text-gray-500 font-medium block mb-1">Phone (PIN reset)</label>
                        <input
                          type="tel"
                          defaultValue={user.phone || ''}
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (!value) return;
                            if (!isValidGhanaPhone(value)) {
                              alert('Enter a valid Ghana phone number');
                              return;
                            }
                            void (async () => {
                              try {
                                if (user.id === currentUser?.id) {
                                  await useAuthStore.getState().updateMyPhone(value);
                                } else {
                                  await updateUserPhone(user.id, value);
                                }
                                await loadData();
                              } catch (err) {
                                alert(err instanceof Error ? err.message : 'Could not save phone');
                              }
                            })();
                          }}
                          placeholder="024 XXX XXXX"
                          className="w-full px-2 py-2 border border-gray-200 rounded-lg bg-white"
                        />
                      </div>
                      {user.role === 'cashier' && (
                      <>
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
                      <label className="flex items-center justify-between gap-2 py-1">
                        <span>
                          <span className="text-gray-700 font-medium block">{t('settings.canCashbook')}</span>
                          <span className="text-[11px] text-gray-500">{t('settings.canCashbookHint')}</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={canAccessCashbook(user)}
                          onChange={(e) =>
                            void updateCashierPerms(user, {
                              can_access_cashbook: e.target.checked ? 1 : 0,
                            })
                          }
                        />
                      </label>
                      </>
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

        <CloudSyncPanel showStoreId />
        <BackupSyncTools />

        {/* Save Button */}
        {saveError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
            <p className="text-red-700 text-sm">{saveError}</p>
          </div>
        )}
        
        <button
          onClick={handleSave}
          disabled={saving}
          className={`sticky bottom-0 z-10 w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 touch-target mb-6 transition-colors shadow-lg ${
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
              {t('settings.savedBanner')}
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              {t('settings.saveAll')}
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
