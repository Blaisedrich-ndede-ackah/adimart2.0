/**
 * Convert an image URL or data URL into ESC/POS raster bytes (GS v 0).
 * Soft-fails to null if the image cannot be processed on this device or origin.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Max logo width in printer dots (fits typical 58mm / 384-dot printers). */
const MAX_LOGO_WIDTH_DOTS = 200;

export async function buildEscPosLogoRaster(dataUrl: string): Promise<number[] | null> {
  if (!dataUrl) return null;

  try {
    const img = await loadImage(dataUrl);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = img.width;
    sourceCanvas.height = img.height;
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext) return null;
    sourceContext.drawImage(img, 0, 0);

    const source = sourceContext.getImageData(0, 0, img.width, img.height);
    let left = img.width;
    let top = img.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const pixel = (y * img.width + x) * 4;
        const visible = source.data[pixel + 3] > 20
          && (source.data[pixel] < 245 || source.data[pixel + 1] < 245 || source.data[pixel + 2] < 245);
        if (!visible) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return null;

    const cropWidth = right - left + 1;
    const cropHeight = bottom - top + 1;
    const scale = Math.min(1, MAX_LOGO_WIDTH_DOTS / Math.max(1, cropWidth));
    const width = Math.max(8, Math.round(cropWidth * scale));
    // Width must be multiple of 8 for clean byte packing
    const widthAligned = Math.ceil(width / 8) * 8;
    const height = Math.max(8, Math.round(cropHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = widthAligned;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthAligned, height);
    const offsetX = Math.floor((widthAligned - width) / 2);
    ctx.drawImage(img, left, top, cropWidth, cropHeight, offsetX, 0, width, height);

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
