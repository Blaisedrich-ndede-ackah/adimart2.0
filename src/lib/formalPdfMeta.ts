import { formatOfficialMoney } from './currency';

export interface FormalOrg {
  name: string;
  address?: string;
  phone?: string;
  logoDataUrl?: string;
  reference?: string;
  storeId?: string;
  currencyCode?: string;
}

export function formatGhsOfficial(amount: number, currencyCode?: string | null): string {
  return formatOfficialMoney(amount, currencyCode);
}

export function orgFromStore(store?: {
  name?: string;
  address?: string;
  support_number?: string;
  logo_url?: string;
  id?: string;
  currency_code?: string;
} | null): FormalOrg {
  const name = store?.name?.trim() || 'Store';
  return {
    name,
    address: store?.address?.trim() || '',
    phone: store?.support_number?.trim() || '',
    logoDataUrl: store?.logo_url?.startsWith('data:image/') ? store.logo_url : '',
    storeId: store?.id || '',
    currencyCode: store?.currency_code || 'GHS',
  };
}
