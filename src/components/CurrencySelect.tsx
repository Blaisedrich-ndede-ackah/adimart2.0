import { STORE_CURRENCIES, currencyName, normalizeCurrencyCode } from '@/lib/currency';
import { useI18nStore, useT } from '@/lib/i18n';

interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  id?: string;
}

export default function CurrencySelect({ value, onChange, id }: CurrencySelectProps) {
  const t = useT();
  const language = useI18nStore((s) => s.language);
  const current = normalizeCurrencyCode(value);

  return (
    <select
      id={id}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-900 touch-target"
      aria-label={t('settings.currency')}
    >
      {STORE_CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} · {c.symbol} · {currencyName(c.code, language)}
        </option>
      ))}
    </select>
  );
}
