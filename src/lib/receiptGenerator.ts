import jsPDF from 'jspdf';
import { FormalPdf, formatGhsOfficial, formatOfficialDate, orgFromStore } from './formalPdf';
import { formatOfficialMoney } from './currency';
import { getPaymentMethodLabel } from './paymentMethods';

export interface ReceiptData {
  storeName: string;
  storeAddress: string;
  supportNumber: string;
  /** Optional JPEG/PNG data URL shown at the top of PDF receipts */
  storeLogoUrl?: string;
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
  otherCharges?: Array<{ label: string; amount: number }>;
  total: number;
  paymentMethod: string;
  cashAmount?: number;
  paystackAmount?: number;
  manualPaymentAmount?: number;
  paystackReference?: string;
  paymentReference?: string;
  customerName?: string;
  outstandingBalance?: number;
  currencyCode?: string;
}

function amt(data: ReceiptData, n: number): string {
  return formatOfficialMoney(n, data.currencyCode);
}

function generateReceiptPDF(data: ReceiptData): jsPDF {
  // Create PDF with A7 size (74mm x 105mm) - similar to thermal receipt
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [74, 200], // Width similar to 58mm thermal, height dynamic
  });

  const pageWidth = 74;
  const margin = 4;
  let y = 8;
  const lineHeight = 5;

  // Helper functions
  const centerText = (text: string, yPos: number, size: number = 10) => {
    doc.setFontSize(size);
    const textWidth = doc.getTextWidth(text);
    doc.text(text, (pageWidth - textWidth) / 2, yPos);
  };

  const leftText = (text: string, yPos: number, size: number = 9) => {
    doc.setFontSize(size);
    doc.text(text, margin, yPos);
  };

  const rightText = (text: string, yPos: number, size: number = 9) => {
    doc.setFontSize(size);
    const textWidth = doc.getTextWidth(text);
    doc.text(text, pageWidth - margin - textWidth, yPos);
  };

  const leftRightText = (left: string, right: string, yPos: number, size: number = 9) => {
    doc.setFontSize(size);
    doc.text(left, margin, yPos);
    const rightWidth = doc.getTextWidth(right);
    doc.text(right, pageWidth - margin - rightWidth, yPos);
  };

  const drawLine = (yPos: number) => {
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.line(margin, yPos, pageWidth - margin, yPos);
  };

  const drawDashedLine = (yPos: number) => {
    doc.setDrawColor(180);
    doc.setLineWidth(0.1);
    const dashLen = 1;
    const gapLen = 1;
    for (let x = margin; x < pageWidth - margin; x += dashLen + gapLen) {
      doc.line(x, yPos, Math.min(x + dashLen, pageWidth - margin), yPos);
    }
  };

  // ===== HEADER =====
  if (data.storeLogoUrl && data.storeLogoUrl.startsWith('data:image/')) {
    const logoW = 22;
    const logoH = 22;
    const logoX = (pageWidth - logoW) / 2;
    try {
      const format = data.storeLogoUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(data.storeLogoUrl, format, logoX, y - 2, logoW, logoH);
      y += logoH + 2;
    } catch {
      // Ignore logo render failures — text header still prints
    }
  }

  doc.setFont('helvetica', 'bold');
  centerText(data.storeName || 'STORE', y, 14);
  y += lineHeight + 1;

  doc.setFont('helvetica', 'normal');
  if (data.storeAddress) {
    doc.setFontSize(8);
    const addressLines = doc.splitTextToSize(data.storeAddress, pageWidth - margin * 2);
    addressLines.forEach((line: string) => {
      centerText(line, y, 8);
      y += 4;
    });
  }
  if (data.supportNumber) {
    centerText('Tel: ' + data.supportNumber, y, 8);
    y += lineHeight;
  }

  y += 2;
  drawLine(y);
  y += 4;

  // ===== RECEIPT INFO =====
  doc.setFontSize(8);
  leftRightText('Receipt:', data.receiptNumber, y, 8);
  y += 4;
  leftRightText('Cashier:', data.cashierName, y, 8);
  y += 4;
  leftRightText('Date:', data.dateTime, y, 8);
  y += 5;

  drawDashedLine(y);
  y += 4;

  // ===== ITEMS HEADER =====
  doc.setFont('helvetica', 'bold');
  leftRightText('Item', 'Amount', y, 9);
  y += 4;
  doc.setFont('helvetica', 'normal');
  
  drawDashedLine(y);
  y += 4;

  // ===== ITEMS =====
  data.items.forEach(item => {
    // Item name
    doc.setFontSize(9);
    const maxNameWidth = pageWidth - margin * 2 - 25;
    const name = item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name;
    leftText(name, y, 9);
    y += 4;

    // Quantity x Price = Subtotal
    doc.setFontSize(8);
    const detail = '  ' + item.quantity + ' x ' + amt(data, item.unitPrice);
    const subtotalStr = amt(data, item.subtotal);
    leftRightText(detail, subtotalStr, y, 8);
    y += 5;
  });

  drawDashedLine(y);
  y += 4;

  // ===== TOTALS =====
  doc.setFontSize(9);
  leftRightText('Subtotal:', amt(data, data.subtotal), y, 9);
  y += 4;

  if (data.discount > 0) {
    doc.setTextColor(200, 50, 50);
    leftRightText('Discount:', '-' + amt(data, data.discount), y, 9);
    doc.setTextColor(0);
    y += 4;
  }

  for (const charge of data.otherCharges || []) {
    if (!charge?.amount) continue;
    leftRightText(charge.label + ':', amt(data, charge.amount), y, 9);
    y += 4;
  }

  y += 1;
  drawLine(y);
  y += 5;

  // ===== GRAND TOTAL =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  leftRightText('TOTAL:', amt(data, data.total), y, 12);
  y += 5;
  
  drawLine(y);
  y += 5;

  // ===== PAYMENT METHOD =====
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  const methodLabel = data.paymentMethod === 'paystack' ? 'Mobile Money/Card' : getPaymentMethodLabel(data.paymentMethod);
  
  leftRightText('Payment:', methodLabel, y, 9);
  y += 4;
  if (data.customerName) {
    leftRightText('Customer:', data.customerName, y, 8);
    y += 4;
  }
  if (data.outstandingBalance !== undefined && data.outstandingBalance > 0) {
    leftRightText('Credit due:', amt(data, data.outstandingBalance), y, 8);
    y += 4;
  }

  if (data.paymentMethod === 'split') {
    if (data.cashAmount && data.cashAmount > 0) {
      leftRightText('  Cash:', amt(data, data.cashAmount), y, 8);
      y += 4;
    }
    if (data.paystackAmount && data.paystackAmount > 0) {
      leftRightText('  MoMo/Card:', amt(data, data.paystackAmount), y, 8);
      y += 4;
    }
  }

  if (data.manualPaymentAmount && data.manualPaymentAmount > 0) {
    leftRightText('  Paid:', amt(data, data.manualPaymentAmount), y, 8);
    y += 4;
  }

  const reference = data.paymentReference || data.paystackReference;
  if (reference) {
    doc.setFontSize(7);
    leftRightText('Ref:', reference, y, 7);
    y += 4;
  }

  y += 3;
  drawDashedLine(y);
  y += 6;

  // ===== FOOTER =====
  doc.setFontSize(9);
  centerText('Thank you for your purchase!', y, 9);
  y += 5;
  doc.setFontSize(7);
  centerText('Powered by Adimat POS', y, 7);

  return doc;
}

function generateOfficialReceiptPdf(data: ReceiptData): FormalPdf {
  const pdf = new FormalPdf(
    orgFromStore({
      name: data.storeName,
      address: data.storeAddress,
      support_number: data.supportNumber,
      logo_url: data.storeLogoUrl,
      currency_code: data.currencyCode,
    }),
    {
      title: 'Official receipt',
      subtitle: `Receipt ${data.receiptNumber}`,
      period: `Date of sale: ${data.dateTime}`,
      documentLabel: 'OFFICIAL RECEIPT',
      notes: [
        'This document is an official receipt for goods sold. Please retain it for your records.',
        'Thank you for your custom.',
      ],
    }
  );

  pdf.section('Sale details');
  pdf.kvTable([
    { label: 'Receipt number', value: data.receiptNumber },
    { label: 'Date and time', value: data.dateTime },
    { label: 'Served by', value: data.cashierName || '—' },
    { label: 'Document date', value: formatOfficialDate(new Date()), emphasis: 'muted' },
  ]);

  pdf.section('Items');
  pdf.dataTable(
    ['Description', 'Qty', 'Unit price', 'Amount'],
    data.items.map((item) => [
      item.name,
      String(item.quantity),
      formatGhsOfficial(item.unitPrice, data.currencyCode),
      formatGhsOfficial(item.subtotal, data.currencyCode),
    ]),
    [4, 1, 2, 2]
  );

  const totalRows = [
    { label: 'Subtotal', value: formatGhsOfficial(data.subtotal, data.currencyCode) },
    ...(data.discount > 0
      ? [{ label: 'Discount', value: formatGhsOfficial(-data.discount, data.currencyCode) }]
      : []),
    ...(data.otherCharges || [])
      .filter((c) => c?.amount)
      .map((c) => ({ label: c.label, value: formatGhsOfficial(c.amount, data.currencyCode) })),
    { label: 'Amount payable', value: formatGhsOfficial(data.total, data.currencyCode), emphasis: 'total' as const },
  ];
  pdf.section('Totals');
  pdf.kvTable(totalRows);

  const methodLabel = data.paymentMethod === 'paystack'
    ? 'Mobile money / card'
    : getPaymentMethodLabel(data.paymentMethod);
  const paymentRows = [
    { label: 'Method', value: methodLabel },
    ...(data.customerName ? [{ label: 'Customer', value: data.customerName }] : []),
    ...(data.outstandingBalance !== undefined && data.outstandingBalance > 0
      ? [{ label: 'Credit due', value: formatGhsOfficial(data.outstandingBalance, data.currencyCode) }]
      : []),
    ...(data.paymentMethod === 'split' && data.cashAmount
      ? [{ label: 'Cash portion', value: formatGhsOfficial(data.cashAmount, data.currencyCode) }]
      : []),
    ...(data.paymentMethod === 'split' && data.paystackAmount
      ? [{ label: 'Mobile money / card portion', value: formatGhsOfficial(data.paystackAmount, data.currencyCode) }]
      : []),
    ...(data.manualPaymentAmount
      ? [{ label: 'Amount received', value: formatGhsOfficial(data.manualPaymentAmount, data.currencyCode) }]
      : []),
    ...((data.paymentReference || data.paystackReference)
      ? [{ label: 'Payment reference', value: data.paymentReference || data.paystackReference || '', emphasis: 'muted' as const }]
      : []),
  ];
  pdf.section('Payment');
  pdf.kvTable(paymentRows);
  pdf.signatureBlock('Received by (store)', 'Customer acknowledgement');
  return pdf;
}

export function downloadReceipt(data: ReceiptData): void {
  try {
    const pdf = generateOfficialReceiptPdf(data);
    const filename = 'receipt-' + data.receiptNumber.replace('#', '').replace(/\s/g, '') + '.pdf';
    pdf.save(filename);
  } catch (error) {
    console.error('Error generating PDF:', error);
    downloadReceiptAsText(data);
  }
}

function downloadReceiptAsText(data: ReceiptData): void {
  const text = generateReceiptText(data);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'receipt-' + data.receiptNumber.replace('#', '') + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function shareReceipt(data: ReceiptData): Promise<boolean> {
  const text = generateReceiptText(data);

  // Try to generate PDF for sharing
  let pdfBlob: Blob | null = null;
  try {
    const official = generateOfficialReceiptPdf(data);
    pdfBlob = official.outputBlob();
  } catch (error) {
    console.error('Error generating PDF for sharing:', error);
  }

  // Check if Web Share API with files is supported
  if (pdfBlob && navigator.share && navigator.canShare) {
    try {
      const file = new File(
        [pdfBlob], 
        'receipt-' + data.receiptNumber.replace('#', '') + '.pdf',
        { type: 'application/pdf' }
      );
      
      const shareData = {
        title: 'Receipt ' + data.receiptNumber,
        text: 'Receipt from ' + data.storeName + ' - Total: ' + amt(data, data.total),
        files: [file],
      };

      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return true;
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return false; // User cancelled
      }
      console.error('File sharing failed:', error);
    }
  }

  // Fallback: share as text
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Receipt ' + data.receiptNumber,
        text: text,
      });
      return true;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return false; // User cancelled
      }
      console.error('Text sharing failed:', error);
    }
  }

  // Final fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
    alert('Receipt copied to clipboard!');
    return true;
  } catch (error) {
    console.error('Clipboard copy failed:', error);
    // Last resort: download
    downloadReceiptAsText(data);
    return true;
  }
}

function generateReceiptText(data: ReceiptData): string {
  const lines: string[] = [];
  const width = 32;
  
  const center = (text: string) => {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
  };
  
  const leftRight = (left: string, right: string) => {
    const gap = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(gap) + right;
  };
  
  const line = (char: string = '-') => char.repeat(width);
  
  lines.push(center(data.storeName || 'STORE'));
  if (data.storeAddress) lines.push(center(data.storeAddress));
  if (data.supportNumber) lines.push(center('Tel: ' + data.supportNumber));
  lines.push(line('='));
  lines.push(leftRight('Receipt:', data.receiptNumber));
  lines.push(leftRight('Cashier:', data.cashierName));
  lines.push(leftRight('Date:', data.dateTime));
  lines.push(line('-'));
  
  data.items.forEach(item => {
    lines.push(item.name);
    lines.push(leftRight(
      '  ' + item.quantity + ' x ' + amt(data, item.unitPrice),
      amt(data, item.subtotal)
    ));
  });
  
  lines.push(line('-'));
  lines.push(leftRight('Subtotal:', amt(data, data.subtotal)));
  if (data.discount > 0) {
    lines.push(leftRight('Discount:', '-' + amt(data, data.discount)));
  }
  for (const charge of data.otherCharges || []) {
    if (!charge?.amount) continue;
    lines.push(leftRight(charge.label + ':', amt(data, charge.amount)));
  }
  lines.push(line('='));
  lines.push(leftRight('TOTAL:', amt(data, data.total)));
  lines.push(line('='));
  
  const methodLabel = data.paymentMethod === 'paystack' ? 'Mobile Money/Card' : getPaymentMethodLabel(data.paymentMethod);
  lines.push(leftRight('Payment:', methodLabel));
  if (data.customerName) lines.push(leftRight('  Customer:', data.customerName));
  if (data.outstandingBalance !== undefined && data.outstandingBalance > 0) {
    lines.push(leftRight('  Credit due:', amt(data, data.outstandingBalance)));
  }
  
  if (data.paymentMethod === 'split') {
    if (data.cashAmount) lines.push(leftRight('  Cash:', amt(data, data.cashAmount)));
    if (data.paystackAmount) lines.push(leftRight('  MoMo:', amt(data, data.paystackAmount)));
  }
  if (data.manualPaymentAmount) lines.push(leftRight('  Amount received:', amt(data, data.manualPaymentAmount)));
  const reference = data.paymentReference || data.paystackReference;
  if (reference) lines.push(leftRight('  Reference:', reference));
  
  lines.push('');
  lines.push(center('Thank you for your purchase!'));
  lines.push(center('Powered by Adimat POS'));
  
  return lines.join('\n');
}

export function shareViaWhatsApp(data: ReceiptData, phoneNumber?: string): void {
  const text = generateReceiptText(data);
  const encoded = encodeURIComponent(text);
  const base = phoneNumber
    ? `https://wa.me/${phoneNumber.replace(/\D/g, '')}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  window.open(base, '_blank', 'noopener,noreferrer');
}

export { generateReceiptText };

export type { ReceiptData as PDFReceiptData };
