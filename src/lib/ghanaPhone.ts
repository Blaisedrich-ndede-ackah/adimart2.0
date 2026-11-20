/** Ghana mobile numbers as E.164 (+233XXXXXXXXX) and local 0XXXXXXXXX. */

const MOBILE_PREFIXES = [
  '20', '23', '24', '25', '26', '27', '28', '50', '53', '54', '55', '56', '57', '59',
];

export interface GhanaPhone {
  e164: string;
  local: string;
  digits: string;
}

export function parseGhanaPhone(input: string): GhanaPhone | null {
  const digits = input.replace(/\D/g, '');
  let national = '';
  if (digits.startsWith('233') && digits.length === 12) national = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 10) national = digits.slice(1);
  else if (digits.length === 9) national = digits;
  else return null;

  if (!/^\d{9}$/.test(national)) return null;
  if (!MOBILE_PREFIXES.some((prefix) => national.startsWith(prefix))) return null;

  return {
    e164: `+233${national}`,
    local: `0${national}`,
    digits: national,
  };
}

export function phonesMatch(left: string, right: string): boolean {
  const a = parseGhanaPhone(left);
  const b = parseGhanaPhone(right);
  if (!a || !b) return false;
  return a.e164 === b.e164;
}
