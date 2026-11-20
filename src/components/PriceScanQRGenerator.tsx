import { useEffect, useState } from 'react';
import { Download, Printer, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { buildPriceScanUrl } from '@/lib/priceScan';
import { useT } from '@/lib/i18n';

interface PriceScanQRGeneratorProps {
  storeId: string;
  storeName: string;
}

export default function PriceScanQRGenerator({ storeId, storeName }: PriceScanQRGeneratorProps) {
  const t = useT();
  const [qrImage, setQrImage] = useState('');
  const [error, setError] = useState('');
  const url = buildPriceScanUrl(storeId);

  useEffect(() => {
    let active = true;
    setQrImage('');
    setError('');
    void QRCode.toDataURL(url, { width: 420, margin: 2, errorCorrectionLevel: 'M' })
      .then((dataUrl) => {
        if (active) setQrImage(dataUrl);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not generate the QR code.');
      });
    return () => { active = false; };
  }, [url]);

  const printQr = () => {
    if (!qrImage) return;
    const printWindow = window.open('', '_blank', 'popup=yes,width=640,height=720');
    if (!printWindow) return;
    printWindow.document.title = `${storeName} — ${t('priceScan.title')}`;
    const heading = printWindow.document.createElement('h1');
    heading.textContent = storeName;
    const caption = printWindow.document.createElement('p');
    caption.textContent = t('priceScan.scanBarcode');
    const image = printWindow.document.createElement('img');
    image.src = qrImage;
    image.alt = `${storeName} ${t('priceScan.title')}`;
    image.style.width = '360px';
    image.style.maxWidth = '90vw';
    image.onload = () => printWindow.print();
    printWindow.document.body.replaceChildren(heading, image, caption);
    printWindow.document.body.style.cssText = 'font-family: sans-serif; text-align: center; padding: 24px';
  };

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm" aria-labelledby="price-scan-qr-title">
      <div className="mb-3 flex items-center gap-2">
        <QrCode className="h-5 w-5 text-primary" aria-hidden="true" />
        <h3 id="price-scan-qr-title" className="font-bold text-gray-900">{t('priceScan.generateQR')}</h3>
      </div>
      <p className="mb-3 text-xs text-gray-600">{storeName}</p>
      <a href={url} className="block break-all rounded-lg bg-gray-50 p-3 text-xs text-primary underline" target="_blank" rel="noreferrer">{url}</a>
      {qrImage ? (
        <img src={qrImage} alt={`${t('priceScan.title')} QR code for ${storeName}`} className="mx-auto my-4 w-64 max-w-full rounded-lg border border-gray-100 bg-white p-2 sm:w-80" />
      ) : (
        <div className="my-4 flex h-64 items-center justify-center rounded-lg bg-gray-50 text-sm text-gray-500" role="status">
          {error || t('common.loading')}
        </div>
      )}
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <a href={qrImage || undefined} download={`${storeId}-price-scan.png`} aria-disabled={!qrImage} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold touch-target ${qrImage ? 'bg-primary text-white' : 'pointer-events-none bg-gray-200 text-gray-500'}`}>
          <Download className="h-4 w-4" />{t('priceScan.downloadQR')}
        </a>
        <button type="button" onClick={printQr} disabled={!qrImage} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 touch-target disabled:opacity-50">
          <Printer className="h-4 w-4" />{t('priceScan.printQR')}
        </button>
      </div>
    </section>
  );
}
