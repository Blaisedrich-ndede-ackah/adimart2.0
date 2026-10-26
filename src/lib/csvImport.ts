import { toMoneyAmount } from './money';

export interface CsvProductRow {
  name: string;
  category: string;
  barcode: string;
  cost_price: number;
  selling_price: number;
  stock_level: number;
  sku_type: string;
  product_id?: string;
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
      product_id: getValue(cells, ['product_id', 'id', 'productid']) || undefined,
    });
  });

  return { rows, errors };
}

export interface CsvCustomerRow {
  name: string;
  phone: string;
  opening_balance: number;
  row_number: number;
}

export interface CustomerCsvParseResult {
  rows: CsvCustomerRow[];
  errors: string[];
}

function parseCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let value = '';
  let inQuotes = false;
  const source = content.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"' && value.trim().length === 0) {
      value = '';
      inQuotes = true;
    } else if (char === ',') {
      cells.push(value);
      value = '';
    } else if (char === '\r' || char === '\n') {
      cells.push(value);
      if (cells.some((cell) => cell.trim().length > 0)) records.push(cells);
      cells = [];
      value = '';
      if (char === '\r' && source[index + 1] === '\n') index++;
    } else {
      value += char;
    }
  }

  if (inQuotes) throw new Error('The CSV contains an unclosed quoted value.');
  if (value.length > 0 || cells.length > 0) {
    cells.push(value);
    if (cells.some((cell) => cell.trim().length > 0)) records.push(cells);
  }

  return records;
}

export function parseCustomerCsv(content: string): CustomerCsvParseResult {
  let records: string[][];
  try {
    records = parseCsvRecords(content);
  } catch (error) {
    return {
      rows: [],
      errors: [error instanceof Error ? error.message : 'Could not read the CSV file.'],
    };
  }

  if (records.length === 0) return { rows: [], errors: ['The CSV file is empty.'] };

  const headers = records[0].map((header) => normalizeHeader(header.trim()));
  const findHeader = (aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const nameIndex = findHeader(['name', 'customer_name', 'customer']);
  if (nameIndex < 0) {
    return { rows: [], errors: ['The CSV needs a name or customer_name column.'] };
  }

  const phoneIndex = findHeader(['phone', 'phone_number', 'customer_phone', 'mobile', 'mobile_number']);
  const balanceIndex = findHeader([
    'outstanding_balance',
    'opening_balance',
    'balance',
    'amount_due',
  ]);
  if (records.length === 1) return { rows: [], errors: ['No customer rows were found.'] };

  const rows: CsvCustomerRow[] = [];
  const errors: string[] = [];
  const moneyPattern = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  const maxBalance = 9_999_999_999.99;

  records.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length > headers.length && cells.slice(headers.length).some((cell) => cell.trim())) {
      errors.push(`Row ${rowNumber}: extra columns found; quote values that contain commas.`);
      return;
    }

    const name = (cells[nameIndex] || '').trim();
    const phone = phoneIndex >= 0 ? (cells[phoneIndex] || '').trim() : '';
    const rawBalance = balanceIndex >= 0 ? (cells[balanceIndex] || '').trim() : '';
    const rowErrors: string[] = [];

    if (!name) rowErrors.push('customer name is required');
    if (name.length > 255) rowErrors.push('customer name must be 255 characters or fewer');
    if (phone.length > 30) rowErrors.push('phone must be 30 characters or fewer');

    let openingBalance = 0;
    if (rawBalance) {
      if (!moneyPattern.test(rawBalance)) {
        rowErrors.push('outstanding balance must be a non-negative amount with up to two decimal places');
      } else {
        openingBalance = Number(rawBalance.replace(/,/g, ''));
        if (!Number.isFinite(openingBalance) || openingBalance > maxBalance) {
          rowErrors.push('outstanding balance is too large');
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNumber}: ${rowErrors.join('; ')}.`);
      return;
    }

    rows.push({ name, phone, opening_balance: openingBalance, row_number: rowNumber });
  });

  return { rows, errors };
}

export const CUSTOMER_CSV_TEMPLATE = 'name,phone,outstanding_balance\r\n';

export const CSV_TEMPLATE = `name,category,barcode,cost_price,selling_price,stock_level
Coca Cola 500ml,Drinks,5449000000996,3.50,5.00,24
Bread Loaf,Bakery,,4.00,6.50,10`;
