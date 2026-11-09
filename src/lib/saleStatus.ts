/** A completed sale still counts until it is voided. Pending sales never counted. */
export function isCountedSale(sale: {
  status?: string | null;
  void_status?: string | null;
}): boolean {
  return sale.status === 'completed' && sale.void_status !== 'voided';
}

export function isVoidedSale(sale: { void_status?: string | null }): boolean {
  return sale.void_status === 'voided';
}

export function isVoidRequested(sale: { void_status?: string | null }): boolean {
  return sale.void_status === 'requested';
}
