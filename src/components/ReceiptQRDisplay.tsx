import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useT } from '@/lib/i18n';
import type { ReceiptToken } from '@/lib/receiptWallet';

export default function ReceiptQRDisplay({ token, onDone }: { token: ReceiptToken; onDone: () => void }) {
  const t = useT();
  const [image, setImage] = useState('');
  useEffect(() => { let active = true; void QRCode.toDataURL(token.qr_payload, { width: 320, margin: 2 }).then((data) => { if (active) setImage(data); }); return () => { active = false; }; }, [token.qr_payload]);
  const share = () => {
    const text = `${t('receipt.title')} ${token.receipt_number}\n${token.qr_payload}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };
  return <section className="my-3 w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center">
    <h4 className="font-bold text-emerald-900">{t('receipt.scanToSave')}</h4>
    {image ? <img src={image} alt={t('receipt.title')} className="mx-auto my-2 h-44 w-44 rounded bg-white p-2" /> : <div className="mx-auto my-2 h-44 w-44 animate-pulse rounded bg-white" />}
    <p className="font-mono text-sm font-bold">{token.receipt_number}</p>
    <p className="mt-1 font-mono text-[10px] text-gray-600">{token.token}</p>
    <p className="mt-1 text-xs text-gray-600">{t('receipt.tokenExpiry')}: {new Date(token.expires_at).toLocaleDateString()}</p>
    {token.synced === 0 && <p className="mt-1 text-[11px] text-amber-800">{t('receipt.syncPending')}</p>}
    <div className="mt-3 grid grid-cols-3 gap-2">
      <button type="button" onClick={() => window.print()} className="min-h-10 rounded-lg border bg-white px-2 text-xs font-semibold">{t('receipt.print')}</button>
      <button type="button" onClick={share} className="min-h-10 rounded-lg border bg-white px-2 text-xs font-semibold">{t('receipt.shareWhatsApp')}</button>
      <button type="button" onClick={onDone} className="min-h-10 rounded-lg bg-primary px-2 text-xs font-semibold text-white">{t('receipt.done')}</button>
    </div>
  </section>;
}
