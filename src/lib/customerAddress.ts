export interface CustomerAddressParts {
  street: string;
  city: string;
  region: string;
}

/** Split a stored customer address into street, city, and region. */
export function splitCustomerAddress(address: string | null | undefined): CustomerAddressParts {
  const raw = (address || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return { street: '', city: '', region: '' };
  const lines = raw.split('\n').map((line) => line.trim());
  if (lines.length === 1) return { street: lines[0], city: '', region: '' };
  return {
    street: lines[0] || '',
    city: lines[1] || '',
    region: lines.slice(2).join(', '),
  };
}

/** Store structured parts in the existing customer address field. */
export function joinCustomerAddress(parts: CustomerAddressParts): string {
  return [parts.street, parts.city, parts.region].map((part) => part.trim()).filter(Boolean).join('\n');
}

/** One-line address for lists, search results, and checkout. */
export function formatCustomerAddress(address: string | null | undefined): string {
  const parts = splitCustomerAddress(address);
  return [parts.street, parts.city, parts.region].filter(Boolean).join(', ');
}
