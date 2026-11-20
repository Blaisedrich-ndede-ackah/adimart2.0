import { useEffect, useState } from 'react';
import type { LocalTransaction } from '@/lib/dexie';
import { buildReceiptDataFromTransaction } from '@/lib/receiptReprint';
import { Loader2, MessageCircle } from 'lucide-react';
import type { ReceiptData } from '@/lib/receiptGenerator';
import { queueSms, receiptSmsText } from '@/lib/smsOutbox';
import { parseGhanaPhone } from '@/lib/ghanaPhone';
import { getPaymentMethodLabel } from '@/lib/paymentMethods';
import { useAuthStore } from '@/store/useAuthStore';

/** SMS and WhatsApp for an existing receipt. Does not replace Print. */
export default function ReceiptSendActions({
  data,
  defaultPhone = '',
  storeId,
}: {
  data: ReceiptData;
  defaultPhone?: string;
  storeId?: string;
}) {
  const currentStore = useAuthStore((state) => state.currentStore);
  const walletStoreId = storeId || currentStore?.id || '';
  const [phone, setPhone] = useState(defaultPhone);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setPhone(defaultPhone);
    setNote('');
  }, [defaultPhone, data.receiptNumber]);

  const message = receiptSmsText({
    storeName: data.storeName,
    receiptNumber: data.receiptNumber,
    lines: data.items.map((item) => ({
      name: item.serial ? `${item.name} SN ${item.serial}` : item.name,
      quantity: item.quantity,
      unit: item.unit,
      subtotal: item.subtotal,
    })),
    total: data.total,
    paymentMethod: getPaymentMethodLabel(data.paymentMethod) || data.paymentMethod,
    currency: data.currencyCode || 'GHS',
  });

  async function sendSms() {
    if (!walletStoreId || sending) return;
    if (!parseGhanaPhone(phone)) {
      setNote('Enter a Ghana mobile number.');
      return;
    }
    setSending(true);
    setNote('');
    try {
      const row = await queueSms({
        storeId: walletStoreId,
        kind: 'receipt',
        recipient: phone,
        message,
      });
      setNote(row.status === 'sent'
        ? 'Receipt SMS sent.'
        : row.status === 'failed'
          ? (row.error_message || 'Receipt SMS was not sent.')
          : 'This device is offline. The receipt SMS will send when it reconnects.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Could not send the receipt SMS.');
    } finally {
      setSending(false);
    }
  }

  function sendWhatsApp() {
    const parsed = parseGhanaPhone(phone);
    if (!parsed) {
      setNote('Enter a Ghana mobile number for WhatsApp.');
      return;
    }
    window.open(
      `https://wa.me/${parsed.e164.replace('+', '')}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  return (
    <div className="space-y-2">
      <input
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="Customer phone"
        inputMode="tel"
        aria-label={`Phone for receipt ${data.receiptNumber}`}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void sendSms()}
          disabled={sending}
          className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
          {sending ? 'Sending…' : 'SMS'}
        </button>
        <button
          type="button"
          onClick={sendWhatsApp}
          className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          WhatsApp
        </button>
      </div>
      {note && <p className="text-[11px] text-gray-600">{note}</p>}
    </div>
  );
}

export function TransactionReceiptSend({ txn }: { txn: LocalTransaction }) {
  const [data, setData] = useState<ReceiptData | null>(null);
  useEffect(() => {
    let active = true;
    void buildReceiptDataFromTransaction(txn).then((receipt) => {
      if (active) setData(receipt);
    });
    return () => {
      active = false;
    };
  }, [txn]);
  if (!data) return null;
  return <ReceiptSendActions data={data} defaultPhone={txn.customer_phone || ''} />;
}
