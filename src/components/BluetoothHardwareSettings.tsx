import { useCallback, useEffect, useState } from 'react';
import {
  Bluetooth,
  CheckCircle2,
  Loader2,
  Printer,
  ScanBarcode,
  Unplug,
  RefreshCcw,
  AlertCircle,
} from 'lucide-react';
import {
  autoReconnectPeripherals,
  disconnectBleScanner,
  disconnectPrinter,
  forgetBleScanner,
  forgetPrinter,
  getBluetoothHardwareStatus,
  isBluetoothAvailable,
  pairBleScanner,
  pairPrinter,
  reconnectBleScanner,
  reconnectPrinter,
  setHidScannerEnabled,
  subscribeBluetoothStatus,
} from '@/lib/bluetoothPeripherals';
import { printTestPage } from '@/lib/printService';

export default function BluetoothHardwareSettings() {
  const [btAvailable, setBtAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState(getBluetoothHardwareStatus());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    setStatus(getBluetoothHardwareStatus());
  }, []);

  useEffect(() => {
    isBluetoothAvailable().then(setBtAvailable);
    refresh();
    const unsub = subscribeBluetoothStatus(refresh);
    void autoReconnectPeripherals().then(refresh);
    return unsub;
  }, [refresh]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setMessage('');
    try {
      await action();
      refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
    setBusy(null);
  };

  const handlePairPrinter = () =>
    run('pair-printer', async () => {
      const result = await pairPrinter();
      if (!result.success) throw new Error(result.error || 'Failed to pair printer');
      setMessage(`Printer paired: ${result.deviceName}`);
    });

  const handleReconnectPrinter = () =>
    run('reconnect-printer', async () => {
      const result = await reconnectPrinter();
      if (!result.success) throw new Error(result.error || 'Reconnect failed');
      setMessage(`Printer reconnected: ${result.deviceName}`);
    });

  const handleTestPrint = () =>
    run('test-print', async () => {
      const result = await printTestPage();
      if (!result.success) throw new Error(result.error || 'Test print failed');
      setMessage('Test page sent to printer');
    });

  const handlePairScanner = () =>
    run('pair-scanner', async () => {
      const result = await pairBleScanner();
      if (!result.success) throw new Error(result.error || 'Failed to pair scanner');
      setMessage(`Scanner paired: ${result.deviceName}`);
    });

  const handleReconnectScanner = () =>
    run('reconnect-scanner', async () => {
      const result = await reconnectBleScanner();
      if (!result.success) throw new Error(result.error || 'Reconnect failed');
      setMessage(`Scanner reconnected: ${result.deviceName}`);
    });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Bluetooth className="w-5 h-5 text-blue-500" />
        <h3 className="font-bold text-gray-900">Bluetooth Hardware</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Discover and pair handheld barcode scanners and mobile thermal printers for checkout and inventory.
      </p>

      {btAvailable === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-amber-800 text-xs">
            Web Bluetooth is unavailable in this browser. HID scanners paired in system Bluetooth settings still work when HID input is enabled. For BLE pairing use Chrome or Edge on Android/desktop.
          </p>
        </div>
      )}

      {/* Thermal Printer */}
      <div className="border border-gray-100 rounded-xl p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <Printer className="w-4 h-4 text-gray-700" />
          <h4 className="text-sm font-semibold text-gray-900">Thermal Printer</h4>
        </div>

        {status.printerConnected ? (
          <div className="space-y-2">
            <p className="text-sm text-green-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Connected — {status.printerName}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleTestPrint}
                disabled={busy !== null}
                className="py-2.5 bg-primary/10 text-primary rounded-lg text-xs font-medium touch-target disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {busy === 'test-print' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Test Print
              </button>
              <button
                onClick={() => {
                  disconnectPrinter();
                  setMessage('Printer disconnected');
                  refresh();
                }}
                className="py-2.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium touch-target flex items-center justify-center gap-1"
              >
                <Unplug className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
            <button
              onClick={() => {
                forgetPrinter();
                setMessage('Printer pairing cleared');
                refresh();
              }}
              className="w-full py-2 text-[11px] text-gray-500 touch-target"
            >
              Forget printer
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {status.pairedPrinter && (
              <p className="text-xs text-gray-500">
                Last paired: <span className="font-medium text-gray-700">{status.pairedPrinter.name}</span>
              </p>
            )}
            <button
              onClick={handlePairPrinter}
              disabled={busy !== null || btAvailable === false}
              className="w-full py-3 bg-blue-50 text-blue-700 rounded-xl font-medium text-sm flex items-center justify-center gap-2 touch-target disabled:opacity-50"
            >
              {busy === 'pair-printer' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <Bluetooth className="w-4 h-4" />
                  Pair Bluetooth Printer
                </>
              )}
            </button>
            {status.pairedPrinter && (
              <button
                onClick={handleReconnectPrinter}
                disabled={busy !== null}
                className="w-full py-2.5 border border-gray-200 text-gray-700 rounded-xl text-xs font-medium touch-target disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {busy === 'reconnect-printer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                Reconnect Saved Printer
              </button>
            )}
            <p className="text-[10px] text-gray-400 text-center">
              Turn the printer on and put it in pairing mode, then select it from the system picker.
            </p>
          </div>
        )}
      </div>

      {/* Barcode Scanner */}
      <div className="border border-gray-100 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <ScanBarcode className="w-4 h-4 text-gray-700" />
          <h4 className="text-sm font-semibold text-gray-900">Barcode Scanner</h4>
        </div>

        <label className="flex items-center justify-between py-2 mb-3">
          <div className="pr-3">
            <p className="text-sm font-medium text-gray-700">HID Scanner Input</p>
            <p className="text-[11px] text-gray-500">
              Capture scans from Bluetooth Classic / USB scanners paired in system settings (keyboard wedge).
            </p>
          </div>
          <button
            onClick={() => {
              setHidScannerEnabled(!status.hidScannerEnabled);
              refresh();
              setMessage(!status.hidScannerEnabled ? 'HID scanner input enabled' : 'HID scanner input disabled');
            }}
            className={`w-12 h-7 rounded-full transition-colors flex items-center px-0.5 touch-target flex-shrink-0 ${
              status.hidScannerEnabled ? 'bg-primary justify-end' : 'bg-gray-300 justify-start'
            }`}
          >
            <div className="w-6 h-6 bg-white rounded-full shadow" />
          </button>
        </label>

        {status.scannerConnected ? (
          <div className="space-y-2">
            <p className="text-sm text-green-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              BLE scanner connected — {status.scannerName}
            </p>
            <button
              onClick={() => {
                disconnectBleScanner();
                setMessage('BLE scanner disconnected');
                refresh();
              }}
              className="w-full py-2.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium touch-target"
            >
              Disconnect BLE Scanner
            </button>
            <button
              onClick={() => {
                forgetBleScanner();
                setMessage('BLE scanner pairing cleared');
                refresh();
              }}
              className="w-full py-2 text-[11px] text-gray-500 touch-target"
            >
              Forget scanner
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {status.pairedScanner && (
              <p className="text-xs text-gray-500">
                Last paired BLE: <span className="font-medium text-gray-700">{status.pairedScanner.name}</span>
              </p>
            )}
            <button
              onClick={handlePairScanner}
              disabled={busy !== null || btAvailable === false}
              className="w-full py-3 bg-blue-50 text-blue-700 rounded-xl font-medium text-sm flex items-center justify-center gap-2 touch-target disabled:opacity-50"
            >
              {busy === 'pair-scanner' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <ScanBarcode className="w-4 h-4" />
                  Pair BLE Barcode Scanner
                </>
              )}
            </button>
            {status.pairedScanner && (
              <button
                onClick={handleReconnectScanner}
                disabled={busy !== null}
                className="w-full py-2.5 border border-gray-200 text-gray-700 rounded-xl text-xs font-medium touch-target disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {busy === 'reconnect-scanner' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                Reconnect Saved Scanner
              </button>
            )}
            <p className="text-[10px] text-gray-400 text-center">
              Optional for BLE scanners. Most handheld units work with HID Scanner Input after OS pairing.
            </p>
          </div>
        )}
      </div>

      {(message || error) && (
        <p className={`text-xs mt-3 text-center ${error ? 'text-red-600' : 'text-green-600'}`}>
          {error || message}
        </p>
      )}
    </div>
  );
}
