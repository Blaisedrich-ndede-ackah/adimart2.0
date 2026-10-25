import { useState } from 'react';
import { CloudDownload, Shield, Loader2 } from 'lucide-react';
import { restoreStoreFromCloud } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import CommunityChatButton from '@/components/CommunityChatButton';
import AuthShowcase from '@/components/AuthShowcase';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useT } from '@/lib/i18n';

interface StoreSetupPageProps {
  onOpenAdmin?: () => void;
  onOpenAgent?: () => void;
}

export default function StoreSetupPage({ onOpenAdmin, onOpenAgent }: StoreSetupPageProps) {
  const [restoreStoreId, setRestoreStoreId] = useState('');
  const [restorePin, setRestorePin] = useState('');
  const [error, setError] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const { setStoreSetup, initialize } = useAuthStore();
  const t = useT();

  const handleRestore = async () => {
    setError('');

    if (!restoreStoreId.trim()) {
      setError(t('setup.needStoreId'));
      return;
    }

    if (restorePin.length !== 4) {
      setError(t('setup.needOwnerPin'));
      return;
    }

    setIsRestoring(true);

    try {
      const result = await restoreStoreFromCloud(restoreStoreId.trim(), restorePin);
      if (!result.success) {
        setError(result.message);
      } else {
        setStoreSetup(true);
        await initialize();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('setup.restoreFailed'));
    }

    setIsRestoring(false);
  };

  return (
    <div className="auth-shell wide-auth-shell">
      <AuthShowcase
        variant="store"
        eyebrow="Store setup"
        title="Reconnect your store and carry on."
        description="Restore your synced workspace with the Store ID and owner PIN set by your administrator."
      />
      <div className="auth-panel wide-auth-card">
        <div className="flex flex-col items-center mb-6 sm:mb-8 lg:mb-4">
          <div className="w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 md:w-24 md:h-24 lg:w-20 lg:h-20 bg-white rounded-2xl flex items-center justify-center mb-4 lg:mb-2 shadow-lg">
            <img src="/logo.png" alt="Adimat" className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 lg:w-14 lg:h-14 object-contain" />
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight">Adimat</h1>
          <p className="text-emerald-100/90 text-sm mt-2 text-center px-2">
            {t('setup.chooseTitle')}
          </p>
          <LanguageSwitcher variant="onPrimary" className="mt-4 lg:mt-2 w-full max-w-sm" compact />
        </div>

        <div className="store-setup-form bg-white rounded-2xl p-5 sm:p-6 shadow-xl animate-fade-in space-y-4">
          <div>
            <p className="text-sm font-bold text-slate-900">{t('setup.restore')}</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed text-center">{t('setup.restoreHint')}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Store ID</label>
            <input
              type="text"
              value={restoreStoreId}
              onChange={(e) => setRestoreStoreId(e.target.value)}
              placeholder={t('setup.storeIdPlaceholder')}
              autoComplete="off"
              autoCapitalize="off"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base font-mono focus:ring-2 focus:ring-primary outline-none"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">{t('setup.needOwnerPin')}</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={restorePin}
              onChange={(e) => setRestorePin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold text-center tracking-[0.5em] focus:ring-2 focus:ring-primary outline-none"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={() => void handleRestore()}
            disabled={isRestoring}
            className="w-full py-3.5 bg-primary text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 touch-target"
          >
            {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-5 h-5" />}
            {t('setup.openStore')}
          </button>
          {onOpenAgent && (
            <button
              onClick={onOpenAgent}
              className="w-full py-3 text-primary text-sm font-semibold flex items-center justify-center gap-2 touch-target"
            >
              Agent portal
            </button>
          )}
          {onOpenAdmin && (
            <button
              onClick={onOpenAdmin}
              className="w-full py-3 text-primary text-sm font-semibold flex items-center justify-center gap-2 touch-target"
            >
              <Shield className="w-4 h-4" />
              {t('login.adminPortal')}
            </button>
          )}
          <CommunityChatButton variant="setup" />
        </div>
      </div>
    </div>
  );
}
