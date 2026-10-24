import { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { SUPPORT_CATEGORIES, type SupportCategory } from '@/lib/support/types';

interface StorefrontSupportProps {
  slug: string;
  storeName: string;
}

export default function StorefrontSupport({ slug, storeName }: StorefrontSupportProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<SupportCategory>('sales');
  const [referenceLookup, setReferenceLookup] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/customer-care', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'public-create', slug, name, phone, email, subject, message, category }),
      });
      const data = await response.json() as { reference?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not open the ticket.');
      setNotice(`Ticket ${data.reference} is open. Save this reference to check the status.`);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach customer care.');
    }
    setBusy(false);
  }

  async function lookup() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/customer-care', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'public-status', reference: referenceLookup, phone: lookupPhone }),
      });
      const data = await response.json() as { reference?: string; status?: string; subject?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Ticket not found.');
      setNotice(`${data.reference}: ${data.status} — ${data.subject}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the ticket.');
    }
    setBusy(false);
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-2 text-xs font-semibold text-primary">
        <LifeBuoy className="h-3.5 w-3.5" />
        Help {storeName}
      </button>
      {open && (
        <form
          className="ios-glass mt-3 space-y-2 rounded-2xl p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm font-semibold text-ink">Contact {storeName} customer care</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
            <input required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email (optional)" className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
            <select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)} className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm">
              {SUPPORT_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <input required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
          <textarea required value={message} onChange={(event) => setMessage(event.target.value)} rows={3} placeholder="How can we help?" className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
          <button type="submit" disabled={busy} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send to customer care</button>
          <div className="grid gap-2 border-t border-black/5 pt-2 sm:grid-cols-[1fr_1fr_auto]">
            <input value={referenceLookup} onChange={(event) => setReferenceLookup(event.target.value)} placeholder="CARE- reference" className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
            <input value={lookupPhone} onChange={(event) => setLookupPhone(event.target.value)} placeholder="Phone on the ticket" className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm" />
            <button type="button" disabled={busy} onClick={() => void lookup()} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold">Check status</button>
          </div>
          {notice && <p className="text-sm text-primary">{notice}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </form>
      )}
    </div>
  );
}
