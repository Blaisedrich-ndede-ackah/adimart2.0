const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function textToBytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i));
  }
  return bytes;
}

function cmd(...bytes: number[]): number[] {
  return bytes;
}

function centerText(text: string, width: number = 32): string {
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(padding) + text;
}

function rightAlign(left: string, right: string, width: number = 32): string {
  const gap = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(gap) + right;
}

function line(char: string = '-', width: number = 32): string {
  return char.repeat(width);
}

interface ReceiptData {
  storeName: string;
  storeAddress: string;
  supportNumber: string;
  receiptNumber: string;
  cashierName: string;
  dateTime: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  cashAmount?: number;
  paystackAmount?: number;
}

function buildReceiptBytes(data: ReceiptData): Uint8Array {
  const bytes: number[] = [];

  bytes.push(...cmd(ESC, 0x40));
  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...cmd(ESC, 0x45, 1));
  bytes.push(...textToBytes(data.storeName.toUpperCase()));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x45, 0));

  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...textToBytes(data.storeAddress));
  bytes.push(LF);
  bytes.push(...textToBytes(`Tel: ${data.supportNumber}`));
  bytes.push(LF);

  bytes.push(...cmd(ESC, 0x61, 0));
  bytes.push(...textToBytes(line('=')));
  bytes.push(LF);

  bytes.push(...textToBytes(rightAlign('Receipt:', data.receiptNumber)));
  bytes.push(LF);
  bytes.push(...textToBytes(rightAlign('Cashier:', data.cashierName)));
  bytes.push(LF);
  bytes.push(...textToBytes(rightAlign('Date:', data.dateTime)));
  bytes.push(LF);

  bytes.push(...textToBytes(line('-')));
  bytes.push(LF);

  bytes.push(...cmd(ESC, 0x45, 1));
  bytes.push(...textToBytes(rightAlign('Item', 'Amount')));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x45, 0));
  bytes.push(...textToBytes(line('-')));
  bytes.push(LF);

  for (const item of data.items) {
    const nameLine = item.name.length > 20 ? item.name.substring(0, 20) : item.name;
    bytes.push(...textToBytes(nameLine));
    bytes.push(LF);
    const detail = `  ${item.quantity} x GH₵${item.unitPrice.toFixed(2)}`;
    const subtotalStr = `GH₵${item.subtotal.toFixed(2)}`;
    bytes.push(...textToBytes(rightAlign(detail, subtotalStr)));
    bytes.push(LF);
  }

  bytes.push(...textToBytes(line('-')));
  bytes.push(LF);

  bytes.push(...textToBytes(rightAlign('Subtotal:', `GH₵${data.subtotal.toFixed(2)}`)));
  bytes.push(LF);

  if (data.discount > 0) {
    bytes.push(...textToBytes(rightAlign('Discount:', `-GH₵${data.discount.toFixed(2)}`)));
    bytes.push(LF);
  }

  bytes.push(...textToBytes(line('=')));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x45, 1));
  bytes.push(...cmd(GS, 0x21, 0x11));
  bytes.push(...textToBytes(rightAlign('TOTAL:', `GH₵${data.total.toFixed(2)}`)));
  bytes.push(LF);
  bytes.push(...cmd(GS, 0x21, 0x00));
  bytes.push(...cmd(ESC, 0x45, 0));
  bytes.push(...textToBytes(line('=')));
  bytes.push(LF);

  const methodLabel =
    data.paymentMethod === 'cash' ? 'Cash' :
    data.paymentMethod === 'paystack' ? 'Paystack' :
    'Split Payment';
  bytes.push(...textToBytes(rightAlign('Payment:', methodLabel)));
  bytes.push(LF);

  if (data.paymentMethod === 'split') {
    if (data.cashAmount) {
      bytes.push(...textToBytes(rightAlign('  Cash:', `GH₵${data.cashAmount.toFixed(2)}`)));
      bytes.push(LF);
    }
    if (data.paystackAmount) {
      bytes.push(...textToBytes(rightAlign('  Paystack:', `GH₵${data.paystackAmount.toFixed(2)}`)));
      bytes.push(LF);
    }
  }

  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...textToBytes('Thank you for shopping with us!'));
  bytes.push(LF);
  bytes.push(...textToBytes('Powered by Adimat POS'));
  bytes.push(LF);
  bytes.push(LF);
  bytes.push(LF);
  bytes.push(LF);

  bytes.push(...cmd(GS, 0x56, 0x00));

  return new Uint8Array(bytes);
}

interface PrinterConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
}

let printerConnection: PrinterConnection | null = null;

export async function connectPrinter(): Promise<{ success: boolean; deviceName: string; error?: string }> {
  try {
    if (!navigator.bluetooth) {
      return { success: false, deviceName: '', error: 'Bluetooth not supported on this device.' };
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'],
    });

    if (!device.gatt) {
      return { success: false, deviceName: '', error: 'GATT not available.' };
    }

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
    const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

    printerConnection = { device, characteristic };
    return { success: true, deviceName: device.name || 'Unknown Printer' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('cancelled') || msg.includes('canceled')) {
      return { success: false, deviceName: '', error: 'Printer selection was cancelled.' };
    }
    return { success: false, deviceName: '', error: `Failed to connect: ${msg}` };
  }
}

export async function sendRawBytes(bytes: Uint8Array): Promise<void> {
  if (!printerConnection || !printerConnection.device.gatt?.connected) {
    throw new Error('No printer connected. Go to Settings to connect.');
  }

  const chunkSize = 100;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    await printerConnection.characteristic.writeValue(chunk);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export async function printReceipt(data: ReceiptData): Promise<{ success: boolean; error?: string }> {
  if (!printerConnection || !printerConnection.device.gatt?.connected) {
    return { success: false, error: 'No printer connected. Go to Settings to connect.' };
  }

  try {
    const receiptBytes = buildReceiptBytes(data);
    await sendRawBytes(receiptBytes);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Print failed: ${msg}` };
  }
}

export function isPrinterConnected(): boolean {
  return printerConnection !== null && printerConnection.device.gatt?.connected === true;
}

export function getConnectedPrinterName(): string | null {
  if (printerConnection && printerConnection.device.gatt?.connected) {
    return printerConnection.device.name || 'Unknown Printer';
  }
  return null;
}

export function disconnectPrinter(): void {
  if (printerConnection?.device.gatt?.connected) {
    printerConnection.device.gatt.disconnect();
  }
  printerConnection = null;
}

// Re-export for compatibility
export type { ReceiptData };

// Also accept PDFReceiptData format
export function convertPDFReceiptToESCPOS(data: {
  storeName: string;
  storeAddress: string;
  supportNumber: string;
  receiptNumber: string;
  cashierName: string;
  dateTime: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  cashAmount?: number;
  paystackAmount?: number;
}): ReceiptData {
  return {
    storeName: data.storeName,
    storeAddress: data.storeAddress,
    supportNumber: data.supportNumber,
    receiptNumber: data.receiptNumber,
    cashierName: data.cashierName,
    dateTime: data.dateTime,
    items: data.items,
    subtotal: data.subtotal,
    discount: data.discount,
    total: data.total,
    paymentMethod: data.paymentMethod,
    cashAmount: data.cashAmount,
    paystackAmount: data.paystackAmount,
  };
}
