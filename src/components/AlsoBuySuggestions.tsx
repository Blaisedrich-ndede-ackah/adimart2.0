import type { AlsoBuySuggestion } from '@/lib/adimatAi/boughtTogether';
import { useT } from '@/lib/i18n';

interface AlsoBuySuggestionsProps {
  suggestions: AlsoBuySuggestion[];
  onAdd: (productId: string) => void;
}

export default function AlsoBuySuggestions({ suggestions, onAdd }: AlsoBuySuggestionsProps) {
  const t = useT();
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-white/70 bg-white/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{t('ai.alsoBuy')}</p>
      <div className="mt-2 flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.productId}
            type="button"
            onClick={() => onAdd(suggestion.productId)}
            className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left touch-target"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-gray-900">{suggestion.name}</span>
              <span className="block text-[11px] text-gray-500">{t(suggestion.whyKey, suggestion.whyVars)}</span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-primary">{t('common.add')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
