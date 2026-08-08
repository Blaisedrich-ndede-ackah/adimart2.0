/**
 * Convert a store logo (JPEG/PNG data URL) into ESC/POS raster bytes (GS v 0).
 * Soft-fails to null if the image cannot be processed on this device.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Max logo width in printer dots (fits typical 58mm / 384-dot printers). */
const MAX_LOGO_WIDTH_DOTS = 200;

export async function buildEscPosLogoRaster(dataUrl: string): Promise<number[] | null> {
  if (!dataUrl?.startsWith('data:image/')) return null;

  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_LOGO_WIDTH_DOTS / Math.max(1, img.width));
    const width = Math.max(8, Math.round(img.width * scale));
    // Width must be multiple of 8 for clean byte packing
    const widthAligned = Math.ceil(width / 8) * 8;
    const height = Math.max(8, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = widthAligned;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthAligned, height);
    const offsetX = Math.floor((widthAligned - width) / 2);
    ctx.drawImage(img, offsetX, 0, width, height);

    const { data } = ctx.getImageData(0, 0, widthAligned, height);
    const widthBytes = widthAligned / 8;
    const raster: number[] = [];

    for (let y = 0; y < height; y++) {
      for (let byteIndex = 0; byteIndex < widthBytes; byteIndex++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byteIndex * 8 + bit;
          const i = (y * widthAligned + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          // Dark pixels print as black (bit = 1)
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          if (a > 128 && luminance < 160) {
            byte |= 0x80 >> bit;
          }
        }
        raster.push(byte);
      }
    }

    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;
    const yL = height & 0xff;
    const yH = (height >> 8) & 0xff;

    return [
      ESC, 0x61, 1, // center
      GS, 0x76, 0x30, 0x00, xL, xH, yL, yH,
      ...raster,
      LF,
      ESC, 0x61, 0, // left align
    ];
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load logo image'));
    img.src = src;
  });
}
