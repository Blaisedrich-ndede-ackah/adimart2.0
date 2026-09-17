import { Bluetooth } from 'lucide-react';
import BluetoothHardwareSettings from '@/components/BluetoothHardwareSettings';
import CloudSyncPanel from '@/components/CloudSyncPanel';
import { useAuthStore } from '@/store/useAuthStore';
import { useT } from '@/lib/i18n';

/**
 * Bluetooth pairing + cloud sync — available to owners and cashiers.
 */
export default function DevicesPage() {
  const { currentUser } = useAuthStore();
  const t = useT();
  const isCashier = currentUser?.role === 'cashier';

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-2">
          <Bluetooth className="w-5 h-5 text-white" />
          <div>
            <h1 className="text-white font-bold text-lg">{t('devices.title')}</h1>
            <p className="text-emerald-200 text-xs">
              {isCashier ? t('devices.cashierSubtitle') : t('devices.ownerSubtitle')}
            </p>
          </div>
        </div>
      </div>

      <div className="page-body no-scrollbar">
        {isCashier && (
          <CloudSyncPanel hint={t('sync.cashierHint')} />
        )}
        <BluetoothHardwareSettings />
        <p className="text-[11px] text-gray-500 text-center px-4 mt-2 mb-6">
          {t('devices.hardwareHint')}
        </p>
      </div>
    </div>
  );
}
