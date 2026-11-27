export async function emitIntegrationEvent(input: {
  storeId: string;
  event: 'sale.created' | 'stock.low' | 'order.online' | 'customer.created';
  id: string;
  eventId?: string;
}): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const response = await fetch('/api/integrations?action=emit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ store_id: input.storeId, event: input.event, id: input.id, event_id: input.eventId }),
    });
    return response.ok;
  } catch { return false; /* Integration delivery must never block POS work. */ }
}
