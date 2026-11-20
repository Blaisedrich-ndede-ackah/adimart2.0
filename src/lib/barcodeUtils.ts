/** Return equivalent retail barcode spellings used by UPC-A and EAN-13. */
export function getBarcodeCandidates(barcode: string): string[] {
  const cleanBarcode = barcode.trim();
  const candidates = new Set([cleanBarcode]);
  // UPC-A is often stored as the equivalent EAN-13 with a leading zero.
  if (/^\d{12}$/.test(cleanBarcode)) candidates.add(`0${cleanBarcode}`);
  if (/^0\d{12}$/.test(cleanBarcode)) candidates.add(cleanBarcode.slice(1));
  return [...candidates];
}
