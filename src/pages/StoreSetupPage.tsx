import { useState } from 'react';
import {
  Store, User, Lock, ArrowRight, Loader2, CloudDownload, Shield, MapPin, Phone,
} from 'lucide-react';
import { createStoreWithOwner, restoreStoreFromCloud } from '@/lib/dexie';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import { useAuthStore } from '@/store/useAuthStore';
import CommunityChatButton from '@/components/CommunityChatButton';

type SetupMode = 'choose' | 'new-store' | 'new-owner' | 'restore';

interface StoreSetupPageProps {
  onOpenAdmin?: () => void;
}

export default function StoreSetupPage({ onOpenAdmin }: StoreSetupPageProps) {
  const [mode, setMode] = useState<SetupMode>('choose');
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [supportNumber, setSupportNumber] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [restoreStoreId, setRestoreStoreId] = useState('');
  const [restorePin, setRestorePin] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { setStoreSetup, initialize } = useAuthStore();

  const handleStoreNext = () => {
    if (!storeName.trim()) {
      setError('Please enter your store name');
      return;
    }
    if (!storeAddress.trim()) {
      setError('Please enter your store address');
      return;
    }
    if (!supportNumber.trim()) {
      setError('Please enter a support phone number');
      return;
    }
    if (!isValidGhanaPhone(supportNumber)) {
      setError('Enter a valid Ghana phone number (e.g. 024XXXXXXX or +23324XXXXXXX)');
      return;
    }
    setError('');
    setMode('new-owner');
  };

  const handleCreateStore = async () => {
    setError('');

    if (!ownerName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (ownerPin.length !== 4) {
      setError('PIN must be exactly 4 digits');
      return;
    }

    if (ownerPin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    // Re-validate profile in case user navigated back/forward
    if (!storeName.trim() || !storeAddress.trim() || !isValidGhanaPhone(supportNumber)) {
      setError('Complete store profile details first');
      setMode('new-store');
      return;
    }

    setIsCreating(true);

    try {
      await createStoreWithOwner(storeName.trim(), ownerName.trim(), ownerPin, {
        address: storeAddress.trim(),
        supportNumber: supportNumber.trim(),
        ownerPhone: supportNumber.trim(),
      });
      setStoreSetup(true);
      await initialize();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create store');
    }

    setIsCreating(false);
  };

  const handleRestore = async () => {
    setError('');

    if (!restoreStoreId.trim()) {
      setError('Enter your Store ID from Settings');
      return;
    }

    if (restorePin.length !== 4) {
      setError('Enter your 4-digit owner PIN');
      return;
    }

    setIsCreating(true);

    try {
      const result = await restoreStoreFromCloud(restoreStoreId.trim(), restorePin);
      if (!result.success) {
        setError(result.message);
      } else {
        setStoreSetup(true);
        await initialize();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    }

    setIsCreating(false);
  };

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 md:w-24 md:h-24 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <img src="/logo.png" alt="Adimat" className="w-14 h-14 md:w-16 md:h-16 object-contain" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Adimat</h1>
          <p className="text-emerald-100/90 text-sm mt-2 text-center">
            {mode === 'choose' ? 'Set up a new store or restore from cloud' : "Let's set up your store"}
          </p>
        </div>

        {mode === 'choose' && (
          <div className="bg-white rounded-2xl p-6 shadow-xl space-y-3 animate-fade-in">
            <button
              onClick={() => setMode('new-store')}
              className="w-full py-4 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <Store className="w-5 h-5" />
              Create New Store
            </button>
            <button
              onClick={() => setMode('restore')}
              className="w-full py-4 border-2 border-primary text-primary rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <CloudDownload className="w-5 h-5" />
              Restore from Cloud
            </button>
            <p className="text-xs text-gray-500 text-center pt-2">
              Use restore if you already have a store synced to Supabase
            </p>
            {onOpenAdmin && (
              <button
                onClick={onOpenAdmin}
                className="w-full mt-2 py-3 text-primary text-sm font-medium flex items-center justify-center gap-2 touch-target"
              >
                <Shield className="w-4 h-4" />
                Administrator portal
              </button>
            )}
            <CommunityChatButton variant="setup" />
          </div>
        )}

        {mode === 'restore' && (
          <div className="bg-white rounded-2xl p-6 shadow-xl animate-fade-in space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Store ID</label>
              <input
                type="text"
                value={restoreStoreId}
                onChange={e => setRestoreStoreId(e.target.value)}
                placeholder="Paste your Store ID"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-primary outline-none"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Owner PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={restorePin}
                onChange={e => setRestorePin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center tracking-[0.5em] focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setMode('choose')} className="flex-1 py-3 border rounded-xl text-gray-700">Back</button>
              <button
                onClick={handleRestore}
                disabled={isCreating}
                className="flex-1 py-3 bg-primary text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Restore'}
              </button>
            </div>
          </div>
        )}

        {mode === 'new-store' && (
          <div className="bg-white rounded-2xl p-6 shadow-xl animate-fade-in">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <Store className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">Store Profile</h2>
                <p className="text-xs text-gray-500">All fields are required</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Store Name *</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="e.g. Kofi's Mini Mart"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  <MapPin className="w-3.5 h-3.5 inline mr-1" />
                  Store Address *
                </label>
                <input
                  type="text"
                  value={storeAddress}
                  onChange={e => setStoreAddress(e.target.value)}
                  placeholder="Street, area, city"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  <Phone className="w-3.5 h-3.5 inline mr-1" />
                  Support Phone *
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={supportNumber}
                  onChange={e => setSupportNumber(e.target.value)}
                  placeholder="024 XXX XXXX"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Used for receipts, subscriptions SMS, and customer contact
                </p>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <div className="flex gap-3">
                <button onClick={() => setMode('choose')} className="flex-1 py-3 border rounded-xl text-gray-700">Back</button>
                <button
                  onClick={handleStoreNext}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'new-owner' && (
          <div className="bg-white rounded-2xl p-6 shadow-xl animate-fade-in">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">Owner Account</h2>
                <p className="text-xs text-gray-500">Create your login credentials</p>
              </div>
            </div>

            <div className="mb-4 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-900">
              <p className="font-semibold truncate">{storeName}</p>
              <p className="truncate text-emerald-800/80">{storeAddress}</p>
              <p className="truncate text-emerald-800/80">{supportNumber}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Your Name *</label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={e => setOwnerName(e.target.value)}
                  placeholder="e.g. Kofi Mensah"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  <Lock className="w-3.5 h-3.5 inline mr-1" />
                  Create 4-Digit PIN *
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={ownerPin}
                  onChange={e => setOwnerPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center tracking-[0.5em] focus:ring-2 focus:ring-primary outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">Choose a PIN only you know — you will use it to sign in</p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Confirm PIN *</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center tracking-[0.5em] focus:ring-2 focus:ring-primary outline-none"
                />
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => setMode('new-store')}
                  className="flex-1 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium touch-target"
                >
                  Back
                </button>
                <button
                  onClick={handleCreateStore}
                  disabled={isCreating}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Store'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="text-emerald-300 text-xs text-center mt-6">
          You can add more staff members later in Settings
        </p>
      </div>
    </div>
  );
}
