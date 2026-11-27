import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Clock3, QrCode, ShieldCheck, ShoppingBag, Sparkles, Store } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { formatStoreMoney } from '@/lib/currency';
import { useI18nStore, useT } from '@/lib/i18n';
import { broadcastCfdMessage, useCustomerDisplayChannel, type CfdCartItem, type CfdMessage, type CfdReceiptPayload } from '@/lib/cfdChannel';

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
  const [receipt, setReceipt] = useState<CfdReceiptPayload | null>(null);
  const [receiptQr, setReceiptQr] = useState('');
  const money = useCallback((amount: number) => formatStoreMoney(amount, cart.currency, language), [cart.currency, language]);

  const handleMessage = useCallback((message: CfdMessage) => {
    switch (message.type) {
      case 'CartUpdated':
        setCart(message.payload);
        setStatus((previous) => message.payload.items.length > 0
          ? 'active'
          : previous === 'processing' || previous === 'success' ? previous : 'empty');
        setCustomMessage('');
        if (message.payload.items.length > 0) setReceipt(null);
        break;
      case 'PaymentStarted':
        setReceipt(null);
        setReceiptQr('');
        setStatus('processing');
        setCustomMessage('');
        break;
      case 'PaymentSuccess':
        setReceipt(message.payload || null);
        setStatus('success');
        setCart(emptyCart);
        break;
      case 'PaymentFailed':
        setReceipt(null);
        setStatus('failed');
        break;
      case 'Reset':
        setCart(emptyCart);
        setReceipt(null);
        setReceiptQr('');
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

  useEffect(() => {
    let active = true;
    if (!receipt?.qrPayload) {
      setReceiptQr('');
      return () => { active = false; };
    }
    void QRCode.toDataURL(receipt.qrPayload, { width: 480, margin: 2, errorCorrectionLevel: 'H' })
      .then((dataUrl) => { if (active) setReceiptQr(dataUrl); })
      .catch(() => { if (active) setReceiptQr(''); });
    return () => { active = false; };
  }, [receipt?.qrPayload]);

  const statusText = customMessage || (status === 'empty' ? t('cfd.emptyCart')
    : status === 'processing' ? t('cfd.processing')
      : status === 'success' ? t('cfd.paymentComplete')
        : status === 'failed' ? t('cfd.paymentFailed') : t('cfd.yourCart'));
  const statusStyle = status === 'failed' ? 'bg-rose-50 text-rose-700 ring-rose-200'
    : status === 'success' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'processing' ? 'bg-amber-50 text-amber-800 ring-amber-200'
        : 'bg-white/80 text-slate-600 ring-slate-200';

  return (
    <main className="customer-facing-display relative min-h-screen overflow-hidden bg-[#f4f8f6] px-4 py-5 text-slate-900 sm:px-8 sm:py-7 lg:px-12">
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-48 h-[34rem] w-[34rem] rounded-full bg-emerald-200/45 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-64 -left-40 h-[34rem] w-[34rem] rounded-full bg-teal-100/70 blur-3xl" />
      <div className="relative mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-[1500px] flex-col sm:min-h-[calc(100vh-3.5rem)]">
        <header className="flex items-center justify-between gap-4 rounded-[1.75rem] border border-white/80 bg-white/75 px-4 py-4 shadow-sm shadow-emerald-950/5 backdrop-blur-xl sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {currentStore?.logo_url ? (
              <img src={currentStore.logo_url} alt="" className="h-12 w-12 rounded-2xl bg-white object-contain p-1 shadow-sm sm:h-16 sm:w-16" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-900/15 sm:h-16 sm:w-16" aria-hidden="true">
                <Store className="h-6 w-6 sm:h-8 sm:w-8" />
              </div>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700 sm:text-xs"><Sparkles className="h-3.5 w-3.5" /> Adimat</p>
              <h1 className="truncate text-lg font-bold tracking-tight sm:text-2xl">{currentStore?.name || t('common.store')}</h1>
            </div>
          </div>
          <div className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ring-1 sm:px-4 sm:text-sm ${statusStyle}`} role="status" aria-live="polite" aria-atomic="true">
            <span className={`h-2 w-2 rounded-full ${status === 'success' ? 'bg-emerald-500' : status === 'processing' ? 'animate-pulse bg-amber-500' : status === 'failed' ? 'bg-rose-500' : 'bg-slate-400'}`} />
            <span className="max-w-[42vw] truncate">{statusText}</span>
          </div>
        </header>

        <p className="px-2 pb-3 pt-4 text-xs text-slate-500 sm:px-4 sm:pt-5 sm:text-sm">{t('cfd.moveToMonitor')}</p>

        <section className="flex flex-1 flex-col justify-center py-3 sm:py-5" aria-label={t('cfd.yourCart')}>
          {status === 'success' ? (
            <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white bg-white shadow-xl shadow-emerald-950/10 md:grid-cols-[1fr_1.05fr]">
              <div className="flex flex-col justify-center bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 px-7 py-8 text-white sm:px-10 sm:py-12">
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20 sm:h-16 sm:w-16"><CheckCircle2 className="h-8 w-8 sm:h-9 sm:w-9" /></div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-100">{t('cfd.paymentSuccess')}</p>
                <h2 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">{t('cfd.thankYou')}</h2>
                <p className="mt-4 max-w-md text-base leading-relaxed text-emerald-50 sm:text-lg">{receipt ? t('cfd.secureReceipt') : t('cfd.secureCheckout')}</p>
                {receipt && <div className="mt-8 border-t border-white/20 pt-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">{t('cfd.receiptNumber')}</p>
                  <p className="mt-1 break-all text-xl font-bold tracking-wide sm:text-2xl">{receipt.receiptNumber}</p>
                </div>}
              </div>
              {receipt ? (
                <div className="flex flex-col items-center justify-center px-6 py-8 text-center sm:px-10 sm:py-10">
                  <div className="mb-4 flex items-center gap-2 text-emerald-800"><QrCode className="h-5 w-5" /><h3 className="text-lg font-bold sm:text-xl">{t('cfd.receiptPrompt')}</h3></div>
                  {receiptQr ? <img src={receiptQr} alt={`${t('cfd.receiptPrompt')} ${receipt.receiptNumber}`} className="h-56 w-56 rounded-2xl border border-slate-100 bg-white p-2 shadow-sm sm:h-72 sm:w-72" /> : <div className="flex h-56 w-56 items-center justify-center rounded-2xl bg-slate-50 sm:h-72 sm:w-72"><QrCode className="h-12 w-12 animate-pulse text-emerald-600" /></div>}
                  <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600 sm:text-base">{t('cfd.scanHint')}</p>
                  <div className="mt-5 flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-800 sm:text-sm"><ShieldCheck className="h-4 w-4 shrink-0" />{t('receipt.title')}</div>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" />{t('cfd.receiptExpiry')}: {new Date(receipt.expiresAt).toLocaleDateString(language)}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center px-6 py-10 text-center sm:px-10">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-12 w-12" /></div>
                  <p className="mt-5 text-lg font-semibold text-slate-800">{t('cfd.thankYou')}</p>
                </div>
              )}
            </div>
          ) : status === 'empty' ? (
            <div className="mx-auto flex min-h-[48vh] w-full max-w-5xl flex-col items-center justify-center rounded-[2rem] border border-white bg-white/70 px-6 py-12 text-center shadow-sm backdrop-blur sm:min-h-[56vh]">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 sm:h-24 sm:w-24"><ShoppingBag className="h-10 w-10 sm:h-12 sm:w-12" /></div>
              <h2 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-5xl">{customMessage || t('cfd.emptyCart')}</h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-500 sm:text-lg">{t('cfd.secureCheckout')}</p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white bg-white/85 shadow-xl shadow-emerald-950/5 backdrop-blur">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-8 sm:py-6">
                <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">{t('cfd.yourCart')}</p><h2 className="mt-1 text-xl font-bold tracking-tight sm:text-3xl">{t('cfd.items')}: {cart.itemCount}</h2></div>
                {status === 'processing' && <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" aria-hidden="true" />}
              </div>
              <ul className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto px-5 sm:px-8">
                {cart.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-4 sm:gap-5 sm:py-5">
                    {item.image_url ? <img src={item.image_url} alt="" className="h-14 w-14 rounded-2xl bg-slate-100 object-cover sm:h-20 sm:w-20" /> : <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 sm:h-20 sm:w-20"><ShoppingBag className="h-6 w-6" /></div>}
                    <div className="min-w-0 flex-1"><p className="break-words text-base font-semibold text-slate-800 sm:text-xl">{item.name}</p><p className="mt-1 text-sm text-slate-500 sm:text-base">{money(item.unit_price)} × {item.quantity}</p></div>
                    <p className="shrink-0 text-base font-bold tabular-nums text-slate-900 sm:text-xl">{money(item.subtotal)}</p>
                  </li>
                ))}
              </ul>
              <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-5 sm:px-8 sm:py-7">
                <div className="ml-auto flex max-w-xl items-center justify-between gap-4 text-sm text-slate-500 sm:text-base"><span>{t('cfd.subtotal')}</span><span className="tabular-nums">{money(cart.subtotal)}</span></div>
                <div className="ml-auto mt-2 flex max-w-xl items-center justify-between gap-4 text-2xl font-bold text-slate-900 sm:mt-3 sm:text-4xl"><span>{t('cfd.total')}</span><span className="tabular-nums">{money(cart.total)}</span></div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
