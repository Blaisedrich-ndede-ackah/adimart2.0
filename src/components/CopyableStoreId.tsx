import { useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyableStoreId({
  storeId,
  compact = false,
}: {
  storeId: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (event?: MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    try {
      await navigator.clipboard.writeText(storeId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy Store ID', storeId);
    }
  };

  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${compact ? '' : 'mt-1'}`}>
      <p className="text-[11px] font-mono text-slate-600 truncate">
        <span className="font-sans font-semibold text-slate-500 mr-1">ID</span>
        {storeId}
      </p>
      <button
        type="button"
        onClick={(e) => void copy(e)}
        className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 touch-target"
        aria-label="Copy store ID"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
