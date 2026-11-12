/** Ask Paystack to send a goods payment to the store's saved MoMo number. */

export async function routeGoodsPaymentToStoreMomo(input: {
  storeId: string;
  userId: string;
  reference: string;
  amountGhs: number;
  description: string;
}): Promise<{ ok: boolean; error?: string }> {
  const amountPesewas = Math.round(Number(input.amountGhs) * 100);
  const reference = input.reference.trim();
  if (!input.storeId || !input.userId || !reference || amountPesewas < 100) {
    return { ok: false, error: 'This goods payment cannot be sent to MoMo.' };
  }
  try {
    const response = await fetch('/api/store-momo-payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: input.storeId,
        userId: input.userId,
        reference,
        amountPesewas,
        description: input.description,
      }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; ok?: boolean };
    if (!response.ok || payload.ok === false) {
      return { ok: false, error: payload.error || 'Paystack could not send this payment to the store MoMo number.' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Paystack could not send this payment to the store MoMo number.' };
  }
}

async function postPayoutAction(action: 'undo' | 'settle', input: {
  storeId: string;
  userId: string;
  reference: string;
}): Promise<{ ok: boolean; message: string }> {
  const reference = input.reference.trim();
  if (!input.storeId || !input.userId || !reference) {
    return { ok: false, message: 'This payment has no Paystack reference.' };
  }
  try {
    const response = await fetch('/api/store-momo-payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, storeId: input.storeId, userId: input.userId, reference }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; ok?: boolean };
    const message = payload.message || payload.error || 'Could not update the MoMo payout.';
    if (!response.ok || payload.ok === false) return { ok: false, message };
    return { ok: true, message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not reach the MoMo payout.' };
  }
}

/** Flag a sent goods payout so the store can return the MoMo amount. */
export function undoGoodsMomoPayout(input: {
  storeId: string;
  userId: string;
  reference: string;
}): Promise<{ ok: boolean; message: string }> {
  return postPayoutAction('undo', input);
}

/** Record that the store has returned a flagged MoMo payout. */
export function markGoodsMomoPayoutReturned(input: {
  storeId: string;
  userId: string;
  reference: string;
}): Promise<{ ok: boolean; message: string }> {
  return postPayoutAction('settle', input);
}
