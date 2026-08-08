import jsPDF from 'jspdf';

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
  total: number;
  paymentMethod: string;
  cashAmount?: number;
  paystackAmount?: number;
  paystackReference?: string;
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
    const detail = '  ' + item.quantity + ' x GHS ' + item.unitPrice.toFixed(2);
    const subtotalStr = 'GHS ' + item.subtotal.toFixed(2);
    leftRightText(detail, subtotalStr, y, 8);
    y += 5;
  });

  drawDashedLine(y);
  y += 4;

  // ===== TOTALS =====
  doc.setFontSize(9);
  leftRightText('Subtotal:', 'GHS ' + data.subtotal.toFixed(2), y, 9);
  y += 4;

  if (data.discount > 0) {
    doc.setTextColor(200, 50, 50);
    leftRightText('Discount:', '-GHS ' + data.discount.toFixed(2), y, 9);
    doc.setTextColor(0);
    y += 4;
  }

  y += 1;
  drawLine(y);
  y += 5;

  // ===== GRAND TOTAL =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  leftRightText('TOTAL:', 'GHS ' + data.total.toFixed(2), y, 12);
  y += 5;
  
  drawLine(y);
  y += 5;

  // ===== PAYMENT METHOD =====
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  
  const methodLabel = 
    data.paymentMethod === 'cash' ? 'Cash' :
    data.paymentMethod === 'paystack' ? 'Mobile Money/Card' :
    'Split Payment';
  
  leftRightText('Payment:', methodLabel, y, 9);
  y += 4;

  if (data.paymentMethod === 'split') {
    if (data.cashAmount && data.cashAmount > 0) {
      leftRightText('  Cash:', 'GHS ' + data.cashAmount.toFixed(2), y, 8);
      y += 4;
    }
    if (data.paystackAmount && data.paystackAmount > 0) {
      leftRightText('  MoMo/Card:', 'GHS ' + data.paystackAmount.toFixed(2), y, 8);
      y += 4;
    }
  }

  if (data.paystackReference) {
    doc.setFontSize(7);
    leftRightText('Ref:', data.paystackReference, y, 7);
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

export function downloadReceipt(data: ReceiptData): void {
  try {
    const doc = generateReceiptPDF(data);
    const filename = 'receipt-' + data.receiptNumber.replace('#', '').replace(/\s/g, '') + '.pdf';
    doc.save(filename);
  } catch (error) {
    console.error('Error generating PDF:', error);
    // Fallback: download as text
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
    const doc = generateReceiptPDF(data);
    pdfBlob = doc.output('blob');
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
        text: 'Receipt from ' + data.storeName + ' - Total: GHS ' + data.total.toFixed(2),
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
      '  ' + item.quantity + ' x GHS ' + item.unitPrice.toFixed(2),
      'GHS ' + item.subtotal.toFixed(2)
    ));
  });
  
  lines.push(line('-'));
  lines.push(leftRight('Subtotal:', 'GHS ' + data.subtotal.toFixed(2)));
  if (data.discount > 0) {
    lines.push(leftRight('Discount:', '-GHS ' + data.discount.toFixed(2)));
  }
  lines.push(line('='));
  lines.push(leftRight('TOTAL:', 'GHS ' + data.total.toFixed(2)));
  lines.push(line('='));
  
  const methodLabel = 
    data.paymentMethod === 'cash' ? 'Cash' :
    data.paymentMethod === 'paystack' ? 'Mobile Money/Card' :
    'Split Payment';
  lines.push(leftRight('Payment:', methodLabel));
  
  if (data.paymentMethod === 'split') {
    if (data.cashAmount) lines.push(leftRight('  Cash:', 'GHS ' + data.cashAmount.toFixed(2)));
    if (data.paystackAmount) lines.push(leftRight('  MoMo:', 'GHS ' + data.paystackAmount.toFixed(2)));
  }
  
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
