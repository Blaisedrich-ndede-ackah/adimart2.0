/** Return equivalent retail barcode spellings used by UPC-A and EAN-13. */
export function getBarcodeCandidates(barcode: string): string[] {
  const cleanBarcode = barcode.trim();
  const candidates = new Set([cleanBarcode]);
  // UPC-A is often stored as the equivalent EAN-13 with a leading zero.
  if (/^\d{12}$/.test(cleanBarcode)) candidates.add(`0${cleanBarcode}`);
  if (/^0\d{12}$/.test(cleanBarcode)) candidates.add(cleanBarcode.slice(1));
  const upcA = expandUpcE(cleanBarcode);
  if (upcA) {
    candidates.add(upcA);
    candidates.add(`0${upcA}`);
  }
  return [...candidates];
}

function expandUpcE(barcode: string): string | null {
  if (!/^[01]\d{7}$/.test(barcode)) return null;
  const numberSystem = barcode[0];
  const compressed = barcode.slice(1, 7);
  const checkDigit = barcode[7];
  const last = compressed[5];
  let body: string;

  if (last <= '2') body = `${numberSystem}${compressed.slice(0, 2)}${last}0000${compressed.slice(2, 5)}`;
  else if (last === '3') body = `${numberSystem}${compressed.slice(0, 3)}00000${compressed.slice(3, 5)}`;
  else if (last === '4') body = `${numberSystem}${compressed.slice(0, 4)}00000${compressed[4]}`;
  else body = `${numberSystem}${compressed.slice(0, 5)}0000${last}`;

  if (calculateUpcCheckDigit(body) !== checkDigit) return null;
  return `${body}${checkDigit}`;
}

function calculateUpcCheckDigit(body: string): string {
  const sum = [...body].reduce((total, digit, index) => {
    const value = Number(digit);
    return total + value * (index % 2 === 0 ? 3 : 1);
  }, 0);
  return String((10 - (sum % 10)) % 10);
}
