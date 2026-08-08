/**
 * Client-side product image helpers.
 * Compresses photos to a small JPEG data URL for offline IndexedDB + Supabase TEXT storage.
 */

const MAX_DIMENSION = 480;
const JPEG_QUALITY = 0.72;
const MAX_OUTPUT_CHARS = 450_000; // soft cap so sync payloads stay reasonable

export async function fileToProductImageDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPG, PNG, or WebP).');
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Image is too large. Please choose a photo under 12MB.');
  }

  const source = await loadImageElement(file);
  const { width, height } = fitWithin(source.width, source.height, MAX_DIMENSION);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process image on this device.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source.element, 0, 0, width, height);
  source.cleanup();

  let quality = JPEG_QUALITY;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);

  while (dataUrl.length > MAX_OUTPUT_CHARS && quality > 0.4) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  if (dataUrl.length > MAX_OUTPUT_CHARS) {
    throw new Error('Could not compress this image enough. Try a simpler photo.');
  }

  return dataUrl;
}

function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = max / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function loadImageElement(file: File): Promise<{
  element: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      element: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load image'));
    el.src = url;
  });

  return {
    element: img,
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

export function hasProductImage(imageUrl?: string | null): boolean {
  return Boolean(imageUrl && imageUrl.startsWith('data:image/'));
}
