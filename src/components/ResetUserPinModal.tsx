import { useState } from 'react';
import { X, Lock, CheckCircle2, AlertTriangle, User } from 'lucide-react';
import { updateUserPin, LocalUser } from '@/lib/dexie';

interface ResetUserPinModalProps {
  isOpen: boolean;
  user: LocalUser | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ResetUserPinModal({ isOpen, user, onClose, onSuccess }: ResetUserPinModalProps) {
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setError('');
    
    if (!user) {
      setError('No user selected');
      return;
    }

    if (newPin.length !== 4) {
      setError('PIN must be 4 digits');
      return;
    }

    if (newPin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    setSaving(true);

    try {
      await updateUserPin(user.id, newPin);

      setSuccess(true);
      setTimeout(() => {
        handleClose();
        onSuccess();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset PIN');
    }

    setSaving(false);
  };

  const handleClose = () => {
    setNewPin('');
    setConfirmPin('');
    setError('');
    setSuccess(false);
    onClose();
  };

  if (!isOpen || !user) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-sm animate-slide-up" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Reset PIN</h2>
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
              <h3 className="text-lg font-bold text-gray-900">PIN Reset!</h3>
              <p className="text-gray-500 text-sm">{user.name}'s PIN has been updated</p>
            </div>
          ) : (
            <>
              {/* User Info */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{user.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{user.role}</p>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* New PIN */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">New PIN</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold tracking-[0.3em] focus:ring-2 focus:ring-primary outline-none"
                    autoFocus
                  />
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
                disabled={saving || newPin.length !== 4 || confirmPin.length !== 4}
                className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2 touch-target disabled:opacity-50 mt-2"
              >
                {saving ? 'Resetting...' : 'Reset PIN'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
