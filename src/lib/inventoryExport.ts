import jsPDF from 'jspdf';
import type { LocalProduct } from './dexie';
import { toMoney, toQty } from './warehouse';

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function filenamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function inventoryRows(products: LocalProduct[]): string[][] {
  return products.map((product) => [
    product.name || '',
    product.category || 'Other',
    product.sku_type || '',
    product.barcode || '',
    String(toQty(product.stock_level)),
    toMoney(product.cost_price).toFixed(2),
    toMoney(product.selling_price).toFixed(2),
    (toQty(product.stock_level) * toMoney(product.cost_price)).toFixed(2),
    product.is_active === 1 ? 'Active' : 'Inactive',
  ]);
}

export function downloadInventoryCsv(
  products: LocalProduct[],
  currencyCode: string,
  storeName: string
): void {
  const headers = [
    'Product',
    'Category',
    'SKU type',
    'Barcode',
    'Stock quantity',
    `Cost price (${currencyCode})`,
    `Selling price (${currencyCode})`,
    `Stock cost value (${currencyCode})`,
    'Status',
  ];
  const rows = inventoryRows(products);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const storePart = filenamePart(storeName);
  const filename = `inventory${storePart ? `-${storePart}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), filename);
}

export function downloadInventoryPdf(
  products: LocalProduct[],
  currencyCode: string,
  storeName: string
): void {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const tableWidth = pageWidth - margin * 2;
  const headers = [
    'Product',
    'Category',
    'SKU type',
    'Barcode',
    'Stock',
    `Cost (${currencyCode})`,
    `Price (${currencyCode})`,
    `Stock value (${currencyCode})`,
    'Status',
  ];
  const weights = [2.7, 1.5, 1.1, 2, 0.8, 1.25, 1.25, 1.5, 1];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => (weight / totalWeight) * tableWidth);
  const rows = inventoryRows(products).map((row) => [
    row[0],
    row[1],
    row[2],
    row[3],
    row[4],
    `${currencyCode} ${row[5]}`,
    `${currencyCode} ${row[6]}`,
    `${currencyCode} ${row[7]}`,
    row[8],
  ]);
  let y = 30;

  const drawTableHeader = () => {
    pdf.setFillColor(241, 245, 249);
    pdf.rect(margin, y - 5, tableWidth, 8, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(51, 65, 85);
    let x = margin;
    headers.forEach((header, index) => {
      pdf.text(header, x + 2, y, { maxWidth: widths[index] - 4 });
      x += widths[index];
    });
    y += 8;
  };

  const drawPageTitle = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(15, 23, 42);
    pdf.text('Inventory', margin, 15);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`${storeName || 'Store'} · Exported ${new Date().toLocaleDateString()}`, margin, 22);
    y = 30;
    drawTableHeader();
  };

  drawPageTitle();
  rows.forEach((row, rowIndex) => {
    if (y + 6 > pageHeight - 12) {
      pdf.addPage();
      drawPageTitle();
    }
    if (rowIndex % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margin, y - 4.5, tableWidth, 7, 'F');
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(15, 23, 42);
    let x = margin;
    row.forEach((cell, index) => {
      const text = pdf.splitTextToSize(cell || '-', widths[index] - 4)[0] || '-';
      pdf.text(text, x + 2, y, { maxWidth: widths[index] - 4 });
      x += widths[index];
    });
    y += 7;
  });

  const storePart = filenamePart(storeName);
  const filename = `inventory${storePart ? `-${storePart}` : ''}-${new Date().toISOString().slice(0, 10)}.pdf`;
  pdf.save(filename);
}
