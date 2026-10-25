interface ShopCheckoutCardProps {
  totalLabel: string;
  balanceLabel: string;
  signedIn: boolean;
  busy: boolean;
  error: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  method: 'delivery' | 'wallet' | 'paystack' | 'mixed';
  walletAmount: string;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onAddress: (value: string) => void;
  onNotes: (value: string) => void;
  onMethod: (value: 'delivery' | 'wallet' | 'paystack' | 'mixed') => void;
  onWalletAmount: (value: string) => void;
  onSubmit: () => void;
}

const field = 'w-full rounded-2xl border border-white/80 bg-white/75 px-4 py-3 text-[16px] text-ink outline-none';

const methods = [
  { id: 'delivery' as const, label: 'Pay on delivery' },
  { id: 'wallet' as const, label: 'Wallet' },
  { id: 'paystack' as const, label: 'Paystack' },
  { id: 'mixed' as const, label: 'Wallet + Paystack' },
];

export default function ShopCheckoutCard(props: ShopCheckoutCardProps) {
  return (
    <form
      className="ios-glass rounded-[28px] p-5"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <h2 className="text-[28px] font-bold tracking-tight text-ink">Checkout</h2>
      <p className="mt-1 text-sm text-muted">Available wallet {props.balanceLabel}. Prices are checked on the server.</p>
      {props.error ? <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">{props.error}</p> : null}
      <div className="mt-4 grid gap-3">
        <input className={field} value={props.name} onChange={(event) => props.onName(event.target.value)} placeholder="Full name" required />
        <input className={field} value={props.phone} onChange={(event) => props.onPhone(event.target.value)} placeholder="Phone, 0244123456" required />
        <textarea className={field} value={props.address} onChange={(event) => props.onAddress(event.target.value)} placeholder="Delivery address" rows={2} required />
        <input className={field} value={props.notes} onChange={(event) => props.onNotes(event.target.value)} placeholder="Notes (optional)" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {methods.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onMethod(item.id)}
            className={`rounded-2xl px-3 py-3 text-left text-sm font-semibold ${props.method === item.id ? 'bg-primary text-white' : 'bg-white/60 text-ink'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {props.method === 'mixed' ? (
        <label className="mt-3 block text-sm font-semibold text-ink">
          Wallet amount (GHS)
          <input className={`${field} mt-1`} inputMode="decimal" value={props.walletAmount} onChange={(event) => props.onWalletAmount(event.target.value)} />
        </label>
      ) : null}
      {!props.signedIn && props.method !== 'delivery' ? (
        <p className="mt-3 text-sm text-muted">Log in to pay with a wallet or Paystack. Pay on delivery stays available.</p>
      ) : null}
      <div className="mt-4 flex items-center justify-between text-sm font-semibold">
        <span>Order total</span>
        <span className="text-primary">{props.totalLabel}</span>
      </div>
      <button type="submit" disabled={props.busy} className="mt-4 w-full rounded-2xl bg-primary py-3.5 font-semibold text-white disabled:opacity-50">
        {props.busy ? 'Working…' : props.method === 'paystack' || props.method === 'mixed' ? 'Continue to Paystack' : 'Place order'}
      </button>
    </form>
  );
}
