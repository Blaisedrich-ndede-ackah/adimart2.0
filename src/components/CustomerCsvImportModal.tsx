import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { createCustomersBulk, type LocalCustomer } from '@/lib/dexie';
import {
  CUSTOMER_CSV_TEMPLATE,
  parseCustomerCsv,
  type CsvCustomerRow,
} from '@/lib/csvImport';
import { useFormatMoney } from '@/lib/currency';

interface CustomerCsvImportModalProps {
  isOpen: boolean;
  customers: LocalCustomer[];
  onClose: () => void;
  onImported: (count: number) => void;
}

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 8;

function customerKey(name: string, phone: string): string {
  return `${name.trim().toLowerCase()}\u0000${phone.trim()}`;
}

export default function CustomerCsvImportModal({
  isOpen,
  customers,
  onClose,
  onImported,
}: CustomerCsvImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const money = useFormatMoney();
  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<CsvCustomerRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFileName('');
      setParsedRows([]);
      setParseErrors([]);
      setStatus('');
      setIsReading(false);
      setIsImporting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setParsedRows([]);
    setParseErrors([]);
    setStatus('');

    if (file.size > MAX_CSV_BYTES) {
      setParseErrors(['The CSV file must be 5 MB or smaller.']);
      return;
    }

    setIsReading(true);
    try {
      const result = parseCustomerCsv(await file.text());
      const existingKeys = new Set(
        customers
          .filter((customer) => customer.is_active === 1)
          .map((customer) => customerKey(customer.name, customer.phone))
      );
      const seenKeys = new Set<string>();
      const validRows: CsvCustomerRow[] = [];
      const errors = [...result.errors];

      for (const row of result.rows) {
        const key = customerKey(row.name, row.phone);
        if (existingKeys.has(key)) {
          errors.push(`Row ${row.row_number}: ${row.name} is already registered with this phone number.`);
        } else if (seenKeys.has(key)) {
          errors.push(`Row ${row.row_number}: ${row.name} appears more than once in this file.`);
        } else {
          seenKeys.add(key);
          validRows.push(row);
        }
      }

      setParsedRows(validRows);
      setParseErrors(errors);
    } catch (error) {
      setParseErrors([error instanceof Error ? error.message : 'Could not read the CSV file.']);
    } finally {
      setIsReading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([CUSTOMER_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adimat-customers-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImport = async () => {
    if (parsedRows.length === 0) return;
    setIsImporting(true);
    setStatus('');
    try {
      const imported = await createCustomersBulk(parsedRows.map((row) => ({
        name: row.name,
        phone: row.phone,
        openingBalance: row.opening_balance,
      })));
      const skippedCount = parseErrors.length;
      setStatus(
        `Imported ${imported.length} customer${imported.length === 1 ? '' : 's'}.` +
        (skippedCount > 0 ? ` ${skippedCount} invalid or duplicate row${skippedCount === 1 ? ' was' : 's were'} skipped.` : '')
      );
      setParsedRows([]);
      onImported(imported.length);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Customer import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isImporting && !isReading) onClose();
      }}
    >
      <section
        className="sheet-panel max-h-[92vh] w-full max-w-2xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-csv-title"
        aria-describedby="customer-csv-description"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
          <div>
            <h2 id="customer-csv-title" className="text-lg font-bold text-gray-900">
              Import customers from CSV
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">Add customer records and their starting balances in one import.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting || isReading}
            aria-label="Close customer CSV import"
            className="rounded-full p-2 hover:bg-gray-100 disabled:opacity-50"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p id="customer-csv-description" className="text-sm leading-6 text-gray-600">
            Use one row per customer with <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">name</code>,{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">phone</code>, and{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">outstanding_balance</code> columns. The balance is recorded as an opening account balance, not a credit sale. Phone and balance can be left blank.
          </p>

          <button
            type="button"
            onClick={downloadTemplate}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Download CSV template
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="Choose customer CSV file"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (file) void handleFile(file);
            }}
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isReading || isImporting}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-4 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-50 disabled:opacity-60"
          >
            {isReading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isReading ? 'Reading CSV…' : fileName ? 'Choose a different CSV file' : 'Choose CSV file'}
          </button>
          {fileName && <p className="-mt-2 truncate text-center text-xs text-gray-500">{fileName}</p>}

          {parsedRows.length > 0 && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-sm text-emerald-800">
                {parsedRows.length} customer{parsedRows.length === 1 ? '' : 's'} ready to import.
              </p>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="mb-1 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">
                  {parseErrors.length} CSV issue{parseErrors.length === 1 ? '' : 's'} found
                </p>
              </div>
              <ul className="space-y-1 text-xs text-amber-800">
                {parseErrors.slice(0, 5).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}
                {parseErrors.length > 5 && <li>And {parseErrors.length - 5} more row issues.</li>}
              </ul>
            </div>
          )}

          {parsedRows.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Preview
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full min-w-[440px] text-left text-xs">
                  <thead className="sticky top-0 bg-white text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Customer</th>
                      <th className="px-3 py-2 font-medium">Phone</th>
                      <th className="px-3 py-2 text-right font-medium">Opening balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, MAX_PREVIEW_ROWS).map((row) => (
                      <tr key={row.row_number} className="border-t border-gray-100 text-gray-700">
                        <td className="px-3 py-2 text-gray-400">{row.row_number}</td>
                        <td className="max-w-48 truncate px-3 py-2 font-medium">{row.name}</td>
                        <td className="px-3 py-2">{row.phone || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.opening_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > MAX_PREVIEW_ROWS && (
                <p className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  Showing {MAX_PREVIEW_ROWS} of {parsedRows.length} valid rows.
                </p>
              )}
            </div>
          )}

          {status && <p role="status" className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">{status}</p>}

          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={parsedRows.length === 0 || isImporting || isReading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isImporting
              ? 'Importing customers…'
              : parsedRows.length > 0
                ? `Import ${parsedRows.length} valid customer${parsedRows.length === 1 ? '' : 's'}`
                : 'Import customers'}
          </button>
        </div>
      </section>
    </div>
  );
}
