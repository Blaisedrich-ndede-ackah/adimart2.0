import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { jsPDF } from 'jspdf';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'public', 'guides');
const guides = [
  {
    source: 'ADIMAT_STORE_OWNER_GUIDE.md',
    output: 'adimat-store-owner-guide.pdf',
    audience: 'STORE OWNER GUIDE',
    screen: 'owner',
  },
  {
    source: 'ADIMAT_CASHIER_GUIDE.md',
    output: 'adimat-cashier-guide.pdf',
    audience: 'CASHIER GUIDE',
    screen: 'cashier',
  },
  {
    source: 'ADIMAT_ADMIN_TECHNICAL_GUIDE.md',
    output: 'adimat-admin-technical-guide.pdf',
    audience: 'PLATFORM ADMINISTRATOR & TECHNICAL STAFF GUIDE',
    screen: 'admin',
  },
];

const page = { width: 210, height: 297, left: 19, right: 19, top: 21, bottom: 20 };
const green = [6, 95, 70];
const ink = [38, 51, 45];
const muted = [90, 105, 98];

const clean = (value) =>
  value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '')
    .replace(/[^\x20-\x7E]/g, '-')
    .trim();

function footer(doc) {
  doc.setDrawColor(220, 228, 224);
  doc.setLineWidth(0.25);
  doc.line(page.left, page.height - 13, page.width - page.right, page.height - 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text('ADIMAT POS  |  ROLE-SPECIFIC GUIDE', page.left, page.height - 8);
}

function drawCover(doc, title, audience) {
  doc.setFillColor(...green);
  doc.rect(0, 0, page.width, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(27);
  doc.setTextColor(...green);
  doc.text('ADIMAT POS', page.left, 82);
  doc.setFontSize(22);
  doc.setTextColor(...ink);
  doc.text(doc.splitTextToSize(title, page.width - page.left - page.right), page.left, 98);
  doc.setFontSize(11);
  doc.setTextColor(...green);
  doc.text(audience, page.left, 117);
  doc.setDrawColor(...green);
  doc.setLineWidth(1.2);
  doc.line(page.left, 130, page.left + 24, 130);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...muted);
  doc.text('A practical guide for using Adimat POS', page.left, 145);
  doc.text('Edition: 12 October 2026', page.left, 155);
  doc.setFillColor(241, 247, 243);
  doc.roundedRect(page.left, 190, page.width - page.left - page.right, 43, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...green);
  doc.setFontSize(10);
  doc.text('Learn Adimat', page.left + 7, 202);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...ink);
  doc.setFontSize(9);
  doc.text(
    doc.splitTextToSize(
      'Illustrated step-by-step instructions for the features available to your role.',
      page.width - page.left - page.right - 14,
    ),
    page.left + 7,
    211,
  );
  footer(doc);
}

function drawLabel(doc, text, x, y, size = 2.25, bold = false, color = ink) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(text, x, y);
}

function drawMockScreen(doc, audience) {
  if (audience === 'admin') {
    const x = 19;
    const y = 23;
    const s = 0.18;
    const px = (n) => x + n * s;
    const py = (n) => y + n * s;
    const box = (left, top, width, height, fill, border = fill, radius = 8) => {
      doc.setFillColor(...fill);
      doc.setDrawColor(...border);
      doc.roundedRect(px(left), py(top), width * s, height * s, radius * s, radius * s, 'FD');
    };
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(219, 228, 225);
    doc.roundedRect(x, y, 900 * s, 430 * s, 4, 4, 'FD');
    box(16, 16, 868, 106, green);
    drawLabel(doc, 'ADIMAT ADMIN', px(44), py(54), 2.3, true, [167, 243, 208]);
    drawLabel(doc, 'Overview', px(44), py(91), 4, true, [255, 255, 255]);
    box(30, 136, 840, 47, [255, 255, 255], [209, 250, 229]);
    drawLabel(doc, 'Overview     Stores     Subscriptions     Payouts', px(49), py(165), 2.3, true, green);
    box(425, 146, 73, 27, green);
    drawLabel(doc, 'Learn', px(444), py(164), 2, true, [255, 255, 255]);
    for (const [left, label, value, color] of [
      [30, 'Stores', '24', ink],
      [246, 'Weekly Paystack', 'GHc 8,420', ink],
      [462, 'Active subscriptions', '19', green],
      [678, 'Pending payouts', '5', [180, 83, 9]],
    ]) {
      box(left, 204, left === 678 ? 192 : 198, 100, [255, 255, 255], [226, 232, 240]);
      drawLabel(doc, label, px(left + 18), py(233), 2.2, false, muted);
      drawLabel(doc, value, px(left + 18), py(276), value.length > 8 ? 4 : 5, true, color);
    }
    box(30, 324, 840, 65, [236, 253, 245]);
    drawLabel(doc, 'Administrator learning', px(52), py(352), 2.7, true, green);
    drawLabel(doc, 'Provision stores  -  subscriptions  -  payouts  -  safe technical operations', px(52), py(375), 2.2, false, muted);
    drawLabel(doc, 'ADMIN PORTAL', x, py(430) + 7, 3, true, green);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(
      doc.splitTextToSize(
        'Administrator portal illustration. Use the Learn tab after secure administrator sign-in.',
        page.width - page.left - page.right,
      ),
      x,
      py(430) + 13,
    );
    return 112;
  }

  const x = 19;
  const y = 23;
  const s = 0.18;
  const px = (n) => x + n * s;
  const py = (n) => y + n * s;
  const box = (left, top, width, height, fill, border = fill, radius = 2) => {
    doc.setFillColor(...fill);
    doc.setDrawColor(...border);
    doc.roundedRect(px(left), py(top), width * s, height * s, radius * s, radius * s, 'FD');
  };

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(219, 228, 225);
  doc.roundedRect(x, y, 440 * s, (audience === 'owner' ? 650 : 700) * s, 4, 4, 'FD');
  box(16, 16, 408, audience === 'owner' ? 218 : 109, green);
  drawLabel(doc, audience === 'owner' ? 'OWNER DASHBOARD' : 'SALES COUNTER', px(40), py(53), 2, true, [167, 243, 208]);
  drawLabel(doc, audience === 'owner' ? 'Adimat Store' : 'POS', px(40), py(91), 4, true, [255, 255, 255]);

  if (audience === 'owner') {
    box(36, 142, 368, 92, [255, 255, 255]);
    drawLabel(doc, "Today's sales", px(55), py(173), 2.5, false, muted);
    drawLabel(doc, 'GHc 1,250.00', px(52), py(211), 5, true);
    box(36, 287, 177, 77, [255, 255, 255], [226, 232, 240]);
    box(227, 287, 177, 77, [255, 255, 255], [226, 232, 240]);
    drawLabel(doc, 'Cash received', px(52), py(313), 2.25, false, muted);
    drawLabel(doc, 'MoMo / Paystack', px(243), py(313), 2.25, false, muted);
    drawLabel(doc, 'GHc 800.00', px(52), py(345), 3.2, true);
    drawLabel(doc, 'GHc 450.00', px(243), py(345), 3.2, true);
    box(36, 378, 368, 67, [255, 251, 235], [253, 230, 138]);
    drawLabel(doc, 'Low-stock products', px(54), py(403), 2.2, false, [146, 64, 14]);
    drawLabel(doc, '3 items need attention', px(54), py(430), 3.1, true, [69, 26, 3]);
    drawLabel(doc, 'Quick actions', px(40), py(478), 2.8, true);
    box(36, 490, 115, 57, green);
    box(160, 490, 116, 57, [255, 255, 255], [209, 250, 229]);
    box(285, 490, 119, 57, [255, 255, 255], [209, 250, 229]);
    drawLabel(doc, 'New sale', px(53), py(515), 2.2, true, [255, 255, 255]);
    drawLabel(doc, 'Add product', px(174), py(515), 2.2, true, green);
    drawLabel(doc, 'Add expense', px(298), py(515), 2.2, true, green);
    box(36, 562, 368, 48, [248, 250, 252]);
    drawLabel(doc, 'Sales history  -  review receipts', px(81), py(590), 2.4, true);
  } else {
    box(32, 126, 376, 49, [248, 250, 252], [219, 228, 225]);
    drawLabel(doc, 'Search by name or barcode', px(78), py(155), 2.4, false, muted);
    drawLabel(doc, 'Products', px(36), py(207), 2.8, true);
    box(32, 220, 181, 82, [255, 255, 255], [219, 228, 225]);
    box(227, 220, 181, 82, [255, 255, 255], [219, 228, 225]);
    drawLabel(doc, 'Fresh milk', px(104), py(249), 2.3, true);
    drawLabel(doc, 'GHc 18.00', px(104), py(270), 2.3, true, green);
    drawLabel(doc, 'Bread', px(299), py(249), 2.3, true);
    drawLabel(doc, 'GHc 12.00', px(299), py(270), 2.3, true, green);
    drawLabel(doc, 'Cart  -  2 items', px(36), py(431), 2.8, true);
    box(32, 444, 376, 54, [248, 250, 252]);
    box(32, 507, 376, 54, [248, 250, 252]);
    drawLabel(doc, 'Fresh milk  -  quantity 1', px(48), py(475), 2.3, true);
    drawLabel(doc, 'Bread  -  quantity 1', px(48), py(538), 2.3, true);
    drawLabel(doc, 'Total', px(40), py(604), 2.4, false, muted);
    drawLabel(doc, 'GHc 30.00', px(314), py(608), 3.4, true);
    box(32, 625, 376, 43, green);
    drawLabel(doc, 'Checkout', px(184), py(652), 2.8, true, [255, 255, 255]);
  }

  const captionX = 19 + 440 * s + 8;
  drawLabel(doc, audience === 'owner' ? 'OWNER HOME' : 'CASHIER POS', captionX, 35, 3, true, green);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(
    doc.splitTextToSize(
      'Sample screen illustration. Example products, names, and totals are shown; your store screen uses your own data.',
      page.width - page.right - captionX,
    ),
    captionX,
    45,
  );
  return 154;
}

function drawContent(doc, markdown, screen) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const title = clean(lines[0].replace(/^#\s+/, ''));
  const subtitle = clean(lines[1] || '');
  drawCover(doc, title, subtitle.toUpperCase());
  doc.addPage();
  let y = drawMockScreen(doc, screen);
  const bottom = page.height - page.bottom;

  const nextPage = () => {
    footer(doc);
    doc.addPage();
    y = page.top;
  };
  const write = (text, { size = 9.5, leading = 4.7, indent = 0, font = 'normal', color = ink, gap = 2 } = {}) => {
    const content = clean(text);
    if (!content) {
      y += 1;
      return;
    }
    doc.setFont('helvetica', font);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const wrapped = doc.splitTextToSize(content, page.width - page.left - page.right - indent);
    if (y + wrapped.length * leading + gap > bottom) nextPage();
    doc.text(wrapped, page.left + indent, y, { lineHeightFactor: leading / size });
    y += wrapped.length * leading + gap;
  };

  for (const rawLine of lines.slice(2)) {
    const line = rawLine.trim();
    if (!line) {
      y += 1;
      continue;
    }
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (y + 13 > bottom) nextPage();
      y += 2;
      write(heading[1], { size: 13, leading: 6, font: 'bold', color: green, gap: 2 });
    } else if (/^\d+\.\s+/.test(line)) {
      write(line, { indent: 3, leading: 4.6, gap: 1 });
    } else if (/^[-*]\s+/.test(line)) {
      write(`- ${line.replace(/^[-*]\s+/, '')}`, { indent: 3, leading: 4.6, gap: 1 });
    } else {
      write(line);
    }
  }
  footer(doc);

  const totalPages = doc.getNumberOfPages();
  for (let number = 1; number <= totalPages; number += 1) {
    doc.setPage(number);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`${number} / ${totalPages}`, page.width - page.right, page.height - 8, { align: 'right' });
  }
  return totalPages;
}

await mkdir(outputDir, { recursive: true });
for (const guide of guides) {
  const markdown = await readFile(path.join(root, 'docs', guide.source), 'utf8');
  const doc = new jsPDF({ format: 'a4', unit: 'mm', compress: true });
  doc.setProperties({
    title: clean(markdown.split('\n')[0].replace(/^#\s+/, '')),
    subject: guide.audience,
    author: 'Adimat POS',
    creator: 'Adimat POS documentation',
  });
  const pages = drawContent(doc, markdown, guide.screen);
  const destination = path.join(outputDir, guide.output);
  await writeFile(destination, Buffer.from(doc.output('arraybuffer')));
  console.log(`Generated ${path.relative(root, destination)} (${pages} pages).`);
}
