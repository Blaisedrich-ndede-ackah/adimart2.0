import { useState } from 'react';
import { X, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import { db, hashPin } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePinModal({ isOpen, onClose }: ChangePinModalProps) {
  const { currentUser } = useAuthStore();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setError('');
    
    if (!currentUser) {
      setError('No user logged in');
      return;
    }

    // Validate current PIN
    if (currentPin.length !== 4) {
      setError('Current PIN must be 4 digits');
      return;
    }

    // Verify current PIN is correct
    const currentPinHash = hashPin(currentPin);
    if (currentPinHash !== currentUser.pin_hash) {
      setError('Current PIN is incorrect');
      return;
    }

    // Validate new PIN
    if (newPin.length !== 4) {
      setError('New PIN must be 4 digits');
      return;
    }

    if (newPin === currentPin) {
      setError('New PIN must be different from current PIN');
      return;
    }

    // Confirm PINs match
    if (newPin !== confirmPin) {
      setError('New PINs do not match');
      return;
    }

    setSaving(true);

    try {
      const newPinHash = hashPin(newPin);
      await db.users.update(currentUser.id, {
        pin_hash: newPinHash,
        synced: 0,
      });

      // Update the current user in auth store
      useAuthStore.setState({
        currentUser: {
          ...currentUser,
          pin_hash: newPinHash,
        },
      });

      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update PIN');
    }

    setSaving(false);
  };

  const handleClose = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError('');
    setSuccess(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-sm animate-slide-up" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Change PIN</h2>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-gray-100 touch-target">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">PIN Updated!</h3>
              <p className="text-gray-500 text-sm">Your new PIN is now active</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Current PIN */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Current PIN</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showCurrentPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={4}
                    value={currentPin}
                    onChange={e => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl text-lg font-semibold tracking-[0.3em] focus:ring-2 focus:ring-primary outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPin(!showCurrentPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                  >
                    {showCurrentPin ? (
                      <EyeOff className="w-4 h-4 text-gray-400" />
                    ) : (
                      <Eye className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* New PIN */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">New PIN</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showNewPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={4}
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl text-lg font-semibold tracking-[0.3em] focus:ring-2 focus:ring-primary outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPin(!showNewPin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                  >
                    {showNewPin ? (
                      <EyeOff className="w-4 h-4 text-gray-400" />
                    ) : (
                      <Eye className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm New PIN */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">Confirm New PIN</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={confirmPin}
                    onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl text-lg font-semibold tracking-[0.3em] focus:ring-2 focus:ring-primary outline-none"
                  />
                  {confirmPin.length === 4 && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {confirmPin === newPin ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <X className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={saving || currentPin.length !== 4 || newPin.length !== 4 || confirmPin.length !== 4}
                className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50 mt-2"
              >
                {saving ? 'Updating...' : 'Update PIN'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
