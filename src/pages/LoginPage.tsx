import { useState, useCallback, useEffect } from 'react';
import { Delete, Fingerprint, Shield } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { authenticateWithBiometric, isBiometricAvailable, hasBiometricRegistered } from '@/lib/biometric';
import { db } from '@/lib/dexie';
import { hasStoreLogo } from '@/lib/productImage';

interface LoginPageProps {
  onOpenAdmin?: () => void;
}

export default function LoginPage({ onOpenAdmin }: LoginPageProps) {
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricError, setBiometricError] = useState('');
  const { login, loginError, currentStore } = useAuthStore();
  const storeLogo = currentStore?.logo_url;
  const storeName = currentStore?.name?.trim();

  useEffect(() => {
    async function checkBiometric() {
      const available = await isBiometricAvailable();
      const registered = hasBiometricRegistered();
      setBiometricAvailable(available && registered);
    }
    checkBiometric();
  }, []);

  const handleKeyPress = useCallback(async (key: string) => {
    setBiometricError('');
    
    if (key === 'delete') {
      setPin(prev => prev.slice(0, -1));
      return;
    }

    if (key === 'biometric') {
      handleBiometricLogin();
      return;
    }

    const newPin = pin + key;
    if (newPin.length > 4) return;

    setPin(newPin);

    if (newPin.length === 4) {
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
  }, [pin, login]);

  const handleBiometricLogin = async () => {
    setBiometricError('');
    setIsLoading(true);

    const result = await authenticateWithBiometric();
    
    if (result.success && result.userId) {
      // Find the user and log them in directly
      const user = await db.users.get(result.userId);
      if (user) {
        useAuthStore.setState({ 
          currentUser: user, 
          isAuthenticated: true, 
          loginError: '' 
        });
      } else {
        setBiometricError('User not found. Please login with PIN.');
      }
    } else {
      setBiometricError(result.error || 'Biometric login failed');
    }
    
    setIsLoading(false);
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'biometric', '0', 'delete'];

  return (
    <div className="auth-shell">
      <div className="auth-panel flex flex-col items-center animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 md:w-24 md:h-24 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-lg overflow-hidden">
            {hasStoreLogo(storeLogo) ? (
              <img src={storeLogo!} alt={storeName || 'Store logo'} className="w-full h-full object-cover" />
            ) : (
              <img src="/logo.png" alt="Adimat" className="w-14 h-14 md:w-16 md:h-16 object-contain" />
            )}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            {hasStoreLogo(storeLogo) && storeName ? storeName : 'Adimat'}
          </h1>
          <p className="text-emerald-100/90 text-sm mt-2">
            {hasStoreLogo(storeLogo) && storeName ? 'POS · Enter your PIN' : 'POS · Enter your PIN to continue'}
          </p>
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
                  onClick={() => handleKeyPress(key)}
                  disabled={!biometricAvailable}
                  className={`h-16 md:h-[4.5rem] rounded-2xl flex items-center justify-center touch-target transition-colors ${
                    biometricAvailable
                      ? 'bg-white/20 active:bg-white/30'
                      : 'bg-white/5 opacity-40'
                  }`}
                  title={biometricAvailable ? 'Login with biometrics' : 'Biometrics not set up'}
                >
                  <Fingerprint className={`w-6 h-6 ${biometricAvailable ? 'text-emerald-200' : 'text-gray-400'}`} />
                </button>
              );
            }
            if (key === 'delete') {
              return (
                <button
                  key={key}
                  onClick={() => handleKeyPress(key)}
                  className="h-16 md:h-[4.5rem] rounded-2xl bg-white/10 flex items-center justify-center touch-target active:bg-white/20 transition-colors"
                >
                  <Delete className="w-6 h-6 text-emerald-200" />
                </button>
              );
            }
            return (
              <button
                key={key}
                onClick={() => handleKeyPress(key)}
                disabled={isLoading}
                className="h-16 md:h-[4.5rem] rounded-2xl bg-white/15 text-white text-2xl font-semibold touch-target active:bg-white/30 transition-colors disabled:opacity-50"
              >
                {key}
              </button>
            );
          })}
        </div>

        <div className="mt-8 text-emerald-200/90 text-xs text-center">
          <p>Default Owner PIN: 1234</p>
          {biometricAvailable && (
            <p className="mt-1 text-emerald-100">Biometric login available</p>
          )}
        </div>

        {onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            className="mt-6 flex items-center gap-2 text-emerald-100/80 text-xs font-medium touch-target"
          >
            <Shield className="w-3.5 h-3.5" />
            Administrator portal
          </button>
        )}
      </div>
    </div>
  );
}
