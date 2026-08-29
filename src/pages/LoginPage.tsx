import { useState, useCallback, useEffect } from 'react';
import { Delete, Fingerprint, Shield, Store, ChevronDown, Warehouse } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { authenticateWithBiometric, isBiometricAvailable, hasBiometricRegistered } from '@/lib/biometric';
import { db, listLocalStores, type LocalLocation, type LocalStore } from '@/lib/dexie';
import { hasStoreLogo } from '@/lib/productImage';
import { confirmPinResetWithOtp, requestPinResetOtp } from '@/lib/pinReset';
import { listLocations, verifyLocationAccessPin } from '@/lib/warehouse';
import CommunityChatButton from '@/components/CommunityChatButton';
import {
  clearPendingWarehouseLogin,
  getPendingWarehouseLogin,
  setPendingWarehouseLogin,
  unlockWarehouseLocation,
  type PendingWarehouseLogin,
} from '@/lib/warehouseAccess';

interface LoginPageProps {
  onOpenAdmin?: () => void;
  /** Called after a successful warehouse PIN login so the app can open the warehouse page. */
  onWarehouseLoginSuccess?: () => void;
}

export default function LoginPage({ onOpenAdmin, onWarehouseLoginSuccess }: LoginPageProps) {
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricError, setBiometricError] = useState('');
  const [stores, setStores] = useState<LocalStore[]>([]);
  const [warehouses, setWarehouses] = useState<LocalLocation[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingWarehouse, setPendingWarehouse] = useState<PendingWarehouseLogin | null>(
    () => getPendingWarehouseLogin()
  );
  const { login, loginAsStoreOwner, loginError, currentStore, switchStore } = useAuthStore();
  const storeLogo = currentStore?.logo_url;
  const storeName = currentStore?.name?.trim();
  const warehouseMode = Boolean(pendingWarehouse);

  useEffect(() => {
    async function checkBiometric() {
      if (warehouseMode) {
        setBiometricAvailable(false);
        return;
      }
      const available = await isBiometricAvailable();
      const registered = hasBiometricRegistered();
      setBiometricAvailable(available && registered);
    }
    void checkBiometric();
  }, [currentStore?.id, warehouseMode]);

  useEffect(() => {
    void listLocalStores().then(setStores);
  }, [currentStore?.id]);

  useEffect(() => {
    void (async () => {
      if (!currentStore?.id) {
        setWarehouses([]);
        return;
      }
      const locs = await listLocations(currentStore.id);
      setWarehouses(
        locs.filter((l) => l.location_type === 'warehouse' && Boolean(l.access_pin_hash))
      );
    })();
  }, [currentStore?.id]);

  useEffect(() => {
    setPendingWarehouse(getPendingWarehouseLogin());
  }, [currentStore?.id]);

  const handleSelectStore = async (storeId: string) => {
    clearPendingWarehouseLogin();
    setPendingWarehouse(null);
    setPin('');
    setBiometricError('');
    if (storeId !== currentStore?.id) {
      await switchStore(storeId);
    }
    setPickerOpen(false);
  };

  const handleSelectWarehouse = (loc: LocalLocation) => {
    if (!currentStore?.id) return;
    const pending = {
      storeId: currentStore.id,
      locationId: loc.id,
      name: loc.name,
    };
    setPendingWarehouseLogin(pending);
    setPendingWarehouse(pending);
    setPin('');
    setBiometricError('');
    setPickerOpen(false);
  };

  const handleWarehousePin = async (fullPin: string) => {
    if (!pendingWarehouse) return;
    setIsLoading(true);
    const ok = await verifyLocationAccessPin(pendingWarehouse.locationId, fullPin);
    if (!ok) {
      setIsLoading(false);
      useAuthStore.setState({ loginError: 'Invalid warehouse PIN. Please try again.' });
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPin('');
      }, 600);
      return;
    }
    unlockWarehouseLocation(pendingWarehouse.storeId, pendingWarehouse.locationId);
    const success = await loginAsStoreOwner();
    setIsLoading(false);
    if (!success) {
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPin('');
      }, 600);
      return;
    }
    setPendingWarehouse(null);
    onWarehouseLoginSuccess?.();
  };

  const handleBiometricLogin = async () => {
    setBiometricError('');
    setIsLoading(true);

    const result = await authenticateWithBiometric();

    if (result.success && result.userId) {
      const user = await db.users.get(result.userId);
      if (user && (!currentStore || user.store_id === currentStore.id)) {
        clearPendingWarehouseLogin();
        const { setCurrentUserId } = await import('@/lib/dexie');
        await setCurrentUserId(user.id);
        useAuthStore.setState({
          currentUser: user,
          isAuthenticated: true,
          loginError: '',
        });
      } else {
        setBiometricError('User not found for this store. Please login with PIN.');
      }
    } else {
      setBiometricError(result.error || 'Biometric login failed');
    }

    setIsLoading(false);
  };

  const handleKeyPress = useCallback(async (key: string) => {
    setBiometricError('');
    useAuthStore.setState({ loginError: '' });

    if (key === 'delete') {
      setPin(prev => prev.slice(0, -1));
      return;
    }

    if (key === 'biometric') {
      if (warehouseMode) return;
      void handleBiometricLogin();
      return;
    }

    const newPin = pin + key;
    if (newPin.length > 4) return;

    setPin(newPin);

    if (newPin.length === 4) {
      if (warehouseMode) {
        await handleWarehousePin(newPin);
        return;
      }
      setIsLoading(true);
      const success = await login(newPin);
      setIsLoading(false);
      if (!success) {
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setPin('');
        }, 600);
      }
    }
  }, [pin, login, warehouseMode, pendingWarehouse]); // eslint-disable-line react-hooks/exhaustive-deps

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'biometric', '0', 'delete'];
  const showPicker = stores.length > 1 || warehouses.length > 0;

  return (
    <div className="auth-shell">
      <div className="auth-panel flex flex-col items-center animate-fade-in">
        <div className="flex flex-col items-center mb-6 w-full">
          <div className="w-20 h-20 md:w-24 md:h-24 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-lg overflow-hidden">
            {hasStoreLogo(storeLogo) ? (
              <img src={storeLogo!} alt={storeName || 'Store logo'} className="w-full h-full object-cover" />
            ) : (
              <img src="/logo.png" alt="Adimat" className="w-14 h-14 md:w-16 md:h-16 object-contain" />
            )}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            {warehouseMode
              ? pendingWarehouse?.name || 'Warehouse'
              : hasStoreLogo(storeLogo) && storeName
                ? storeName
                : 'Adimat'}
          </h1>
          <p className="text-emerald-100/90 text-sm mt-2">
            {warehouseMode
              ? 'Enter warehouse PIN to open and manage'
              : 'Enter your PIN to continue'}
          </p>

          {showPicker && (
            <div className="relative mt-4 w-full max-w-[280px] md:max-w-[300px]">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 rounded-2xl bg-white/15 border border-white/20 px-4 py-3 text-left text-white touch-target"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {warehouseMode ? (
                    <Warehouse className="w-4 h-4 flex-shrink-0 text-amber-200" />
                  ) : (
                    <Store className="w-4 h-4 flex-shrink-0 text-emerald-200" />
                  )}
                  <span className="truncate text-sm font-semibold">
                    {warehouseMode
                      ? pendingWarehouse?.name || 'Warehouse'
                      : currentStore?.name || 'Select store'}
                  </span>
                </span>
                <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
              </button>
              {pickerOpen && (
                <div className="absolute z-20 mt-2 w-full rounded-2xl bg-white shadow-xl overflow-hidden border border-emerald-100 max-h-64 overflow-y-auto">
                  {stores.map((store) => {
                    const active = !warehouseMode && store.id === currentStore?.id;
                    return (
                      <button
                        key={store.id}
                        type="button"
                        onClick={() => void handleSelectStore(store.id)}
                        className={`w-full text-left px-4 py-3 text-sm touch-target border-b border-slate-100 ${
                          active ? 'bg-emerald-50 text-primary font-bold' : 'text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <p className="truncate flex items-center gap-1.5">
                          <Store className="w-3.5 h-3.5 shrink-0 opacity-60" />
                          {store.name}
                        </p>
                        {store.address ? (
                          <p className="text-[11px] text-slate-500 truncate mt-0.5 pl-5">{store.address}</p>
                        ) : null}
                      </button>
                    );
                  })}
                  {warehouses.map((loc) => {
                    const active = warehouseMode && pendingWarehouse?.locationId === loc.id;
                    return (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => handleSelectWarehouse(loc)}
                        className={`w-full text-left px-4 py-3 text-sm touch-target border-b border-slate-100 last:border-0 ${
                          active ? 'bg-amber-50 text-amber-900 font-bold' : 'text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <p className="truncate flex items-center gap-1.5">
                          <Warehouse className="w-3.5 h-3.5 shrink-0 opacity-60" />
                          {loc.name}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5 pl-5">Warehouse PIN</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {warehouseMode && (
            <button
              type="button"
              onClick={() => {
                clearPendingWarehouseLogin();
                setPendingWarehouse(null);
                setPin('');
              }}
              className="mt-3 text-xs text-emerald-100/90 font-medium underline-offset-2 touch-target"
            >
              Back to store login
            </button>
          )}
        </div>

        <div className={`flex gap-3 mb-6 ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}>
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                i < pin.length
                  ? 'bg-white border-white scale-110'
                  : 'bg-transparent border-emerald-300'
              }`}
            />
          ))}
        </div>

        {(loginError || biometricError) && (
          <p className="text-red-200 text-sm mb-4 animate-fade-in text-center px-4">
            {loginError || biometricError}
          </p>
        )}

        {isLoading && (
          <p className="text-emerald-200 text-sm mb-4">Verifying…</p>
        )}

        <div className="grid grid-cols-3 gap-3 w-full max-w-[280px] md:max-w-[300px]">
          {keys.map(key => {
            if (key === 'biometric') {
              return (
                <button
                  key={key}
                  onClick={() => void handleKeyPress(key)}
                  disabled={!biometricAvailable || warehouseMode}
                  className={`h-16 md:h-[4.5rem] rounded-2xl flex items-center justify-center touch-target transition-colors ${
                    biometricAvailable && !warehouseMode
                      ? 'bg-white/20 active:bg-white/30'
                      : 'bg-white/5 opacity-40'
                  }`}
                  title={biometricAvailable ? 'Login with biometrics' : 'Biometrics not set up'}
                >
                  <Fingerprint className={`w-6 h-6 ${biometricAvailable && !warehouseMode ? 'text-emerald-200' : 'text-gray-400'}`} />
                </button>
              );
            }
            if (key === 'delete') {
              return (
                <button
                  key={key}
                  onClick={() => void handleKeyPress(key)}
                  className="h-16 md:h-[4.5rem] rounded-2xl bg-white/10 flex items-center justify-center touch-target active:bg-white/20 transition-colors"
                >
                  <Delete className="w-6 h-6 text-emerald-200" />
                </button>
              );
            }
            return (
              <button
                key={key}
                onClick={() => void handleKeyPress(key)}
                disabled={isLoading}
                className="h-16 md:h-[4.5rem] rounded-2xl bg-white/15 text-white text-2xl font-semibold touch-target active:bg-white/30 transition-colors disabled:opacity-50"
              >
                {key}
              </button>
            );
          })}
        </div>

        {biometricAvailable && !warehouseMode && (
          <p className="mt-6 text-emerald-100 text-xs text-center">
            Biometric login available
          </p>
        )}

        {!warehouseMode && <ForgotPinSection />}

        <CommunityChatButton variant="auth" className="mt-6" />

        {onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            className="mt-4 flex items-center gap-2 text-emerald-100/80 text-xs font-medium touch-target"
          >
            <Shield className="w-3.5 h-3.5" />
            Administrator portal
          </button>
        )}
      </div>
    </div>
  );
}

function ForgotPinSection() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const requestCode = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    const result = await requestPinResetOtp(phone);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setMessage(result.message);
    setStep('code');
  };

  const confirmReset = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    if (pin1 !== pin2) {
      setError('New PINs do not match');
      setBusy(false);
      return;
    }
    const result = await confirmPinResetWithOtp(code, pin1);
    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setMessage(result.message);
    setStep('phone');
    setPhone('');
    setCode('');
    setPin1('');
    setPin2('');
    setTimeout(() => setOpen(false), 1500);
  };

  return (
    <div className="mt-8 w-full max-w-[280px] md:max-w-[300px]">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError('');
          setMessage('');
        }}
        className="w-full text-center text-emerald-100 text-xs font-semibold underline-offset-2 touch-target"
      >
        Forgot PIN? Reset with SMS
      </button>

      {open && (
        <div className="mt-3 rounded-2xl bg-white/10 border border-white/15 p-3 space-y-2">
          {step === 'phone' ? (
            <>
              <p className="text-[11px] text-emerald-50/90 text-center">
                Use the phone number saved on your staff profile for this store.
              </p>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="024 XXX XXXX"
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestCode()}
                className="w-full rounded-xl bg-white py-2.5 text-sm font-bold text-primary disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send reset code'}
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="SMS code"
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-center tracking-widest text-slate-900 outline-none"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin1}
                onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))}
                placeholder="New PIN"
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-center tracking-widest text-slate-900 outline-none"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
                placeholder="Confirm new PIN"
                className="w-full rounded-xl bg-white px-3 py-2.5 text-sm text-center tracking-widest text-slate-900 outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmReset()}
                className="w-full rounded-xl bg-white py-2.5 text-sm font-bold text-primary disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Update PIN'}
              </button>
              <button
                type="button"
                className="w-full text-[11px] text-emerald-100"
                onClick={() => setStep('phone')}
              >
                Use a different phone
              </button>
            </>
          )}
          {error && <p className="text-red-200 text-[11px] text-center">{error}</p>}
          {message && <p className="text-emerald-100 text-[11px] text-center">{message}</p>}
        </div>
      )}
    </div>
  );
}
