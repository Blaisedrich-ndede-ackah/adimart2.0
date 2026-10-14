/**
 * Receipt printing for Adimat POS: ESC/POS over Bluetooth when connected,
 * otherwise the computer's native print dialog.
 */

import {
  isPrinterConnected,
  sendPrinterBytes,
  getConnectedPrinterName,
} from './bluetoothPeripherals';
import { buildEscPosLogoRaster } from './escPosImage';
import { formatOfficialMoney } from './currency';
import { getPaymentMethodLabel } from './paymentMethods';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const COMPANY_LOGO_URL = '/logo.png';
const COMPANY_SERVICES_CONTACT = 'Need our services? Contact: +233-555-857-224';

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
  manualPaymentAmount?: number;
  paymentReference?: string;
  currencyCode?: string;
}

/** Alias used by checkout / existing call sites */
export type ReceiptData = EscPosReceiptData;

function amt(data: EscPosReceiptData, n: number): string {
  return formatOfficialMoney(n, data.currencyCode);
}

function companyLogoUrl(): string {
  return typeof window === 'undefined'
    ? COMPANY_LOGO_URL
    : new URL(COMPANY_LOGO_URL, window.location.href).href;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

/** Open the native print window synchronously from a user gesture (needed for reprints). */
export function openComputerPrinterWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  return window.open('', '_blank');
}

function printOnComputer(
  data: EscPosReceiptData,
  printWindow: Window | null | undefined
): { success: boolean; error?: string } {
  const target = printWindow === undefined ? openComputerPrinterWindow() : printWindow;
  if (!target || target.closed) {
    return {
      success: false,
      error: 'Could not open the computer print dialog. Allow pop-ups and try again.',
    };
  }

  const itemRows = data.items.map((item) => `
    <div class="item">
      <div>${escapeHtml(item.name)}</div>
      <div class="item-detail">
        <span>${escapeHtml(`${item.quantity} x ${amt(data, item.unitPrice)}`)}</span>
        <span>${escapeHtml(amt(data, item.subtotal))}</span>
      </div>
    </div>
  `).join('');
  const charges = (data.otherCharges || [])
    .filter((charge) => charge?.amount)
    .map((charge) => `<div class="row"><span>${escapeHtml(charge.label)}:</span><span>${escapeHtml(amt(data, charge.amount))}</span></div>`)
    .join('');
  const paymentMethod = data.paymentMethod === 'paystack'
    ? 'Paystack'
    : getPaymentMethodLabel(data.paymentMethod);
  const paymentDetails = [
    data.paymentMethod === 'split' && data.cashAmount
      ? `<div class="row"><span>Cash:</span><span>${escapeHtml(amt(data, data.cashAmount))}</span></div>`
      : '',
    data.paymentMethod === 'split' && data.paystackAmount
      ? `<div class="row"><span>Mobile money/card:</span><span>${escapeHtml(amt(data, data.paystackAmount))}</span></div>`
      : '',
    data.manualPaymentAmount
      ? `<div class="row"><span>Amount received:</span><span>${escapeHtml(amt(data, data.manualPaymentAmount))}</span></div>`
      : '',
    data.paymentReference
      ? `<div class="row"><span>Reference:</span><span>${escapeHtml(data.paymentReference)}</span></div>`
      : '',
  ].join('');
  const logoUrl = companyLogoUrl();
  const storeLogo = data.storeLogoUrl
    ? `<img class="store-logo" src="${escapeHtml(data.storeLogoUrl)}" alt="">`
    : '';

  target.document.open();
  target.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Receipt ${escapeHtml(data.receiptNumber)}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body { margin: 0; padding: 4mm; color: #111; font: 12px/1.35 Arial, sans-serif; }
          .receipt { width: 72mm; max-width: 100%; margin: 0 auto; }
          .center { text-align: center; }
          .company-logo { display: block; width: 72mm; height: 24mm; object-fit: cover; object-position: center; margin: 0 auto 2mm; }
          .store-logo { display: block; max-width: 42mm; max-height: 18mm; object-fit: contain; margin: 0 auto 2mm; }
          .store { font-size: 17px; font-weight: 700; }
          .rule { border: 0; border-top: 1px dashed #333; margin: 8px 0; }
          .row, .item-detail { display: flex; justify-content: space-between; gap: 8px; }
          .row span:last-child, .item-detail span:last-child { text-align: right; }
          .item { margin: 6px 0; overflow-wrap: anywhere; }
          .item-detail { margin-top: 2px; }
          .total { font-size: 15px; font-weight: 700; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header class="center">
            <img id="company-logo" class="company-logo" src="${escapeHtml(logoUrl)}" alt="Adimat">
            ${storeLogo}
            <div class="store">${escapeHtml(data.storeName || 'Store')}</div>
            ${data.storeAddress ? `<div>${escapeHtml(data.storeAddress)}</div>` : ''}
            ${data.supportNumber ? `<div>Tel: ${escapeHtml(data.supportNumber)}</div>` : ''}
          </header>
          <hr class="rule">
          <div class="row"><span>Receipt:</span><span>${escapeHtml(data.receiptNumber)}</span></div>
          <div class="row"><span>Cashier:</span><span>${escapeHtml(data.cashierName)}</span></div>
          <div class="row"><span>Date:</span><span>${escapeHtml(data.dateTime)}</span></div>
          <hr class="rule">
          <strong>Items</strong>
          ${itemRows}
          <hr class="rule">
          <div class="row"><span>Subtotal:</span><span>${escapeHtml(amt(data, data.subtotal))}</span></div>
          ${data.discount > 0 ? `<div class="row"><span>Discount:</span><span>-${escapeHtml(amt(data, data.discount))}</span></div>` : ''}
          ${charges}
          <hr class="rule">
          <div class="row total"><span>TOTAL:</span><span>${escapeHtml(amt(data, data.total))}</span></div>
          <hr class="rule">
          <div class="row"><span>Payment:</span><span>${escapeHtml(paymentMethod)}</span></div>
          ${paymentDetails}
          <p class="center">Thank you for shopping with us!<br>Powered by Adimat POS</p>
          <p class="center">${escapeHtml(COMPANY_SERVICES_CONTACT)}</p>
        </main>
      </body>
    </html>`);
  target.document.close();

  target.addEventListener('afterprint', () => target.close(), { once: true });
  const startPrint = () => target.setTimeout(() => {
    if (!target.closed) {
      target.focus();
      target.print();
    }
  }, 250);
  const companyLogo = target.document.getElementById('company-logo') as HTMLImageElement | null;
  if (companyLogo && !companyLogo.complete) {
    companyLogo.addEventListener('load', startPrint, { once: true });
    companyLogo.addEventListener('error', startPrint, { once: true });
  } else {
    startPrint();
  }
  return { success: true };
}

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

  // Put the Adimat brand mark first, then the store logo when configured.
  const companyLogoBytes = await buildEscPosLogoRaster(companyLogoUrl());
  if (companyLogoBytes?.length) {
    bytes.push(...companyLogoBytes);
  }
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
    const detail = `  ${item.quantity} x ${amt(data, item.unitPrice)}`;
    const subtotalStr = amt(data, item.subtotal);
    bytes.push(...textToBytes(rightAlign(detail, subtotalStr)));
    bytes.push(LF);
  }

  bytes.push(...textToBytes(line('-')));
  bytes.push(LF);

  bytes.push(...textToBytes(rightAlign('Subtotal:', amt(data, data.subtotal))));
  bytes.push(LF);

  if (data.discount > 0) {
    bytes.push(...textToBytes(rightAlign('Discount:', `-${amt(data, data.discount)}`)));
    bytes.push(LF);
  }

  for (const charge of data.otherCharges || []) {
    if (!charge?.amount) continue;
    bytes.push(...textToBytes(rightAlign(`${charge.label}:`, amt(data, charge.amount))));
    bytes.push(LF);
  }

  bytes.push(...textToBytes(line('=')));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x45, 1));
  bytes.push(...cmd(GS, 0x21, 0x11));
  bytes.push(...textToBytes(rightAlign('TOTAL:', amt(data, data.total))));
  bytes.push(LF);
  bytes.push(...cmd(GS, 0x21, 0x00));
  bytes.push(...cmd(ESC, 0x45, 0));
  bytes.push(...textToBytes(line('=')));
  bytes.push(LF);

  const methodLabel = data.paymentMethod === 'paystack' ? 'Paystack' : getPaymentMethodLabel(data.paymentMethod);
  bytes.push(...textToBytes(rightAlign('Payment:', methodLabel)));
  bytes.push(LF);

  if (data.paymentMethod === 'split') {
    if (data.cashAmount) {
      bytes.push(...textToBytes(rightAlign('  Cash:', amt(data, data.cashAmount))));
      bytes.push(LF);
    }
    if (data.paystackAmount) {
      bytes.push(...textToBytes(rightAlign('  Mobile money/card:', amt(data, data.paystackAmount))));
      bytes.push(LF);
    }
  }

  if (data.manualPaymentAmount) {
    bytes.push(...textToBytes(rightAlign('  Amount received:', amt(data, data.manualPaymentAmount))));
    bytes.push(LF);
  }
  if (data.paymentReference) {
    bytes.push(...textToBytes(rightAlign('  Reference:', data.paymentReference)));
    bytes.push(LF);
  }

  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...textToBytes('Thank you for shopping with us!'));
  bytes.push(LF);
  bytes.push(...textToBytes('Powered by Adimat POS'));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x61, 1));
  bytes.push(...textToBytes(COMPANY_SERVICES_CONTACT));
  bytes.push(LF);
  bytes.push(...cmd(ESC, 0x61, 0));
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
  data: EscPosReceiptData,
  computerPrintWindow?: Window | null
): Promise<{ success: boolean; error?: string }> {
  if (!isPrinterConnected()) {
    return printOnComputer(data, computerPrintWindow);
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
