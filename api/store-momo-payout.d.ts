export function sendStoreMomoPayout(
  body: {
    storeId?: string;
    userId?: string;
    reference?: string;
    amountPesewas?: number;
    description?: string;
  },
  options?: { trusted?: boolean },
): Promise<{ ok: boolean; error?: string; transferCode?: string; alreadySent?: boolean }>;
