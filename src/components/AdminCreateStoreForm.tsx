import { useState } from 'react';
import { CheckCircle2, FileText, Loader2, Plus, Store } from 'lucide-react';
import CopyableStoreId from '@/components/CopyableStoreId';
import { createAdminStore, type AdminCreatedStore } from '@/lib/adminPortal';
import { isValidGhanaPhone } from '@/lib/platformSettings';
import {
  DEFAULT_INVOICE_PACKAGE_ID,
  downloadStoreSubscriptionInvoice,
} from '@/lib/adminInvoicePdf';
import { SUBSCRIPTION_PACKAGES, formatGhsAmount } from '@/lib/subscriptionPricing';

export default function AdminCreateStoreForm({
  onCreated,
}: {
  onCreated: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [supportNumber, setSupportNumber] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPin, setOwnerPin] = useState('');
  const [packageId, setPackageId] = useState(DEFAULT_INVOICE_PACKAGE_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<AdminCreatedStore | null>(null);
  const [createdPackageId, setCreatedPackageId] = useState(DEFAULT_INVOICE_PACKAGE_ID);
  const [invoiceNote, setInvoiceNote] = useState('');

  const selectedPkg = SUBSCRIPTION_PACKAGES.find((p) => p.id === packageId) || SUBSCRIPTION_PACKAGES[3];

  const resetForm = () => {
    setStoreName('');
    setAddress('');
    setSupportNumber('');
    setOwnerName('');
    setOwnerPhone('');
    setOwnerPin('');
    setPackageId(DEFAULT_INVOICE_PACKAGE_ID);
  };

  const issueInvoice = (store: AdminCreatedStore, pkgId = packageId) => {
    const phones = [store.supportNumber, store.ownerPhone].filter(Boolean).join(' / ');
    const result = downloadStoreSubscriptionInvoice({
      billTo: {
        ownerName: store.ownerName,
        storeName: store.storeName,
        address: store.address,
        phones,
        storeId: store.storeId,
      },
      packageId: pkgId,
    });
    setInvoiceNote(`Invoice ${result.invoiceNumber} downloaded (${formatGhsAmount(result.amount)}).`);
  };

  const handleCreate = async () => {
    setError('');
    setInvoiceNote('');
    if (!isValidGhanaPhone(supportNumber)) {
      setError('Enter a valid Ghana support phone (e.g. 024XXXXXXX).');
      return;
    }
    if (ownerPhone && !isValidGhanaPhone(ownerPhone)) {
      setError('Enter a valid Ghana owner phone or leave it blank.');
      return;
    }
    setBusy(true);
    const result = await createAdminStore({
      storeName,
      address,
      supportNumber,
      ownerName,
      ownerPhone: ownerPhone || supportNumber,
      ownerPin,
    });
    setBusy(false);
    if (!result.success || !result.created) {
      setError(result.error || 'Could not create store');
      return;
    }
    setCreated(result.created);
    const billedPackageId = packageId;
    setCreatedPackageId(billedPackageId);
    resetForm();
    try {
      issueInvoice(result.created, billedPackageId);
    } catch (err: unknown) {
      setInvoiceNote(err instanceof Error ? err.message : 'Store created, but the invoice PDF could not be saved.');
    }
    await onCreated();
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError('');
        }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left touch-target"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shrink-0">
            <Plus className="w-4 h-4" />
          </span>
          <span>
            <p className="text-sm font-bold text-slate-900">Create a store</p>
            <p className="text-[11px] text-slate-500">Owner opens it with Store ID + PIN. Invoice PDF downloads on create.</p>
          </span>
        </span>
        <Store className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          {created && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
              <p className="text-sm font-bold text-emerald-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                {created.storeName} created
              </p>
              <p className="text-[11px] text-emerald-800">
                Share this Store ID so the owner can open it on their phone. They sign in with the PIN you set.
              </p>
              <CopyableStoreId storeId={created.storeId} />
              {invoiceNote && <p className="text-[11px] text-emerald-900">{invoiceNote}</p>}
              <p className="text-[11px] text-emerald-800">
                If the PDF did not download automatically (common on iPhone), tap the button below.
              </p>
              <button
                type="button"
                onClick={() => issueInvoice(created, createdPackageId)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-white border border-emerald-200 px-3 py-2.5 text-xs font-semibold text-emerald-900 touch-target"
              >
                <FileText className="w-4 h-4" />
                Download invoice PDF
              </button>
            </div>
          )}

          <input
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="Store name"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
          />
          <input
            type="tel"
            value={supportNumber}
            onChange={(e) => setSupportNumber(e.target.value)}
            placeholder="Support phone (024…)"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Owner name"
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
            />
            <input
              type="tel"
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              placeholder="Owner phone (optional)"
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
            />
          </div>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={ownerPin}
            onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ''))}
            placeholder="Owner 4-digit PIN"
            className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base tracking-[0.4em] text-center"
          />
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Invoice package</span>
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-base bg-white"
            >
              {SUBSCRIPTION_PACKAGES.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.label} · {formatGhsAmount(pkg.baseGhs)}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              A PDF invoice for {selectedPkg.label} is generated as soon as the store is created.
            </p>
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-white py-3 text-sm font-semibold touch-target disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create store &amp; invoice
          </button>
        </div>
      )}
    </div>
  );
}
