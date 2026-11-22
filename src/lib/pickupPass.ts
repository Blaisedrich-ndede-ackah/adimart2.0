import QRCode from 'qrcode';

export async function createPickupPassImage(
  storeName: string,
  pickupCode: string,
  title: string,
  instruction: string,
): Promise<string> {
  const qrDataUrl = await QRCode.toDataURL(pickupCode, {
    width: 640,
    margin: 2,
    errorCorrectionLevel: 'H',
  });
  const qrImage = new Image();
  qrImage.src = qrDataUrl;
  await new Promise<void>((resolve, reject) => {
    qrImage.onload = () => resolve();
    qrImage.onerror = () => reject(new Error('Could not prepare the pickup QR code.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1120;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the pickup pass image.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#059669';
  context.lineWidth = 12;
  context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  context.fillStyle = '#064e3b';
  context.textAlign = 'center';
  context.font = '700 42px system-ui, sans-serif';
  context.fillText(title, canvas.width / 2, 88, 800);
  context.fillStyle = '#374151';
  context.font = '600 32px system-ui, sans-serif';
  context.fillText(storeName, canvas.width / 2, 142, 800);

  const qrSize = 640;
  context.drawImage(qrImage, (canvas.width - qrSize) / 2, 190, qrSize, qrSize);

  context.fillStyle = '#111827';
  context.font = '700 58px ui-monospace, monospace';
  context.fillText(pickupCode, canvas.width / 2, 910, 820);
  context.fillStyle = '#4b5563';
  context.font = '500 28px system-ui, sans-serif';
  context.fillText(instruction, canvas.width / 2, 980, 820);

  return canvas.toDataURL('image/png');
}

export function downloadPickupPass(imageDataUrl: string, pickupCode: string): void {
  const link = document.createElement('a');
  link.href = imageDataUrl;
  link.download = `Adimat-pickup-${pickupCode.replace(/[^A-Za-z0-9-]/g, '')}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
