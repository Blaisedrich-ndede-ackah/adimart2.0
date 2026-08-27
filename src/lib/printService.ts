/**
 * ESC/POS print service for Adimat POS thermal printers.
 * Formats receipt payloads and transmits them over the connected Bluetooth printer.
 */

import {
  isPrinterConnected,
  sendPrinterBytes,
  getConnectedPrinterName,
} from './bluetoothPeripherals';
import { buildEscPosLogoRaster } from './escPosImage';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export interface EscPosReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface EscPosReceiptData {
  storeName: string;
  storeAddress: string;
  supportNumber: string;
  /** Optional JPEG/PNG data URL — printed above the store name when supported */
  storeLogoUrl?: string;
  receiptNumber: string;
  cashierName: string;
  dateTime: string;
  items: EscPosReceiptItem[];
  subtotal: number;
  discount: number;
  otherCharges?: Array<{ label: string; amount: number }>;
  total: number;
  paymentMethod: string;
  cashAmount?: number;
  paystackAmount?: number;
}

/** Alias used by checkout / existing call sites */
export type ReceiptData = EscPosReceiptData;

function textToBytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i) & 0xff);
  }
  return bytes;
}

function cmd(...bytes: number[]): number[] {
  return bytes;
}

function rightAlign(left: string, right: string, width: number = 32): string {
  const gap = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(gap) + right;
}

function line(char: string = '-', width: number = 32): string {
  return char.repeat(width);
}

/**
 * Build a complete ESC/POS byte stream for a sales receipt.
 */
export async function buildEscPosReceipt(data: EscPosReceiptData): Promise<Uint8Array> {
  const bytes: number[] = [];

  // Initialize printer
  bytes.push(...cmd(ESC, 0x40));

  // Optional store logo (centered raster)
  if (data.storeLogoUrl) {
    const logoBytes = await buildEscPosLogoRaster(data.storeLogoUrl);
    if (logoBytes?.length) {
      bytes.push(...logoBytes);
    }
  }

  // Center + bold store name
  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...cmd(ESC, 0x45, 1));
  bytes.push(...textToBytes(data.storeName.toUpperCase()));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x45, 0));

  bytes.push(...cmd(ESC, 0x61, 1));
  if (data.storeAddress) {
    bytes.push(...textToBytes(data.storeAddress));
    bytes.push(LF);
  }
  if (data.supportNumber) {
    bytes.push(...textToBytes(`Tel: ${data.supportNumber}`));
    bytes.push(LF);
  }

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

  for (const charge of data.otherCharges || []) {
    if (!charge?.amount) continue;
    bytes.push(...textToBytes(rightAlign(`${charge.label}:`, `GH₵${charge.amount.toFixed(2)}`)));
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

  // Full cut
  bytes.push(...cmd(GS, 0x56, 0x00));

  return new Uint8Array(bytes);
}

/**
 * Build a short ESC/POS test page to verify the printer connection.
 */
export function buildEscPosTestPage(deviceName?: string): Uint8Array {
  const bytes: number[] = [];
  bytes.push(...cmd(ESC, 0x40));
  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...cmd(ESC, 0x45, 1));
  bytes.push(...textToBytes('ADIMAT POS'));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x45, 0));
  bytes.push(...textToBytes('Printer Test'));
  bytes.push(LF);
  bytes.push(...textToBytes(line('-')));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x61, 0));
  bytes.push(...textToBytes(`Device: ${deviceName || 'Unknown'}`));
  bytes.push(LF);
  bytes.push(...textToBytes(`Time: ${new Date().toLocaleString('en-GH')}`));
  bytes.push(LF);
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...textToBytes('Connection OK'));
  bytes.push(LF);
  bytes.push(LF);
  bytes.push(LF);
  bytes.push(...cmd(GS, 0x56, 0x00));
  return new Uint8Array(bytes);
}

/**
 * Format and transmit a receipt to the connected Bluetooth thermal printer.
 */
export async function printReceipt(
  data: EscPosReceiptData
): Promise<{ success: boolean; error?: string }> {
  if (!isPrinterConnected()) {
    return { success: false, error: 'No printer connected. Pair a printer in Settings → Bluetooth Hardware.' };
  }

  try {
    const receiptBytes = await buildEscPosReceipt(data);
    await sendPrinterBytes(receiptBytes);
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Print failed: ${msg}` };
  }
}

/**
 * Print a short test slip on the connected printer.
 */
export async function printTestPage(): Promise<{ success: boolean; error?: string }> {
  if (!isPrinterConnected()) {
    return { success: false, error: 'No printer connected.' };
  }

  try {
    await sendPrinterBytes(buildEscPosTestPage(getConnectedPrinterName() || undefined));
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Test print failed: ${msg}` };
  }
}

/**
 * Transmit raw ESC/POS bytes (labels, custom slips, etc.).
 */
export async function printRawBytes(bytes: Uint8Array): Promise<void> {
  await sendPrinterBytes(bytes);
}

export function convertPDFReceiptToESCPOS(data: EscPosReceiptData): EscPosReceiptData {
  return { ...data };
}
