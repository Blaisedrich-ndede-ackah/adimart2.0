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

function drawBarcodeLabel(
  doc: jsPDF,
  product: LocalProduct,
  storeName: string,
  currencyCode?: string
): void {
  const barcode = ensureProductBarcode(product);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(storeName.slice(0, 28), 29, 6, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(product.name.slice(0, 28), 29, 12, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(formatOfficialMoney(product.selling_price, currencyCode), 29, 18, { align: 'center' });
  doc.setFont('courier', 'normal');
  doc.setFontSize(10);
  doc.text(barcode, 29, 28, { align: 'center' });
  doc.setFontSize(7);
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
