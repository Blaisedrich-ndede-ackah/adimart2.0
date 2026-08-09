import { Bluetooth } from 'lucide-react';
import BluetoothHardwareSettings from '@/components/BluetoothHardwareSettings';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Bluetooth scanner + printer pairing — available to owners and cashiers.
 */
export default function DevicesPage() {
  const { currentUser } = useAuthStore();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="flex items-center gap-2">
          <Bluetooth className="w-5 h-5 text-white" />
          <div>
            <h1 className="text-white font-bold text-lg">Devices</h1>
            <p className="text-emerald-200 text-xs">
              Pair barcode scanners and thermal printers
              {currentUser?.role === 'cashier' ? ' (cashier access)' : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="page-body no-scrollbar">
        <BluetoothHardwareSettings />
        <p className="text-[11px] text-gray-500 text-center px-4 mt-2 mb-6">
          Cashiers and owners can connect hardware on this device. Pair once, then scan and print from POS.
        </p>
      </div>
    </div>
  );
}
