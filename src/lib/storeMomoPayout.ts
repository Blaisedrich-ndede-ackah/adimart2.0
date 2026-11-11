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
