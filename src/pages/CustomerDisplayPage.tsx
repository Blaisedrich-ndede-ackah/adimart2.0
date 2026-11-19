import { useCallback, useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { formatStoreMoney } from '@/lib/currency';
import { useI18nStore, useT } from '@/lib/i18n';
import { broadcastCfdMessage, useCustomerDisplayChannel, type CfdCartItem, type CfdMessage } from '@/lib/cfdChannel';

interface DisplayCart {
  items: CfdCartItem[];
  subtotal: number;
  total: number;
  itemCount: number;
  currency: string;
}

const emptyCart: DisplayCart = { items: [], subtotal: 0, total: 0, itemCount: 0, currency: 'GHS' };

export default function CustomerDisplayPage() {
  const { currentStore } = useAuthStore();
  const language = useI18nStore((state) => state.language);
  const t = useT();
  const [cart, setCart] = useState<DisplayCart>(emptyCart);
  const [status, setStatus] = useState<'empty' | 'active' | 'processing' | 'success' | 'failed'>('empty');
  const [customMessage, setCustomMessage] = useState('');
  const money = useCallback((amount: number) => formatStoreMoney(amount, cart.currency, language), [cart.currency, language]);

  const handleMessage = useCallback((message: CfdMessage) => {
    switch (message.type) {
      case 'CartUpdated':
        setCart(message.payload);
        setStatus((previous) => message.payload.items.length > 0
          ? 'active'
          : previous === 'processing' || previous === 'success' ? previous : 'empty');
        setCustomMessage('');
        break;
      case 'PaymentStarted':
        setStatus('processing');
        setCustomMessage('');
        break;
      case 'PaymentSuccess':
        setStatus('success');
        setCart(emptyCart);
        break;
      case 'PaymentFailed':
        setStatus('failed');
        break;
      case 'Reset':
        setCart(emptyCart);
        setStatus('empty');
        setCustomMessage('');
        break;
      case 'SetMessage':
        setCustomMessage(message.payload.message);
        break;
      case 'DisplayReady':
        break;
    }
  }, []);

  useCustomerDisplayChannel(handleMessage);

  useEffect(() => {
    broadcastCfdMessage({ type: 'DisplayReady' });
  }, []);

  const statusText = customMessage || (status === 'empty' ? t('cfd.emptyCart')
    : status === 'processing' ? t('cfd.processing')
      : status === 'success' ? `${t('cfd.paymentSuccess')} ${t('cfd.thankYou')}`
        : status === 'failed' ? t('cfd.paymentFailed') : t('cfd.yourCart'));

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-8 sm:px-10 lg:px-16 motion-reduce:transition-none">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[1600px] flex-col">
        <header className="flex items-center gap-4 border-b border-white/15 pb-6">
          {currentStore?.logo_url ? (
            <img src={currentStore.logo_url} alt="" className="h-14 w-14 rounded-xl bg-white object-contain p-1 sm:h-20 sm:w-20" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/10 sm:h-20 sm:w-20" aria-hidden="true">
              <Store className="h-8 w-8 text-emerald-300 sm:h-10 sm:w-10" />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-300">{t('cfd.yourCart')}</p>
            <h1 className="truncate text-2xl font-bold sm:text-4xl">{currentStore?.name || t('common.store')}</h1>
          </div>
        </header>
        <p className="pt-3 text-sm text-slate-400 sm:text-base">{t('cfd.moveToMonitor')}</p>

        <section className="flex-1 py-6 sm:py-8" aria-label={t('cfd.yourCart')}>
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-slate-200 sm:text-2xl">{t('cfd.items')}: {cart.itemCount}</h2>
            <div role="status" aria-live="polite" aria-atomic="true" className={`rounded-full px-4 py-2 text-sm font-semibold sm:text-lg ${status === 'failed' ? 'bg-red-500/20 text-red-200' : status === 'success' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-slate-100'}`}>
              {statusText}
            </div>
          </div>

          {cart.items.length === 0 ? (
            <div className="flex min-h-[30vh] items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/[0.03] px-6 text-center">
              <p className="text-3xl font-semibold text-slate-300 sm:text-5xl">{status === 'success' ? t('cfd.thankYou') : t('cfd.emptyCart')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              {cart.items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-4 py-4 sm:px-7 sm:py-6">
                  {item.image_url && <img src={item.image_url} alt="" className="h-14 w-14 rounded-xl bg-white object-cover sm:h-20 sm:w-20" />}
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-lg font-semibold sm:text-2xl">{item.name}</p>
                    <p className="mt-1 text-sm text-slate-300 sm:text-lg">{money(item.unit_price)} × {item.quantity}</p>
                  </div>
                  <p className="shrink-0 text-lg font-bold tabular-nums sm:text-2xl">{money(item.subtotal)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="border-t border-white/15 pt-5 sm:pt-7">
          <div className="ml-auto flex max-w-2xl items-center justify-between gap-5 text-xl text-slate-300 sm:text-2xl">
            <span>{t('cfd.subtotal')}</span><span className="tabular-nums">{money(cart.subtotal)}</span>
          </div>
          <div className="ml-auto mt-3 flex max-w-2xl items-center justify-between gap-5 text-3xl font-bold sm:text-5xl">
            <span>{t('cfd.total')}</span><span className="tabular-nums">{money(cart.total)}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
