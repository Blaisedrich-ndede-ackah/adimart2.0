import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Gift, Loader2, PackageCheck, Plus, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { db, type LocalGiftCard, type LocalGiftCardTransaction, type LocalProduct, type LocalRentalAgreement, type LocalRentalItem } from '@/lib/dexie';
import { useAuthStore } from '@/store/useAuthStore';
import { useFormatMoney } from '@/lib/currency';
import { changeGiftCardBalance, createRentalAgreement, findGiftCard, giftCardIsUsable, issueGiftCard, normalizeGiftCardCode, returnRentalAgreement, setGiftCardDisabled } from '@/lib/phase2';

type Phase2Tab = 'gift-cards' | 'rentals';
type RentalRow = { agreement: LocalRentalAgreement; items: LocalRentalItem[] };

function dateTimeLocal(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function GiftCardsRentalsPage() {
  const { currentStore, currentUser } = useAuthStore();
  const money = useFormatMoney();
  const [tab, setTab] = useState<Phase2Tab>('gift-cards');
  const [cards, setCards] = useState<LocalGiftCard[]>([]);
  const [ledger, setLedger] = useState<LocalGiftCardTransaction[]>([]);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [giftValue, setGiftValue] = useState('');
  const [giftExpiry, setGiftExpiry] = useState('');
  const [giftCustomerId, setGiftCustomerId] = useState('');
  const [giftQuery, setGiftQuery] = useState('');
  const [giftFound, setGiftFound] = useState<LocalGiftCard | null>(null);
  const [reloadValue, setReloadValue] = useState('');

  const [rentalProductId, setRentalProductId] = useState('');
  const [rentalCustomerId, setRentalCustomerId] = useState('');
  const [rentalCustomerName, setRentalCustomerName] = useState('');
  const [rentalCustomerPhone, setRentalCustomerPhone] = useState('');
  const [rentalQty, setRentalQty] = useState('1');
  const [rentalRatePeriod, setRentalRatePeriod] = useState<LocalRentalItem['rate_period']>('daily');
  const [rentalDueAt, setRentalDueAt] = useState(() => dateTimeLocal(new Date(Date.now() + 86_400_000)));
  const [rentalNotes, setRentalNotes] = useState('');

  const storeId = currentStore?.id || '';
  const selectedRentalProduct = products.find((product) => product.id === rentalProductId);

  const load = useCallback(async () => {
    if (!storeId) return;
    setBusy(true);
    try {
      const [allCards, allLedger, allAgreements, allProducts, allCustomers] = await Promise.all([
        db.gift_cards.where('store_id').equals(storeId).toArray(),
        db.gift_card_transactions.where('store_id').equals(storeId).toArray(),
        db.rental_agreements.where('store_id').equals(storeId).toArray(),
        db.products.where('store_id').equals(storeId).toArray(),
        db.customers.where('store_id').equals(storeId).toArray(),
      ]);
      allCards.sort((a, b) => b.created_at.localeCompare(a.created_at));
      allLedger.sort((a, b) => b.created_at.localeCompare(a.created_at));
      allAgreements.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setCards(allCards);
      setLedger(allLedger.slice(0, 30));
      setProducts(allProducts.filter((product) => product.is_rentable === 1 && product.is_active === 1).sort((a, b) => a.name.localeCompare(b.name)));
      setCustomers(allCustomers.filter((customer) => customer.is_active === 1).map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone })));
      setRentals(await Promise.all(allAgreements.map(async (agreement) => ({
        agreement,
        items: await db.rental_items.where('agreement_id').equals(agreement.id).toArray(),
      }))));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load gift cards and rental agreements.');
    } finally {
      setBusy(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  const activeRentals = useMemo(() => rentals.filter(({ agreement }) => agreement.status === 'active' || agreement.status === 'overdue'), [rentals]);

  const runAction = async (action: () => Promise<void>) => {
    setError(''); setMessage(''); setBusy(true);
    try { await action(); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'The operation could not be completed.'); }
    finally { setBusy(false); }
  };

  const handleIssue = () => runAction(async () => {
    if (!storeId || !currentUser) throw new Error('Select a store and sign in first.');
    const customer = customers.find((item) => item.id === giftCustomerId);
    const card = await issueGiftCard({ storeId, value: Number(giftValue), customerId: customer?.id || null, customerName: customer?.name || '', expiresAt: giftExpiry ? new Date(`${giftExpiry}T23:59:59`).toISOString() : null, createdBy: currentUser.id });
    setGiftValue(''); setGiftExpiry(''); setGiftCustomerId(''); setGiftQuery(card.code); setGiftFound(card);
    setMessage(`Gift card created. Code: ${card.code}`);
  });

  const handleLookup = async () => {
    if (!storeId) return;
    const card = await findGiftCard(storeId, giftQuery);
    setGiftFound(card);
    setError(card ? '' : 'No card found for that code in this store.');
  };

  const handleReload = () => runAction(async () => {
    if (!storeId || !currentUser) throw new Error('Select a store and sign in first.');
    const card = await changeGiftCardBalance({ storeId, code: giftFound?.code || giftQuery, amount: Number(reloadValue), type: 'reload', createdBy: currentUser.id });
    setGiftFound(card); setReloadValue(''); setMessage(`Card reloaded. New balance: ${money(card.balance)}.`);
  });

  const handleDisable = () => runAction(async () => {
    if (!storeId || !giftFound) throw new Error('Look up a gift card first.');
    const disabled = giftFound.status !== 'disabled';
    await setGiftCardDisabled(storeId, giftFound.id, disabled);
    setGiftFound({ ...giftFound, status: disabled ? 'disabled' : giftFound.balance > 0 ? 'active' : 'depleted' });
    setMessage(disabled ? 'Gift card disabled.' : 'Gift card re-enabled.');
  });

  const handleCreateRental = () => runAction(async () => {
    if (!storeId || !currentUser || !selectedRentalProduct) throw new Error('Choose a rentable product.');
    const customer = customers.find((item) => item.id === rentalCustomerId);
    const agreement = await createRentalAgreement({
      storeId, productId: selectedRentalProduct.id, quantity: Number(rentalQty), customerId: customer?.id || null,
      customerName: customer?.name || rentalCustomerName, customerPhone: customer?.phone || rentalCustomerPhone,
      startsAt: new Date().toISOString(), dueAt: new Date(rentalDueAt).toISOString(), ratePeriod: rentalRatePeriod,
      createdBy: currentUser.id, createdByName: currentUser.name || '', notes: rentalNotes,
    });
    setMessage(`Rental ${agreement.agreement_number} created. Record the rental charge and deposit through the till.`);
    setRentalQty('1'); setRentalNotes('');
  });

  const handleReturnRental = (agreement: LocalRentalAgreement) => runAction(async () => {
    if (!storeId || !currentUser) throw new Error('Select a store and sign in first.');
    const damage = window.prompt('Damage fee to deduct from the deposit (enter 0 if none):', '0');
    if (damage === null) return;
    const condition = window.prompt('Return condition (optional):', '') || '';
    const result = await returnRentalAgreement({ storeId, agreementId: agreement.id, createdBy: currentUser.id, damageFee: Number(damage) || 0, condition });
    setMessage(`Return recorded. Late fee ${money(result.agreement.late_fee)} · damage fee ${money(result.agreement.damage_fee)} · deposit refund ${money(result.depositRefund)}.`);
  });

  if (!currentStore || !currentUser) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 pb-24 md:p-6">
        <header className="rounded-2xl bg-gradient-to-br from-indigo-900 via-slate-900 to-emerald-950 p-5 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-200">Phase 2 · Store operations</p>
          <h1 className="mt-1 text-2xl font-bold">Gift cards & rentals</h1>
          <p className="mt-1 text-sm text-white/70">Issue and track stored-value cards, or manage rentable stock and returns.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setTab('gift-cards')} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'gift-cards' ? 'bg-white text-indigo-900' : 'bg-white/15 text-white'}`}><Gift className="mr-1.5 inline h-4 w-4" />Gift cards</button>
            <button type="button" onClick={() => setTab('rentals')} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === 'rentals' ? 'bg-white text-indigo-900' : 'bg-white/15 text-white'}`}><CalendarClock className="mr-1.5 inline h-4 w-4" />Rentals ({activeRentals.length})</button>
            <button type="button" onClick={() => void load()} disabled={busy} className="ml-auto rounded-full bg-white/15 p-2 text-white" aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></button>
          </div>
        </header>

        {(error || message) && <div role={error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{error || message}</div>}

        {tab === 'gift-cards' ? <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <section className="space-y-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 font-bold text-gray-900"><Plus className="h-4 w-4 text-primary" />Issue a gift card</h2>
              <label className="mt-3 block text-xs font-semibold text-gray-600">Starting value<input type="number" min="0.01" step="0.01" value={giftValue} onChange={(event) => setGiftValue(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" placeholder="0.00" /></label>
              <label className="mt-3 block text-xs font-semibold text-gray-600">Link customer (optional)<select value={giftCustomerId} onChange={(event) => setGiftCustomerId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm"><option value="">No customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label>
              <label className="mt-3 block text-xs font-semibold text-gray-600">Expiry date (optional)<input type="date" value={giftExpiry} onChange={(event) => setGiftExpiry(event.target.value)} min={new Date().toISOString().slice(0, 10)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" /></label>
              <button type="button" disabled={busy || !giftValue} onClick={handleIssue} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}Issue card</button>
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">Issuing a card records a liability and opening balance. Record the customer's card purchase payment separately at checkout.</p>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <h2 className="font-bold text-gray-900">Check balance / reload</h2>
              <div className="mt-3 flex gap-2"><input value={giftQuery} onChange={(event) => setGiftQuery(normalizeGiftCardCode(event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') void handleLookup(); }} placeholder="Enter gift card code" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm uppercase" /><button type="button" onClick={() => void handleLookup()} className="rounded-xl bg-slate-900 px-3 text-white" aria-label="Look up gift card"><Search className="h-4 w-4" /></button></div>
              {giftFound && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                <div className="flex items-start justify-between gap-2"><div><p className="font-mono text-sm font-bold tracking-wider text-indigo-950">{giftFound.code}</p><p className="mt-1 text-xs text-indigo-800">Balance {money(giftFound.balance)} · {giftFound.status}{giftFound.expires_at ? ` · expires ${new Date(giftFound.expires_at).toLocaleDateString()}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${giftCardIsUsable(giftFound) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{giftCardIsUsable(giftFound) ? 'USABLE' : 'NOT USABLE'}</span></div>
                <div className="mt-3 flex gap-2"><input type="number" min="0.01" step="0.01" value={reloadValue} onChange={(event) => setReloadValue(event.target.value)} placeholder="Reload amount" className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm" /><button type="button" disabled={busy || !reloadValue} onClick={handleReload} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Reload</button><button type="button" disabled={busy} onClick={handleDisable} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-900">{giftFound.status === 'disabled' ? 'Enable' : 'Disable'}</button></div>
              </div>}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="font-bold text-gray-900">Issued cards</h2><span className="text-xs text-gray-500">Outstanding {money(cards.reduce((sum, card) => sum + card.balance, 0))}</span></div>
            <div className="mt-3 max-h-[36rem] space-y-2 overflow-y-auto">
              {cards.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">No gift cards issued on this store yet.</p> : cards.map((card) => <button key={card.id} type="button" onClick={() => { setGiftFound(card); setGiftQuery(card.code); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-100 p-3 text-left hover:border-indigo-200 hover:bg-indigo-50/50"><span className="min-w-0"><span className="block truncate font-mono text-sm font-bold text-gray-900">{card.code}</span><span className="mt-1 block truncate text-xs text-gray-500">{card.customer_name || 'Unassigned'} · {card.status}</span></span><span className="shrink-0 text-right"><span className="block font-bold text-gray-900">{money(card.balance)}</span><span className="text-[10px] text-gray-500">of {money(card.initial_value)}</span></span></button>)}
            </div>
            <h3 className="mt-4 border-t border-gray-100 pt-3 text-xs font-bold uppercase tracking-wide text-gray-500">Recent card activity</h3>
            <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">{ledger.length ? ledger.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-gray-600">{cards.find((card) => card.id === entry.gift_card_id)?.code || 'Gift card'} · {entry.type}</span><span className="shrink-0 font-semibold text-gray-900">{money(entry.amount)} → {money(entry.balance_after)}</span></div>) : <p className="text-xs text-gray-500">No activity recorded.</p>}</div>
          </section>
        </div> : <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 font-bold text-gray-900"><PackageCheck className="h-4 w-4 text-primary" />Start a rental</h2>
            {products.length === 0 ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Mark a product as rentable in Inventory and set at least one rental rate first.</p> : <>
              <label className="mt-3 block text-xs font-semibold text-gray-600">Product<select value={rentalProductId} onChange={(event) => setRentalProductId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm"><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stock_level} available</option>)}</select></label>
              <label className="mt-3 block text-xs font-semibold text-gray-600">Existing customer (optional)<select value={rentalCustomerId} onChange={(event) => { const customer = customers.find((row) => row.id === event.target.value); setRentalCustomerId(event.target.value); setRentalCustomerName(customer?.name || ''); setRentalCustomerPhone(customer?.phone || ''); }} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm"><option value="">Enter customer details</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label>
              {!rentalCustomerId && <div className="mt-2 grid grid-cols-2 gap-2"><input value={rentalCustomerName} onChange={(event) => setRentalCustomerName(event.target.value)} placeholder="Customer name" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /><input value={rentalCustomerPhone} onChange={(event) => setRentalCustomerPhone(event.target.value)} placeholder="Phone" className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></div>}
              <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs font-semibold text-gray-600">Quantity<input type="number" min="1" step="1" value={rentalQty} onChange={(event) => setRentalQty(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" /></label><label className="text-xs font-semibold text-gray-600">Rate period<select value={rentalRatePeriod} onChange={(event) => setRentalRatePeriod(event.target.value as LocalRentalItem['rate_period'])} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm"><option value="daily">Daily · {money(selectedRentalProduct?.rental_rate_daily || 0)}</option><option value="weekly">Weekly · {money(selectedRentalProduct?.rental_rate_weekly || 0)}</option><option value="monthly">Monthly · {money(selectedRentalProduct?.rental_rate_monthly || 0)}</option></select></label></div>
              <label className="mt-3 block text-xs font-semibold text-gray-600">Due back<input type="datetime-local" value={rentalDueAt} onChange={(event) => setRentalDueAt(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm" /></label>
              <p className="mt-2 rounded-xl bg-indigo-50 p-3 text-xs text-indigo-900">Deposit to collect: <strong>{money((selectedRentalProduct?.deposit_amount || 0) * (Number(rentalQty) || 0))}</strong>. The app records the deposit obligation; collect it through the till.</p>
              <textarea value={rentalNotes} onChange={(event) => setRentalNotes(event.target.value)} rows={2} placeholder="Notes or item condition at handover" className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
              <button type="button" disabled={busy || !rentalProductId || !(rentalCustomerId || rentalCustomerName.trim())} onClick={handleCreateRental} className="mt-3 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Create agreement & release stock</button>
            </>}
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="font-bold text-gray-900">Rental agreements</h2><span className="text-xs text-gray-500">{activeRentals.length} active · {activeRentals.filter(({ agreement }) => agreement.due_at < new Date().toISOString()).length} overdue</span></div>
            <div className="mt-3 space-y-3">{rentals.length ? rentals.map(({ agreement, items }) => {
              const overdue = (agreement.status === 'active' || agreement.status === 'overdue') && agreement.due_at < new Date().toISOString();
              return <article key={agreement.id} className={`rounded-xl border p-3 ${overdue ? 'border-red-200 bg-red-50/50' : 'border-gray-100 bg-white'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-xs font-bold text-gray-800">{agreement.agreement_number}</p><p className="mt-1 text-sm font-semibold text-gray-900">{agreement.customer_name} · {agreement.customer_phone || 'No phone'}</p><p className="mt-1 text-xs text-gray-600">{items.map((item) => `${item.quantity} × ${item.product_name}`).join(', ')}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${overdue ? 'bg-red-100 text-red-800' : agreement.status === 'returned' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800'}`}>{overdue ? 'OVERDUE' : agreement.status.toUpperCase()}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600"><p>Due {new Date(agreement.due_at).toLocaleString()}</p><p>Deposit {money(agreement.deposit_amount)}</p>{agreement.status === 'returned' && <><p>Late fee {money(agreement.late_fee)}</p><p>Damage fee {money(agreement.damage_fee)}</p><p className="col-span-2 font-semibold text-gray-900">Refunded deposit {money(agreement.deposit_returned)}</p></>}</div>
                {(agreement.status === 'active' || agreement.status === 'overdue') && <button type="button" disabled={busy} onClick={() => handleReturnRental(agreement)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Check item in</button>}
              </article>;
            }) : <p className="py-10 text-center text-sm text-gray-500">No rental agreements recorded yet.</p>}</div>
          </section>
        </div>}
      </div>
    </div>
  );
}
