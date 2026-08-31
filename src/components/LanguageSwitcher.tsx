import { useI18nStore, type AppLanguage, useT } from '@/lib/i18n';
import { cn } from '@/utils/cn';

type Variant = 'light' | 'dark' | 'onPrimary';

const VARIANT_CLASS: Record<Variant, string> = {
  light: 'bg-slate-100 border-slate-200',
  dark: 'bg-white/15 border-white/20',
  onPrimary: 'bg-white/15 border-white/20',
};

interface LanguageSwitcherProps {
  variant?: Variant;
  className?: string;
  compact?: boolean;
}

export default function LanguageSwitcher({
  variant = 'light',
  className,
  compact = false,
}: LanguageSwitcherProps) {
  const t = useT();
  const language = useI18nStore((s) => s.language);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const isDark = variant !== 'light';

  const btn = (code: AppLanguage, label: string) => {
    const active = language === code;
    return (
      <button
        type="button"
        onClick={() => setLanguage(code)}
        className={cn(
          'flex-1 rounded-lg px-3 py-2 text-sm font-semibold touch-target transition-colors',
          active
            ? isDark
              ? 'bg-white text-primary shadow-sm'
              : 'bg-primary text-white shadow-sm'
            : isDark
              ? 'text-white/85 hover:bg-white/10'
              : 'text-slate-600 hover:bg-white'
        )}
        aria-pressed={active}
      >
        {label}
      </button>
    );
  };

  return (
    <div className={cn('w-full', className)}>
      {!compact && (
        <p className={cn('text-xs font-semibold mb-1.5', isDark ? 'text-emerald-100' : 'text-slate-500')}>
          {t('lang.switch')}
        </p>
      )}
      <div
        className={cn('flex gap-1 rounded-xl border p-1', VARIANT_CLASS[variant])}
        role="group"
        aria-label={t('lang.choose')}
      >
        {btn('en', 'English')}
        {btn('fr', 'Français')}
      </div>
    </div>
  );
}
