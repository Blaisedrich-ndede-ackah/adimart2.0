import jsPDF from 'jspdf';
import { LocalProduct } from './dexie';
import { isPrinterConnected, sendRawBytes } from './bluetoothPeripherals';
import { formatOfficialMoney } from './currency';

export function ensureProductBarcode(product: LocalProduct): string {
  if (product.barcode?.trim()) return product.barcode.trim();
  const numeric = product.id.replace(/\D/g, '').slice(0, 12).padStart(12, '0');
  return `2${numeric.slice(0, 11)}`;
}

function buildCode128Bytes(data: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i++) {
    bytes.push(data.charCodeAt(i));
  }
  return bytes;
}

export async function printBarcodeLabel(
  product: LocalProduct,
  storeName: string,
  currencyCode?: string
): Promise<void> {
  const barcode = ensureProductBarcode(product);
  const bytes: number[] = [];

  bytes.push(0x1b, 0x40);
  bytes.push(0x1b, 0x61, 0x01);
  bytes.push(...Array.from(new TextEncoder().encode(storeName.slice(0, 24))));
  bytes.push(0x0a);
  bytes.push(...Array.from(new TextEncoder().encode(product.name.slice(0, 24))));
  bytes.push(0x0a);
  bytes.push(...Array.from(new TextEncoder().encode(formatOfficialMoney(product.selling_price, currencyCode))));
  bytes.push(0x0a);
  bytes.push(0x1b, 0x61, 0x01);
  bytes.push(0x1d, 0x68, 60);
  bytes.push(0x1d, 0x77, 2);
  bytes.push(0x1d, 0x48, 2);
  bytes.push(0x1d, 0x6b, 73, barcode.length);
  bytes.push(...buildCode128Bytes(barcode));
  bytes.push(0x0a, 0x0a, 0x0a);

  if (!isPrinterConnected()) {
    throw new Error('No printer connected. Connect a Bluetooth printer in Settings.');
  }

  await sendRawBytes(new Uint8Array(bytes));
}

/** Code 128 symbol patterns, values 0 through 106. 106 is the stop symbol. */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export function code128Modules(value: string): number[] {
  const symbols = [104];
  for (const character of value) {
    const code = character.charCodeAt(0) - 32;
    if (code >= 0 && code <= 95) symbols.push(code);
  }
  if (symbols.length === 1) symbols.push(0);
  let checksum = symbols[0];
  for (let index = 1; index < symbols.length; index += 1) checksum += symbols[index] * index;
  symbols.push(checksum % 103);
  symbols.push(106);
  const modules: number[] = [];
  for (const symbol of symbols) {
    for (const width of CODE128[symbol] || '') modules.push(Number(width));
  }
  modules.push(2);
  return modules;
}

function drawCode128(doc: jsPDF, value: string, x: number, y: number, maxWidth: number, height: number): void {
  const modules = code128Modules(value);
  const units = modules.reduce((sum, width) => sum + width, 0) + 20;
  const moduleWidth = Math.min(0.42, maxWidth / units);
  let cursor = x + moduleWidth * 10;
  let bar = true;
  for (const width of modules) {
    const drawn = moduleWidth * width;
    if (bar) doc.rect(cursor, y, drawn, height, 'F');
    cursor += drawn;
    bar = !bar;
  }
}

function drawBarcodeLabel(
  doc: jsPDF,
  product: LocalProduct,
  storeName: string,
  currencyCode?: string
): void {
  const barcode = ensureProductBarcode(product);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(storeName.slice(0, 28), 29, 5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(product.name.slice(0, 28), 29, 9, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(formatOfficialMoney(product.selling_price, currencyCode), 29, 14, { align: 'center' });
  drawCode128(doc, barcode, 4, 16, 50, 10);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7);
  doc.text(barcode, 29, 30, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.text('Scan at checkout', 29, 34, { align: 'center' });
}

export function downloadBarcodeLabel(
  product: LocalProduct,
  storeName: string,
  currencyCode?: string
): void {
  downloadBarcodeLabels([product], storeName, currencyCode, 1);
}

/** One shelf label per page, repeated for the requested number of copies. */
export function downloadBarcodeLabels(
  products: LocalProduct[],
  storeName: string,
  currencyCode?: string,
  copies = 1
): void {
  const labels = products.filter(Boolean);
  if (labels.length === 0) return;
  const repeat = Math.max(1, Math.min(20, Math.floor(copies) || 1));
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [58, 40],
  });
  let first = true;
  for (const product of labels) {
    for (let copy = 0; copy < repeat; copy += 1) {
      if (!first) doc.addPage([58, 40], 'landscape');
      first = false;
      drawBarcodeLabel(doc, product, storeName, currencyCode);
    }
  }
  const safeName = labels.length === 1
    ? labels[0].name.replace(/[^a-z0-9]/gi, '_').slice(0, 20)
    : `${labels.length}-products`;
  doc.save(`label-${safeName}.pdf`);
}
