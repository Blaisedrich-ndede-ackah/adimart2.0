import { useState } from 'react';
import { Store, User, Lock, ArrowRight, Loader2 } from 'lucide-react';
import { createStoreWithOwner } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';

export default function StoreSetupPage() {
  const [step, setStep] = useState<'store' | 'owner'>('store');
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const { setStoreSetup, initialize } = useAuthStore();

  const handleStoreNext = () => {
    if (!storeName.trim()) {
      setError('Please enter your store name');
      return;
    }
    setError('');
    setStep('owner');
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

    setIsCreating(true);

    try {
      await createStoreWithOwner(storeName.trim(), ownerName.trim(), ownerPin);
      setStoreSetup(true);
      await initialize();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create store');
    }

    setIsCreating(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-dark to-primary flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <img src="/logo.png" alt="Adimat" className="w-14 h-14 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white">Welcome to Adimat</h1>
          <p className="text-emerald-200 text-sm mt-1">Let's set up your store</p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className={`w-3 h-3 rounded-full ${step === 'store' ? 'bg-white' : 'bg-white/50'}`} />
          <div className={`w-8 h-0.5 ${step === 'owner' ? 'bg-white' : 'bg-white/30'}`} />
          <div className={`w-3 h-3 rounded-full ${step === 'owner' ? 'bg-white' : 'bg-white/30'}`} />
        </div>

        {/* Step 1: Store Name */}
        {step === 'store' && (
          <div className="bg-white rounded-2xl p-6 shadow-xl animate-fade-in">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <Store className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">Store Details</h2>
                <p className="text-xs text-gray-500">What's your business called?</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Store Name</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="e.g. Kofi's Mini Mart"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <button
                onClick={handleStoreNext}
                className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Owner Account */}
        {step === 'owner' && (
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

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Your Name</label>
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
                  Create 4-Digit PIN
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
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Confirm PIN</label>
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

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('store')}
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
                    <>
                      Create Store
                    </>
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
