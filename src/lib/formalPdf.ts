/**
 * Shared A4 letterhead, tables, and typography for official store/admin PDFs.
 */

import jsPDF from 'jspdf';

export interface FormalOrg {
  name: string;
  address?: string;
  phone?: string;
  logoDataUrl?: string;
  /** Short official caption under the title — not a system UUID. */
  reference?: string;
  /** Internal store identifier, printed only in the footer. */
  storeId?: string;
}

export interface FormalDocMeta {
  title: string;
  subtitle?: string;
  period?: string;
  documentLabel?: string;
  notes?: string[];
  generatedAt?: Date;
}

export interface FormalLine {
  label: string;
  value: string;
  emphasis?: 'total' | 'subtotal' | 'muted' | 'header';
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 16;
const RIGHT = PAGE_W - MARGIN_X;
const HEADER_H = 28;
const FOOTER_H = 14;
const CONTENT_TOP = HEADER_H + 10;

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const RULE: [number, number, number] = [203, 213, 225];
const HEADER_BG: [number, number, number] = [6, 78, 59];
const BAND: [number, number, number] = [236, 253, 245];
const TABLE_HEAD: [number, number, number] = [241, 245, 249];
const WHITE: [number, number, number] = [255, 255, 255];

export function formatGhsOfficial(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const formatted = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // ISO code — Helvetica in jsPDF cannot reliably draw the cedi glyph.
  return n < 0 ? `(GHS ${formatted})` : `GHS ${formatted}`;
}

export function formatOfficialDate(value: Date | string = new Date()): string {
  let d: Date;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split('-').map(Number);
    d = new Date(y, (m || 1) - 1, day || 1);
  } else {
    d = typeof value === 'string' ? new Date(value) : value;
  }
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function hexSafeLogo(logo?: string): { format: 'PNG' | 'JPEG'; data: string } | null {
  if (!logo || !logo.startsWith('data:image/')) return null;
  return {
    format: logo.startsWith('data:image/png') ? 'PNG' : 'JPEG',
    data: logo,
  };
}

export class FormalPdf {
  readonly doc: jsPDF;
  private y = CONTENT_TOP;
  private readonly org: FormalOrg;
  private readonly meta: FormalDocMeta;
  private firstContent = true;

  constructor(org: FormalOrg, meta: FormalDocMeta) {
    this.doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    this.org = org;
    this.meta = meta;
    this.drawChrome(1);
    this.drawTitleBlock();
  }

  get cursor(): number {
    return this.y;
  }

  ensureSpace(needed = 12): void {
    if (this.y + needed <= PAGE_H - FOOTER_H - 6) return;
    this.doc.addPage();
    this.drawChrome(this.doc.getNumberOfPages());
    this.y = CONTENT_TOP;
  }

  section(title: string): void {
    this.ensureSpace(16);
    if (!this.firstContent) this.y += 3;
    this.firstContent = false;
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(12);
    this.doc.setTextColor(...INK);
    this.doc.text(title.toUpperCase(), MARGIN_X, this.y);
    this.y += 2;
    this.doc.setDrawColor(...HEADER_BG);
    this.doc.setLineWidth(0.45);
    this.doc.line(MARGIN_X, this.y, RIGHT, this.y);
    this.y += 6;
  }

  paragraph(text: string, muted = false): void {
    this.ensureSpace(10);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(9);
    this.doc.setTextColor(...(muted ? MUTED : INK));
    const lines = this.doc.splitTextToSize(text, RIGHT - MARGIN_X);
    this.doc.text(lines, MARGIN_X, this.y);
    this.y += lines.length * 4.2 + 2;
  }

  kvTable(rows: FormalLine[]): void {
    const rowH = 7.2;
    this.ensureSpace(rows.length * rowH + 4);
    for (const row of rows) {
      this.ensureSpace(rowH + 2);
      const isTotal = row.emphasis === 'total';
      const isSub = row.emphasis === 'subtotal';
      const isHead = row.emphasis === 'header';
      const isMuted = row.emphasis === 'muted';

      if (isTotal || isHead) {
        this.doc.setFillColor(...(isTotal ? BAND : TABLE_HEAD));
        this.doc.rect(MARGIN_X, this.y - 4.6, RIGHT - MARGIN_X, rowH, 'F');
      }

      if (isTotal || isSub) {
        this.doc.setDrawColor(...HEADER_BG);
        this.doc.setLineWidth(isTotal ? 0.4 : 0.25);
        this.doc.line(MARGIN_X, this.y - 4.6, RIGHT, this.y - 4.6);
      }

      this.doc.setFont('helvetica', isTotal || isSub || isHead ? 'bold' : 'normal');
      this.doc.setFontSize(isTotal ? 10 : 9);
      this.doc.setTextColor(...(isMuted ? MUTED : INK));
      this.doc.text(row.label, MARGIN_X + 2, this.y);
      this.doc.text(row.value, RIGHT - 2, this.y, { align: 'right' });
      this.y += rowH;
    }
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.2);
    this.doc.line(MARGIN_X, this.y - 3, RIGHT, this.y - 3);
    this.y += 2;
  }

  dataTable(headers: string[], rows: string[][], colWeights?: number[]): void {
    const cols = headers.length;
    const weights = colWeights && colWeights.length === cols
      ? colWeights
      : Array.from({ length: cols }, () => 1);
    const totalW = weights.reduce((s, w) => s + w, 0);
    const width = RIGHT - MARGIN_X;
    const widths = weights.map((w) => (w / totalW) * width);
    const rowH = 7;

    const drawHead = () => {
      this.doc.setFillColor(...TABLE_HEAD);
      this.doc.rect(MARGIN_X, this.y - 4.8, width, rowH, 'F');
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MUTED);
      let x = MARGIN_X;
      headers.forEach((h, i) => {
        const last = i === cols - 1;
        this.doc.text(h, last ? x + widths[i] - 2 : x + 2, this.y, {
          align: last ? 'right' : 'left',
        });
        x += widths[i];
      });
      this.y += rowH;
    };

    this.ensureSpace(rowH * 2);
    drawHead();

    rows.forEach((cells, rowIndex) => {
      this.ensureSpace(rowH + 2);
      if (this.y === CONTENT_TOP) drawHead();
      if (rowIndex % 2 === 1) {
        this.doc.setFillColor(248, 250, 252);
        this.doc.rect(MARGIN_X, this.y - 4.8, width, rowH, 'F');
      }
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8.5);
      this.doc.setTextColor(...INK);
      let x = MARGIN_X;
      cells.forEach((cell, i) => {
        const last = i === cols - 1;
        const maxW = widths[i] - 4;
        const text = this.doc.splitTextToSize(cell || '—', maxW)[0] || '—';
        this.doc.text(text, last ? x + widths[i] - 2 : x + 2, this.y, {
          align: last ? 'right' : 'left',
        });
        x += widths[i];
      });
      this.y += rowH;
    });

    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.2);
    this.doc.line(MARGIN_X, this.y - 3, RIGHT, this.y - 3);
    this.y += 3;
  }

  signatureBlock(left = 'Prepared by', right = 'Authorised by'): void {
    this.ensureSpace(32);
    this.y += 8;
    const colW = (RIGHT - MARGIN_X - 16) / 2;
    const leftX = MARGIN_X;
    const rightX = MARGIN_X + colW + 16;
    this.doc.setDrawColor(...INK);
    this.doc.setLineWidth(0.3);
    this.doc.line(leftX, this.y, leftX + colW, this.y);
    this.doc.line(rightX, this.y, rightX + colW, this.y);
    this.y += 5;
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8);
    this.doc.setTextColor(...MUTED);
    this.doc.text(left, leftX, this.y);
    this.doc.text(right, rightX, this.y);
    this.y += 5;
    this.doc.text('Name / signature / date', leftX, this.y);
    this.doc.text('Name / signature / date', rightX, this.y);
    this.y += 6;
  }

  save(filename: string): void {
    this.finishPages();
    this.doc.save(filename);
  }

  outputBlob(): Blob {
    this.finishPages();
    return this.doc.output('blob');
  }

  private drawTitleBlock(): void {
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(18);
    this.doc.setTextColor(...INK);
    this.doc.text(this.meta.title, MARGIN_X, this.y);
    this.y += 7;

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(10);
    if (this.meta.subtitle) {
      this.doc.text(this.meta.subtitle, MARGIN_X, this.y);
      this.y += 5;
    }
    if (this.meta.period) {
      this.doc.setTextColor(...MUTED);
      this.doc.setFontSize(9);
      this.doc.text(this.meta.period, MARGIN_X, this.y);
      this.y += 5;
    }
    if (this.org.reference && !looksLikeStoreId(this.org.reference)) {
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MUTED);
      this.doc.text(this.org.reference, MARGIN_X, this.y);
      this.y += 5;
    }
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.2);
    this.doc.line(MARGIN_X, this.y, RIGHT, this.y);
    this.doc.setTextColor(...INK);
    this.y += 6;
  }

  private drawChrome(page: number): void {
    this.doc.setFillColor(...HEADER_BG);
    this.doc.rect(0, 0, PAGE_W, HEADER_H, 'F');

    const logo = hexSafeLogo(this.org.logoDataUrl);
    let textX = MARGIN_X;
    if (logo) {
      try {
        this.doc.addImage(logo.data, logo.format, MARGIN_X, 5, 18, 18);
        textX = MARGIN_X + 22;
      } catch {
        // Letterhead still prints without the logo
      }
    }

    this.doc.setTextColor(...WHITE);
    this.doc.setFont('times', 'bold');
    this.doc.setFontSize(13);
    this.doc.text(this.org.name || 'Business', textX, 11);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(7.5);
    const details = [this.org.address, this.org.phone ? `Tel: ${this.org.phone}` : '']
      .filter(Boolean)
      .join('  ·  ');
    if (details) {
      const wrapped = this.doc.splitTextToSize(details, RIGHT - textX);
      this.doc.text(wrapped.slice(0, 2), textX, 16.5);
    }

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(7);
    this.doc.text(this.meta.documentLabel || 'OFFICIAL DOCUMENT', RIGHT, 12.5, { align: 'right' });

    this.doc.setFillColor(217, 119, 6);
    this.doc.rect(0, HEADER_H, PAGE_W, 1.2, 'F');

    // Footer text is written once in finishPages so "Page n of m" is not stacked.
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.25);
    this.doc.line(MARGIN_X, PAGE_H - FOOTER_H, RIGHT, PAGE_H - FOOTER_H);
  }

  private drawFooter(page: number, total: number): void {
    this.doc.setDrawColor(...RULE);
    this.doc.setLineWidth(0.25);
    this.doc.line(MARGIN_X, PAGE_H - FOOTER_H, RIGHT, PAGE_H - FOOTER_H);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(7);
    this.doc.setTextColor(...MUTED);
    const generated = formatOfficialDate(this.meta.generatedAt || new Date());
    this.doc.text(`Prepared ${generated}  ·  Official copy  ·  Adimat POS`, MARGIN_X, PAGE_H - 8.5);
    if (this.org.storeId) {
      this.doc.setFontSize(6.5);
      this.doc.text(`Store reference  ${this.org.storeId}`, MARGIN_X, PAGE_H - 4.5);
    }
    this.doc.setFontSize(7);
    this.doc.text(`Page ${page} of ${total}`, RIGHT, PAGE_H - 8.5, { align: 'right' });
  }

  private finishPages(): void {
    const notes = this.meta.notes || [];
    if (notes.length) {
      this.section('Notes');
      this.doc.setFont('helvetica', 'italic');
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MUTED);
      for (const note of notes) {
        this.ensureSpace(8);
        const lines = this.doc.splitTextToSize(note, RIGHT - MARGIN_X);
        this.doc.text(lines, MARGIN_X, this.y);
        this.y += lines.length * 3.8 + 2;
      }
    }

    const total = this.doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      this.drawFooter(i, total);
    }
  }
}

function looksLikeStoreId(value: string): boolean {
  return /store id\s+[0-9a-f-]{8,}/i.test(value.trim())
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function orgFromStore(store?: {
  name?: string;
  address?: string;
  support_number?: string;
  logo_url?: string;
  id?: string;
} | null): FormalOrg {
  return {
    name: store?.name?.trim() || 'Store',
    address: store?.address?.trim() || '',
    phone: store?.support_number?.trim() || '',
    logoDataUrl: store?.logo_url?.startsWith('data:image/') ? store.logo_url : '',
    storeId: store?.id || '',
  };
}
