/**
 * Agent subscription invoice PDF generator.
 * Produces an A4 invoice (#INV-YYYYMMDD-XXXX) that an agent can share
 * with a store owner for Paystack / MoMo payment.
 */

import jsPDF from 'jspdf';
import { formatOfficialMoney } from './currency';
import { formatOfficialDate } from './formalPdf';

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 18;
const RIGHT = PAGE_W - MARGIN_X;
const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const RULE = [203, 213, 225];
const HEADER_BG = [6, 78, 59];

export interface AgentInvoicePdfData {
  invoiceNumber: string;
  agentName: string;
  agentPhone: string;
  storeName: string;
  ownerName: string;
  ownerPhone: string;
  subscriptionPackage: string;
  amountGhs: number;
  dueDate?: string | null;
  description?: string;
  paystackReference?: string;
  status: 'issued' | 'paid' | 'partial' | 'overdue' | 'cancelled';
  paystackPayUrl?: string;
  generatedAt: string;
}


export function generateAgentInvoicePdf(data: AgentInvoicePdfData): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ---- Header band ----
  doc.setFillColor(HEADER_BG[0], HEADER_BG[1], HEADER_BG[2]);
  doc.rect(0, 0, PAGE_W, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('ADIMAT AGENT PORTAL', MARGIN_X, 22);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Subscription Invoice', MARGIN_X, 30);

  // Invoice number on right of header
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  const invWidth = doc.getTextWidth(data.invoiceNumber);
  doc.text(data.invoiceNumber, RIGHT - invWidth, 22);

  let y = 50;

  // ---- Invoice meta grid ----
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Invoice Details', MARGIN_X, y);
  y += 7;

  const row = (label: string, value: string, yPos: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(label, MARGIN_X, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(value, MARGIN_X + 55, yPos);
  };

  row('Invoice #', data.invoiceNumber, y); y += 6;
  row('Status', data.status.toUpperCase(), y); y += 6;
  row('Date Issued', formatOfficialDate(data.generatedAt), y); y += 6;
  if (data.dueDate) { row('Due Date', formatOfficialDate(data.dueDate), y); y += 6; }
  row('Amount', formatOfficialMoney(data.amountGhs, 'GHS'), y); y += 10;

  // ---- Agent / Store info ----
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('Agent (Onboarding)', MARGIN_X, y); y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(data.agentName, MARGIN_X, y); y += 4;
  doc.text(data.agentPhone, MARGIN_X, y); y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('Store / Prospect', MARGIN_X, y); y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(data.storeName, MARGIN_X, y); y += 4;
  doc.text(`Owner: ${data.ownerName}`, MARGIN_X, y); y += 4;
  doc.text(`Phone: ${data.ownerPhone}`, MARGIN_X, y); y += 8;

  if (data.subscriptionPackage) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('Subscription Package', MARGIN_X, y); y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(data.subscriptionPackage, MARGIN_X, y); y += 8;
  }

  // ---- Amount summary box ----
  const boxTop = y + 4;
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.roundedRect(MARGIN_X, boxTop, PAGE_W - MARGIN_X * 2, 22, 3, 3, 'FD');
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Amount Due', MARGIN_X + 8, boxTop + 8);
  doc.setFontSize(20);
  doc.text(formatOfficialMoney(data.amountGhs, 'GHS'), MARGIN_X + 8, boxTop + 18);

  // Paystack reference if available
  if (data.paystackReference) {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(`Paystack Ref: ${data.paystackReference}`, RIGHT - 50, boxTop + 8);
  }

  y = boxTop + 32;

  // ---- Payment instructions ----
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('How to Pay', MARGIN_X, y); y += 6;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const instructions = [
    '1. Pay the amount above via Paystack (Mobile Money, Card, Bank, USSD, QR).',
    '2. Once payment is confirmed, your Adimat store account will be activated automatically.',
    '3. Share your payment reference with the agent if paying by cash or MoMo directly.',
    data.paystackPayUrl ? `Pay online: ${data.paystackPayUrl}` : '',
  ].filter(Boolean);
  instructions.forEach((line) => {
    doc.text(line, MARGIN_X, y); y += 4.5;
  });

  y += 6;

  // ---- Footer ----
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('Powered by Adimat POS — Agent Portal', MARGIN_X, PAGE_H - 10);
    const pgText = `Page ${i} of ${pageCount}`;
    doc.text(pgText, RIGHT - doc.getTextWidth(pgText), PAGE_H - 10);
  }

  return doc;
}

export function downloadAgentInvoicePdf(data: AgentInvoicePdfData): void {
  const doc = generateAgentInvoicePdf(data);
  doc.save(`invoice-${data.invoiceNumber.replace(/[^A-Za-z0-9]/g, '-')}.pdf`);
}

export function shareAgentInvoiceViaWhatsApp(
  data: AgentInvoicePdfData,
  phoneNumber: string
): void {
  const digits = phoneNumber.replace(/\D/g, '');
  const message = encodeURIComponent(
    `*Adimat Subscription Invoice*\n` +
    `Invoice: ${data.invoiceNumber}\n` +
    `Store: ${data.storeName}\n` +
    `Amount: ${formatOfficialMoney(data.amountGhs, 'GHS')}\n` +
    `Due: ${data.dueDate ? formatOfficialDate(data.dueDate) : 'N/A'}\n` +
    `Pay via Paystack or contact your agent.\n` +
    `— ${data.agentName}`
  );
  const url = digits
    ? `https://wa.me/${digits}?text=${message}`
    : `https://wa.me/?text=${message}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}