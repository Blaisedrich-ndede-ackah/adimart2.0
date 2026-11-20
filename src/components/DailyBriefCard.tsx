import { Sparkles } from 'lucide-react';
import { useFormatMoney } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/useAuthStore';
import { useAdimatAi } from '@/lib/adimatAi/useAdimatAi';

interface DailyBriefCardProps {
  onNavigate: (page: string) => void;
}

export default function DailyBriefCard({ onNavigate }: DailyBriefCardProps) {
  const t = useT();
  const money = useFormatMoney();
  const { currentStore, currentUser } = useAuthStore();
  const ai = useAdimatAi(currentStore?.id, currentUser?.role === 'owner');
  const brief = ai.report?.brief;

  return (
    <section className="ios-glass rounded-2xl p-4" aria-label={t('ai.brief.title')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">ADIMAT AI</p>
          <h2 className="mt-1 text-base font-bold text-gray-900">{t('ai.brief.title')}</h2>
        </div>
        <Sparkles className="h-5 w-5 text-primary" />
      </div>
      {ai.status === 'loading' && !brief ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-white/50" />
      ) : ai.status === 'error' ? (
        <p className="mt-3 text-sm text-amber-800">{ai.error}</p>
      ) : brief ? (
        <>
          <p className="mt-3 text-2xl font-bold text-gray-900">{money(brief.sales)}</p>
          <p className="text-xs text-gray-600">{t('ai.brief.yesterdaySales')}</p>
          {brief.profit != null && (
            <p className="mt-1 text-sm text-gray-700">{t('ai.brief.profit')}: {money(brief.profit)}</p>
          )}
          <p className="mt-2 text-xs leading-5 text-gray-600">
            {t(brief.whyKey, {
              salesCount: brief.saleCount,
              prevMoney: money(brief.previousDaySales),
              weekMoney: money(brief.weekAverageSales),
              salesMoney: money(brief.sales),
            })}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/55 px-2 py-2">
              <p className="text-sm font-bold">{brief.lowStock}</p>
              <p className="text-[10px] text-gray-500">{t('ai.brief.lowStock')}</p>
            </div>
            <div className="rounded-xl bg-white/55 px-2 py-2">
              <p className="text-sm font-bold">{brief.expiring}</p>
              <p className="text-[10px] text-gray-500">{t('ai.brief.expiring')}</p>
            </div>
            <div className="rounded-xl bg-white/55 px-2 py-2">
              <p className="text-sm font-bold">{brief.topItems[0]?.name ? brief.topItems[0].qty : '—'}</p>
              <p className="truncate text-[10px] text-gray-500">{brief.topItems[0]?.name || t('ai.brief.topItems')}</p>
            </div>
          </div>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => onNavigate('adimat-ai')}
        className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white touch-target"
      >
        ADIMAT AI
      </button>
    </section>
  );
}
