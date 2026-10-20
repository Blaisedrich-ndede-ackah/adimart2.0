import { useState, useRef, useEffect } from 'react';
import { db, getCurrentStoreId } from '@/lib/dexie';
import { useEffect } from 'react';
import { X, Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { parseProductCsv, CSV_TEMPLATE } from '@/lib/csvImport';
import { importProductsFromRows } from '@/lib/dexie';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function CsvImportModal({ isOpen, onClose, onImported }: CsvImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewCount, setPreviewCount] = useState(0);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<ReturnType<typeof parseProductCsv>['rows']>([]);
  const [status, setStatus] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [conflicts, setConflicts] = useState<any[]>([]);

  useEffect(() => { if (!isOpen) { setConflicts([]); setParsedRows([]); setParseErrors([]); setPreviewCount(0); setStatus(''); } }, [isOpen]);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    const content = await file.text();
    const result = parseProductCsv(content);
    setParsedRows(result.rows);
    setParseErrors(result.errors);
    setPreviewCount(result.rows.length);
    setStatus('');
  };

    const handleImport = async () => {
    if (parsedRows.length === 0) return;
    setIsImporting(true);
    try {
      const result: any = await importProductsFromRows(parsedRows);
      setConflicts(result.conflicts || []);
      const parts: string[] = [];
      if (result.imported) parts.push('Imported ' + result.imported + ' products');
      if (result.updated) parts.push('Updated ' + result.updated + ' products');
      if (result.conflicts && result.conflicts.length) parts.push(result.conflicts.length + ' conflicts');
      setStatus(parts.length ? parts.join(', ') : 'Done.');
      if (!(result.conflicts && result.conflicts.length)) onImported();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed');
    }
    setIsImporting(false);
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adimat-products-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet-panel">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-900">Import Products (CSV)</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Upload a CSV with columns: name, category, barcode, cost_price, selling_price, stock_level
          </p>

          <button
            onClick={downloadTemplate}
            className="w-full py-3 border border-gray-200 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Download CSV Template
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />

          <button
            onClick={() => fileRef.current?.click()}
            className="w-full py-4 border-2 border-dashed border-primary/40 rounded-xl text-primary font-medium flex items-center justify-center gap-2"
          >
            <Upload className="w-5 h-5" />
            Choose CSV File
          </button>

          {previewCount > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
              <p className="text-sm text-green-800">{previewCount} products ready to import</p>
            </div>
          )}


          {conflicts.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <p className="text-sm font-medium text-orange-800">{conflicts.length} conflict(s) found</p>
              </div>
              <p className="text-xs text-orange-700">Conflicting products exist with different details. Please resolve them before proceeding.</p>
              <div className="max-h-40 overflow-auto space-y-2">
                {conflicts.slice(0, 10).map((c: any, idx: number) => (
                  <div key={idx} className="text-xs bg-white/60 rounded-lg p-2">
                    <p className="font-medium text-orange-900">{c.existing?.name}</p>
                    <p className="text-orange-700">Differs in name/category/price/barcode/sku</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {parseErrors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <p className="text-sm font-medium text-amber-800">Parse warnings</p>
              </div>
              <ul className="text-xs text-amber-700 space-y-1">
                {parseErrors.slice(0, 5).map(err => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {status && <p className="text-sm text-center text-gray-700">{status}</p>}

          <button
            onClick={handleImport}
            disabled={parsedRows.length === 0 || isImporting || conflicts.length > 0}
            className="w-full py-3 bg-primary text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {conflicts.length > 0 ? 'Resolve Conflicts to Import' : Import  Products}
          </button>
        </div>
      </div>
    </div>
  );
}

import { getCurrentStoreId } from '@/lib/dexie';
