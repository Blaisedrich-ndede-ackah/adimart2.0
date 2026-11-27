import { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface PickupCodeDisplayProps {
  storeName: string;
  tokenCode: string;
  orderNumber: string;
  qrImage: string;
  expiresAt: string;
}

export default function PickupCodeDisplay({ storeName, tokenCode, orderNumber, qrImage, expiresAt }: PickupCodeDisplayProps) {
  const t = useT();
  const [remainingSeconds, setRemainingSeconds] = useState(() => Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));

  useEffect(() => {
    const update = () => setRemainingSeconds(Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const shareText = `${storeName}\n${t('pickup.token')}: ${tokenCode}\n${t('pickup.orderNumber')}: ${orderNumber}`;
  const printPass = () => {
    const printWindow = window.open('', '_blank', 'popup=yes,width=640,height=760');
    if (!printWindow) return;
    const heading = printWindow.document.createElement('h1');
    heading.textContent = storeName;
    const code = printWindow.document.createElement('p');
    code.textContent = `${t('pickup.token')}: ${tokenCode}`;
    const order = printWindow.document.createElement('p');
    order.textContent = `${t('pickup.orderNumber')}: ${orderNumber}`;
    const image = printWindow.document.createElement('img');
    image.src = qrImage;
    image.alt = `${t('pickup.token')} ${tokenCode}`;
    image.style.cssText = 'display:block;width:320px;max-width:90vw;margin:20px auto';
    printWindow.document.body.replaceChildren(heading, image, code, order);
    printWindow.document.body.style.cssText = 'font-family:system-ui,sans-serif;text-align:center;padding:24px';
    image.onload = () => printWindow.print();
  };

  return (
    <section className="mt-5 w-full max-w-sm rounded-2xl bg-white p-4 text-center shadow-sm" aria-labelledby="pickup-pass-title">
      <h2 id="pickup-pass-title" className="font-bold text-gray-900">{t('pickup.token')}</h2>
      <img src={qrImage} alt={`${t('pickup.token')} ${tokenCode}`} className="mx-auto my-3 w-full rounded-lg" />
      <p className="rounded-xl bg-emerald-50 px-4 py-3 font-mono text-2xl font-extrabold tracking-wider text-primary">{tokenCode}</p>
      <p className="mt-3 text-sm text-gray-600">{t('pickup.showAtExit')}</p>
      <p className="mt-2 text-xs text-gray-500">{t('pickup.orderNumber')}: <span className="font-mono font-bold">{orderNumber}</span></p>
      <p className="mt-1 text-xs font-semibold text-amber-800" aria-live="polite">
        {remainingSeconds > 0
          ? t('pickup.expiresIn', { time: `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}` })
          : t('pickup.expired')}
      </p>
      <a href={qrImage} download={`Adimat-pickup-${tokenCode}.png`} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-white touch-target">
        <Download className="h-5 w-5" aria-hidden="true" />{t('priceScan.downloadPickupPass')}
      </a>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <a href={`sms:?body=${encodeURIComponent(shareText)}`} className="flex min-h-11 items-center justify-center rounded-lg border px-2 text-xs font-semibold text-gray-700 touch-target">{t('pickup.smsCode')}</a>
        <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center rounded-lg border px-2 text-xs font-semibold text-gray-700 touch-target">WhatsApp</a>
        <button type="button" onClick={printPass} className="flex min-h-11 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold text-gray-700 touch-target"><Printer className="h-4 w-4" aria-hidden="true" />{t('pickup.printReceipt')}</button>
      </div>
    </section>
  );
}
