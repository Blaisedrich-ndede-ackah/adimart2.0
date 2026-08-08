/**
 * Bluetooth peripheral manager for Adimat POS.
 * Discovers, pairs, and maintains connections to:
 *  - ESC/POS mobile thermal printers (BLE Serial Port Profile / 0x18F0)
 *  - Handheld BLE barcode scanners (Nordic UART / generic notify)
 *
 * Most Bluetooth Classic handheld scanners appear as HID keyboards at the OS
 * level — those are handled by the HID wedge listener in barcodeScannerInput.ts.
 */

export const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
export const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

/** Nordic UART Service — common on BLE barcode scanners */
export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const STORAGE_KEY = 'adimat_bluetooth_peripherals';

export type PeripheralKind = 'printer' | 'scanner';

export interface PairedDeviceInfo {
  id: string;
  name: string;
  kind: PeripheralKind;
  pairedAt: string;
}

export interface BluetoothHardwarePrefs {
  printer: PairedDeviceInfo | null;
  scanner: PairedDeviceInfo | null;
  /** Capture keyboard-wedge HID scanners (OS-paired Bluetooth Classic) */
  hidScannerEnabled: boolean;
}

interface PrinterConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
}

interface ScannerConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
}

let printerConnection: PrinterConnection | null = null;
let scannerConnection: ScannerConnection | null = null;

type ScannerListener = (barcode: string) => void;
const scannerListeners = new Set<ScannerListener>();
type StatusListener = () => void;
const statusListeners = new Set<StatusListener>();

function notifyStatus(): void {
  statusListeners.forEach((fn) => fn());
}

export function subscribeBluetoothStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function subscribeBleScanner(listener: ScannerListener): () => void {
  scannerListeners.add(listener);
  return () => scannerListeners.delete(listener);
}

function emitBarcode(raw: string): void {
  const barcode = raw.replace(/[\r\n\t]+/g, '').trim();
  if (barcode.length < 3) return;
  scannerListeners.forEach((fn) => fn(barcode));
}

function defaultPrefs(): BluetoothHardwarePrefs {
  return {
    printer: null,
    scanner: null,
    hidScannerEnabled: true,
  };
}

export function loadBluetoothPrefs(): BluetoothHardwarePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<BluetoothHardwarePrefs>;
    return {
      ...defaultPrefs(),
      ...parsed,
      printer: parsed.printer ?? null,
      scanner: parsed.scanner ?? null,
      hidScannerEnabled: parsed.hidScannerEnabled !== false,
    };
  } catch {
    return defaultPrefs();
  }
}

export function saveBluetoothPrefs(prefs: BluetoothHardwarePrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  notifyStatus();
}

export function setHidScannerEnabled(enabled: boolean): void {
  const prefs = loadBluetoothPrefs();
  prefs.hidScannerEnabled = enabled;
  saveBluetoothPrefs(prefs);
}

export function isBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export async function isBluetoothAvailable(): Promise<boolean> {
  if (!isBluetoothSupported()) return false;
  try {
    return await navigator.bluetooth.getAvailability();
  } catch {
    return false;
  }
}

function rememberDevice(kind: PeripheralKind, device: BluetoothDevice): void {
  const prefs = loadBluetoothPrefs();
  const info: PairedDeviceInfo = {
    id: device.id,
    name: device.name || (kind === 'printer' ? 'Thermal Printer' : 'Barcode Scanner'),
    kind,
    pairedAt: new Date().toISOString(),
  };
  if (kind === 'printer') prefs.printer = info;
  else prefs.scanner = info;
  saveBluetoothPrefs(prefs);
}

function clearRemembered(kind: PeripheralKind): void {
  const prefs = loadBluetoothPrefs();
  if (kind === 'printer') prefs.printer = null;
  else prefs.scanner = null;
  saveBluetoothPrefs(prefs);
}

function attachDisconnectHandler(device: BluetoothDevice, kind: PeripheralKind): void {
  const onDisconnect = () => {
    if (kind === 'printer' && printerConnection?.device.id === device.id) {
      printerConnection = null;
    }
    if (kind === 'scanner' && scannerConnection?.device.id === device.id) {
      scannerConnection = null;
    }
    notifyStatus();
  };
  device.addEventListener('gattserverdisconnected', onDisconnect);
}

async function openPrinterGatt(device: BluetoothDevice): Promise<PrinterConnection> {
  if (!device.gatt) {
    throw new Error('GATT not available on this printer.');
  }
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);
  attachDisconnectHandler(device, 'printer');
  return { device, characteristic };
}

/**
 * Discover and pair a Bluetooth thermal printer (Web Bluetooth chooser).
 */
export async function pairPrinter(): Promise<{ success: boolean; deviceName: string; error?: string }> {
  try {
    if (!isBluetoothSupported()) {
      return { success: false, deviceName: '', error: 'Web Bluetooth is not supported in this browser. Use Chrome or Edge on Android/desktop.' };
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [PRINTER_SERVICE_UUID] },
        { namePrefix: 'POS' },
        { namePrefix: 'Printer' },
        { namePrefix: 'MTP' },
        { namePrefix: 'BlueTooth Printer' },
        { namePrefix: 'BT' },
      ],
      optionalServices: [PRINTER_SERVICE_UUID],
    });

    const connection = await openPrinterGatt(device);
    printerConnection = connection;
    rememberDevice('printer', device);
    notifyStatus();
    return { success: true, deviceName: device.name || 'Thermal Printer' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(msg)) {
      return { success: false, deviceName: '', error: 'Printer selection was cancelled.' };
    }
    // Fallback: allow picking any device with the printer service as optional
    if (/no devices|not found|NetworkError/i.test(msg)) {
      try {
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [PRINTER_SERVICE_UUID],
        });
        const connection = await openPrinterGatt(device);
        printerConnection = connection;
        rememberDevice('printer', device);
        notifyStatus();
        return { success: true, deviceName: device.name || 'Thermal Printer' };
      } catch (fallbackErr: unknown) {
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        if (/cancel/i.test(fallbackMsg)) {
          return { success: false, deviceName: '', error: 'Printer selection was cancelled.' };
        }
        return { success: false, deviceName: '', error: `Failed to connect: ${fallbackMsg}` };
      }
    }
    return { success: false, deviceName: '', error: `Failed to connect: ${msg}` };
  }
}

/** @deprecated Use pairPrinter — kept for call-site compatibility */
export const connectPrinter = pairPrinter;

export async function reconnectPrinter(): Promise<{ success: boolean; deviceName: string; error?: string }> {
  const prefs = loadBluetoothPrefs();
  if (!prefs.printer) {
    return { success: false, deviceName: '', error: 'No printer paired yet. Tap Pair Printer first.' };
  }

  if (isPrinterConnected()) {
    return { success: true, deviceName: getConnectedPrinterName() || prefs.printer.name };
  }

  try {
    if (!navigator.bluetooth.getDevices) {
      return { success: false, deviceName: '', error: 'Auto-reconnect not supported. Pair the printer again.' };
    }
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => d.id === prefs.printer?.id);
    if (!device) {
      return { success: false, deviceName: '', error: 'Saved printer not found. Pair it again.' };
    }
    const connection = await openPrinterGatt(device);
    printerConnection = connection;
    notifyStatus();
    return { success: true, deviceName: device.name || prefs.printer.name };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, deviceName: '', error: `Reconnect failed: ${msg}` };
  }
}

export function disconnectPrinter(): void {
  if (printerConnection?.device.gatt?.connected) {
    printerConnection.device.gatt.disconnect();
  }
  printerConnection = null;
  notifyStatus();
}

export function forgetPrinter(): void {
  disconnectPrinter();
  clearRemembered('printer');
}

export function isPrinterConnected(): boolean {
  return printerConnection !== null && printerConnection.device.gatt?.connected === true;
}

export function getConnectedPrinterName(): string | null {
  if (isPrinterConnected()) {
    return printerConnection!.device.name || loadBluetoothPrefs().printer?.name || 'Thermal Printer';
  }
  return null;
}

export async function sendPrinterBytes(bytes: Uint8Array): Promise<void> {
  if (!printerConnection || !printerConnection.device.gatt?.connected) {
    throw new Error('No printer connected. Pair a printer in Settings → Bluetooth Hardware.');
  }

  const chunkSize = 100;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    await printerConnection.characteristic.writeValue(chunk);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Alias for barcodeLabels / legacy imports */
export const sendRawBytes = sendPrinterBytes;

function decodeScannerValue(value?: DataView): string {
  if (!value) return '';
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return Array.from(bytes)
      .map((b) => String.fromCharCode(b))
      .join('');
  }
}

async function openScannerGatt(device: BluetoothDevice): Promise<ScannerConnection> {
  if (!device.gatt) {
    throw new Error('GATT not available on this scanner.');
  }

  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const services = await server.getPrimaryServices();

  let notifyChar: BluetoothRemoteGATTCharacteristic | null = null;

  // Prefer Nordic UART TX (notify)
  for (const service of services) {
    const uuid = service.uuid.toLowerCase();
    if (uuid === NUS_SERVICE_UUID || uuid.includes('6e400001')) {
      try {
        const tx = await service.getCharacteristic(NUS_TX_UUID);
        notifyChar = tx;
        break;
      } catch {
        // try other characteristics below
      }
    }
  }

  if (!notifyChar) {
    for (const service of services) {
      try {
        const chars = await service.getCharacteristics();
        for (const char of chars) {
          if (char.properties.notify || char.properties.indicate) {
            notifyChar = char;
            break;
          }
        }
      } catch {
        // continue
      }
      if (notifyChar) break;
    }
  }

  if (!notifyChar) {
    throw new Error('This device has no readable barcode characteristic. Use HID scanner mode instead.');
  }

  await notifyChar.startNotifications();
  const onValue = (event: Event) => {
    const target = event.target as unknown as BluetoothRemoteGATTCharacteristic | null;
    const text = decodeScannerValue(target?.value);
    if (text) emitBarcode(text);
  };
  notifyChar.addEventListener('characteristicvaluechanged', onValue);
  attachDisconnectHandler(device, 'scanner');

  return { device, characteristic: notifyChar };
}

/**
 * Discover and pair a BLE barcode scanner via the Web Bluetooth chooser.
 */
export async function pairBleScanner(): Promise<{ success: boolean; deviceName: string; error?: string }> {
  try {
    if (!isBluetoothSupported()) {
      return {
        success: false,
        deviceName: '',
        error: 'Web Bluetooth is not supported. For Classic Bluetooth scanners, enable HID Scanner Input and pair the device in system Bluetooth settings.',
      };
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [NUS_SERVICE_UUID] },
        { namePrefix: 'Scanner' },
        { namePrefix: 'Barcode' },
        { namePrefix: 'Scan' },
        { namePrefix: 'NT' },
        { namePrefix: 'KDC' },
      ],
      optionalServices: [NUS_SERVICE_UUID],
    });

    if (scannerConnection?.device.gatt?.connected) {
      scannerConnection.device.gatt.disconnect();
    }

    const connection = await openScannerGatt(device);
    scannerConnection = connection;
    rememberDevice('scanner', device);
    notifyStatus();
    return { success: true, deviceName: device.name || 'Barcode Scanner' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(msg)) {
      return { success: false, deviceName: '', error: 'Scanner selection was cancelled.' };
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [NUS_SERVICE_UUID],
      });
      if (scannerConnection?.device.gatt?.connected) {
        scannerConnection.device.gatt.disconnect();
      }
      const connection = await openScannerGatt(device);
      scannerConnection = connection;
      rememberDevice('scanner', device);
      notifyStatus();
      return { success: true, deviceName: device.name || 'Barcode Scanner' };
    } catch (fallbackErr: unknown) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      if (/cancel/i.test(fallbackMsg)) {
        return { success: false, deviceName: '', error: 'Scanner selection was cancelled.' };
      }
      return {
        success: false,
        deviceName: '',
        error: `Failed to connect BLE scanner: ${fallbackMsg}. Tip: most handheld scanners work as HID keyboards — enable HID Scanner Input below.`,
      };
    }
  }
}

export async function reconnectBleScanner(): Promise<{ success: boolean; deviceName: string; error?: string }> {
  const prefs = loadBluetoothPrefs();
  if (!prefs.scanner) {
    return { success: false, deviceName: '', error: 'No BLE scanner paired yet.' };
  }
  if (isBleScannerConnected()) {
    return { success: true, deviceName: getConnectedScannerName() || prefs.scanner.name };
  }

  try {
    if (!navigator.bluetooth.getDevices) {
      return { success: false, deviceName: '', error: 'Auto-reconnect not supported. Pair the scanner again.' };
    }
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => d.id === prefs.scanner?.id);
    if (!device) {
      return { success: false, deviceName: '', error: 'Saved scanner not found. Pair it again.' };
    }
    const connection = await openScannerGatt(device);
    scannerConnection = connection;
    notifyStatus();
    return { success: true, deviceName: device.name || prefs.scanner.name };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, deviceName: '', error: `Reconnect failed: ${msg}` };
  }
}

export function disconnectBleScanner(): void {
  if (scannerConnection?.device.gatt?.connected) {
    scannerConnection.device.gatt.disconnect();
  }
  scannerConnection = null;
  notifyStatus();
}

export function forgetBleScanner(): void {
  disconnectBleScanner();
  clearRemembered('scanner');
}

export function isBleScannerConnected(): boolean {
  return scannerConnection !== null && scannerConnection.device.gatt?.connected === true;
}

export function getConnectedScannerName(): string | null {
  if (isBleScannerConnected()) {
    return scannerConnection!.device.name || loadBluetoothPrefs().scanner?.name || 'Barcode Scanner';
  }
  return null;
}

export function getBluetoothHardwareStatus(): {
  bluetoothSupported: boolean;
  printerConnected: boolean;
  printerName: string | null;
  pairedPrinter: PairedDeviceInfo | null;
  scannerConnected: boolean;
  scannerName: string | null;
  pairedScanner: PairedDeviceInfo | null;
  hidScannerEnabled: boolean;
} {
  const prefs = loadBluetoothPrefs();
  return {
    bluetoothSupported: isBluetoothSupported(),
    printerConnected: isPrinterConnected(),
    printerName: getConnectedPrinterName(),
    pairedPrinter: prefs.printer,
    scannerConnected: isBleScannerConnected(),
    scannerName: getConnectedScannerName(),
    pairedScanner: prefs.scanner,
    hidScannerEnabled: prefs.hidScannerEnabled,
  };
}

/**
 * Attempt silent reconnect of previously permitted peripherals on app start.
 */
export async function autoReconnectPeripherals(): Promise<void> {
  if (!isBluetoothSupported()) return;
  const prefs = loadBluetoothPrefs();
  try {
    if (prefs.printer && !isPrinterConnected()) {
      await reconnectPrinter();
    }
  } catch {
    // silent
  }
  try {
    if (prefs.scanner && !isBleScannerConnected()) {
      await reconnectBleScanner();
    }
  } catch {
    // silent
  }
}
