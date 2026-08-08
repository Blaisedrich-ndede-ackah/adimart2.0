import { useEffect, useRef } from 'react';
import { subscribeBarcodeScans } from '@/lib/barcodeScannerInput';

/**
 * Subscribe to handheld Bluetooth / HID barcode scanner input while `enabled`.
 */
export function useBluetoothBarcodeInput(
  onScan: (barcode: string) => void,
  enabled: boolean = true
): void {
  const handlerRef = useRef(onScan);
  handlerRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    return subscribeBarcodeScans((barcode) => {
      handlerRef.current(barcode);
    });
  }, [enabled]);
}
