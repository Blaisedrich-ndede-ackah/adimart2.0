import { toMoneyAmount } from './money';

export interface CsvProductRow {
  name: string;
  category: string;
  barcode: string;
  cost_price: number;
  selling_price: number;
  stock_level: number;
  sku_type: string;
}

export interface CsvParseResult {
  rows: CsvProductRow[];
  errors: string[];
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return fallback;
  // Reject absurd values (scientific junk / misaligned CSV columns)
  if (Math.abs(parsed) > 50_000_000) return fallback;
  return parsed;
}

function parseMoney(value: string): number {
  return toMoneyAmount(parseNumber(value, 0));
}

export function parseProductCsv(content: string): CsvParseResult {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const errors: string[] = [];
  const rows: CsvProductRow[] = [];

  if (lines.length === 0) {
    return { rows, errors: ['CSV file is empty'] };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const hasHeader = headers.some(h =>
    ['name', 'product_name', 'product'].includes(h)
  );

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const headerMap = hasHeader ? headers : ['name', 'category', 'barcode', 'cost_price', 'selling_price', 'stock_level'];

  const getValue = (cells: string[], keys: string[]): string => {
    for (const key of keys) {
      const index = headerMap.indexOf(key);
      if (index >= 0 && cells[index] !== undefined) return cells[index];
    }
    return '';
  };

  dataLines.forEach((line, index) => {
    const cells = parseCsvLine(line);
    const name = getValue(cells, ['name', 'product_name', 'product']);

    if (!name) {
      errors.push(`Row ${index + (hasHeader ? 2 : 1)}: missing product name`);
      return;
    }

    rows.push({
      name,
      category: getValue(cells, ['category', 'cat']) || 'Other',
      barcode: getValue(cells, ['barcode', 'sku', 'upc', 'ean']),
      cost_price: parseMoney(getValue(cells, ['cost_price', 'cost', 'buying_price'])),
      selling_price: parseMoney(getValue(cells, ['selling_price', 'price', 'sell_price', 'sale_price'])),
      stock_level: Math.max(0, Math.round(parseNumber(getValue(cells, ['stock_level', 'stock', 'quantity', 'qty'])))),
      sku_type: getValue(cells, ['sku_type', 'unit']) || 'unit',
    });
  });

  return { rows, errors };
}

export const CSV_TEMPLATE = `name,category,barcode,cost_price,selling_price,stock_level
Coca Cola 500ml,Drinks,5449000000996,3.50,5.00,24
Bread Loaf,Bakery,,4.00,6.50,10`;
