import { useEffect, useState } from 'react';
import { Download, MessageCircle, Printer } from 'lucide-react';
import { validateReceiptToken, type PublicReceipt } from '@/lib/receiptWallet';
import { useT } from '@/lib/i18n';
import { getStoreCurrency } from '@/lib/currency';

export default function ReceiptPage({ token }: { token: string }) {
  const t = useT();
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void validateReceiptToken(token).then((result) => {
      if (active && result.valid && result.receipt) setReceipt(result.receipt);
    }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  if (loading) return <main className="min-h-screen bg-gray-50 p-6 text-center text-gray-600">{t('common.loading')}</main>;
  if (!receipt) return <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6"><section className="rounded-2xl bg-white p-8 text-center shadow"><h1 className="text-xl font-bold">{t('receipt.notFound')}</h1></section></main>;
  const money = (amount: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: getStoreCurrency(receipt.currency_code).code }).format(amount || 0);
  const url = window.location.href;
  const saveContact = () => {
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Adimat Receipt ${receipt.receipt_number}\nORG:${receipt.store_name}\nURL:${url}\nNOTE:Digital receipt. Expires on ${new Date(receipt.expires_at).toISOString().slice(0, 10)}\nEND:VCARD`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([vcard], { type: 'text/vcard;charset=utf-8' }));
    link.download = `Adimat-receipt-${receipt.receipt_number}.vcf`;
    link.click(); URL.revokeObjectURL(link.href);
  };
  const share = () => window.open(`https://wa.me/?text=${encodeURIComponent(`${receipt.store_name} · ${receipt.receipt_number} · ${money(receipt.total_amount)}\n${url}`)}`, '_blank', 'noopener,noreferrer');
  return <main className="min-h-screen bg-gray-50 px-3 py-6 print:bg-white sm:px-6">
    <article className="mx-auto max-w-xl rounded-2xl border bg-white p-5 shadow-sm print:border-0 print:shadow-none sm:p-8">
      {receipt.store_logo_url && <img src={receipt.store_logo_url} alt="" className="mx-auto mb-3 h-16 max-w-40 object-contain" />}
      <p className="text-center text-sm text-gray-500">{receipt.store_name}</p>
      <h1 className="mt-1 text-center text-2xl font-extrabold">{t('receipt.title')}</h1>
      <p className="mt-2 text-center font-mono font-bold text-primary">{receipt.receipt_number}</p>
      <p className="mt-1 text-center text-xs text-gray-500">{new Date(receipt.created_at).toLocaleString()} · {receipt.cashier_name}</p>
      <p className="mt-1 text-center text-[11px] text-gray-500">{t('receipt.tokenExpiry')}: {new Date(receipt.expires_at).toLocaleDateString()}</p>
      <div className="mt-5 divide-y border-y">{receipt.items.map((item, index) => <div key={`${item.product_name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span className="min-w-0"><span className="block font-semibold">{item.product_name}</span><span className="text-gray-500">{item.quantity} × {money(item.unit_price)}</span></span><strong className="shrink-0">{money(item.subtotal)}</strong></div>)}</div>
      {receipt.discount_applied > 0 && <p className="mt-3 flex justify-between text-sm"><span>{t('receipt.discount')}</span><span>−{money(receipt.discount_applied)}</span></p>}
      <p className="mt-4 flex justify-between text-lg font-extrabold"><span>{t('receipt.total')}</span><span>{money(receipt.total_amount)}</span></p>
      <p className="mt-1 text-right text-xs text-gray-500">{receipt.payment_method}</p>
      <div className="mt-5 grid grid-cols-3 gap-2 print:hidden">
        <button type="button" onClick={saveContact} className="inline-flex min-h-12 items-center justify-center gap-1 rounded-xl bg-primary px-2 text-xs font-bold text-white"><Download className="h-4 w-4" />{t('receipt.saveWallet')}</button>
        <button type="button" onClick={share} className="inline-flex min-h-12 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold"><MessageCircle className="h-4 w-4" />{t('receipt.shareWhatsApp')}</button>
        <button type="button" onClick={() => window.print()} className="inline-flex min-h-12 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold"><Printer className="h-4 w-4" />{t('receipt.print')}</button>
      </div>
    </article>
  </main>;
}
