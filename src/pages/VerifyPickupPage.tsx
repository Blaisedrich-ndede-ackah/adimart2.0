import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import BarcodeScanner from '@/components/BarcodeScanner';
import { db } from '@/lib/dexie';
import {
  getTodayPickupVerifications,
  parsePickupTokenCode,
  recordPickupOverride,
  redeemPickupToken,
  syncPickupTokens,
  validatePickupToken,
  type PickupTokenValidation,
} from '@/lib/pickupTokens';
import { useAuthStore } from '@/store/useAuthStore';
import { useT } from '@/lib/i18n';

export default function VerifyPickupPage() {
  const t = useT();
  const { currentStore, currentUser, verifyOwnerPin } = useAuthStore();
  const [manualCode, setManualCode] = useState('');
  const [validation, setValidation] = useState<PickupTokenValidation | null>(null);
  const [released, setReleased] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [auditRows, setAuditRows] = useState<Awaited<ReturnType<typeof getTodayPickupVerifications>>>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideCode, setOverrideCode] = useState('');
  const [overridePin, setOverridePin] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const refreshAudit = useCallback(async () => {
    if (!currentStore?.id) return;
    setAuditRows((await getTodayPickupVerifications(currentStore.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }, [currentStore?.id]);

  useEffect(() => {
    if (!currentStore?.id) return;
    void syncPickupTokens(currentStore.id).catch(() => undefined).finally(() => void refreshAudit());
    const syncOnline = () => { void syncPickupTokens(currentStore.id).then(refreshAudit).catch(() => undefined); };
    window.addEventListener('online', syncOnline);
    const interval = window.setInterval(syncOnline, 60_000);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.clearInterval(interval);
    };
  }, [currentStore?.id, refreshAudit]);

  const checkCode = useCallback(async (raw: string) => {
    if (!currentStore?.id || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    setReleased(false);
    const normalized = parsePickupTokenCode(raw, currentStore.id);
    setManualCode(normalized);
    try {
      const result = await validatePickupToken(currentStore.id, raw);
      setValidation(result);
      if (!result.valid) {
        setError(t(result.reason === 'expired'
          ? 'pickup.expired'
          : result.reason === 'alreadyRedeemed'
            ? 'pickup.alreadyRedeemed'
            : 'pickup.invalid'));
      }
    } catch (reason: unknown) {
      setValidation({ valid: false, reason: 'invalid' });
      setError(reason instanceof Error ? reason.message : t('pickup.invalid'));
    } finally {
      setBusy(false);
    }
  }, [busy, currentStore?.id, t]);

  const submitManualCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void checkCode(manualCode);
  };

  const releaseGoods = async () => {
    const token = validation?.token;
    if (!token || !validation.valid || !currentUser) return;
    setBusy(true);
    setError('');
    try {
      // Refresh the local cache before releasing so a token redeemed on another
      // checkout device cannot be released a second time while this device is online.
      await syncPickupTokens(currentStore?.id || '');
      const latest = await validatePickupToken(token.store_id, token.token_code);
      setValidation(latest);
      if (!latest.valid || !latest.token) {
        throw new Error(t(latest.reason === 'expired'
          ? 'pickup.expired'
          : latest.reason === 'alreadyRedeemed'
            ? 'pickup.alreadyRedeemed'
            : 'pickup.invalid'));
      }
      await redeemPickupToken(latest.token.id, currentUser.id, currentUser.name);
      setReleased(true);
      setMessage(t('pickup.releaseSuccess'));
      await refreshAudit();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('pickup.invalid'));
      const latest = await validatePickupToken(token.store_id, token.token_code).catch(() => null);
      if (latest) setValidation(latest);
    } finally {
      setBusy(false);
    }
  };

  const submitOverride = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentStore?.id || !overrideReason.trim() || !overridePin.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const pinAccepted = await verifyOwnerPin(overridePin);
      if (!pinAccepted) throw new Error(t('pickup.overrideFailed'));
      const owner = await db.users.where('store_id').equals(currentStore.id)
        .and((user) => user.role === 'owner' && user.is_active === 1).first();
      if (!owner) throw new Error(t('pickup.overrideFailed'));
      await recordPickupOverride(currentStore.id, overrideCode, owner.id, owner.name, overrideReason);
      setMessage(t('pickup.overrideSuccess'));
      setOverrideOpen(false);
      setOverrideCode('');
      setOverridePin('');
      setOverrideReason('');
      await refreshAudit();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('pickup.overrideFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!currentStore || !currentUser || !['owner', 'cashier'].includes(currentUser.role)) {
    return <main className="flex h-full items-center justify-center p-6 text-center text-gray-600">{t('pickup.invalid')}</main>;
  }

  const resultLabel = validation?.valid
    ? `${t('pickup.verified')} — ${t('pickup.paid')}`
    : validation?.reason === 'expired'
      ? t('pickup.expired')
      : validation?.reason === 'alreadyRedeemed'
        ? t('pickup.alreadyRedeemed')
        : validation ? t('pickup.invalid') : '';

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="text-emerald-200 text-xs font-semibold uppercase tracking-wide">{currentStore.name}</p>
        <h1 className="mt-1 text-white text-xl font-bold">{t('pickup.verify')}</h1>
      </header>
      <main className="page-body no-scrollbar space-y-4">
        <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm" aria-labelledby="pickup-scan-title">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="pickup-scan-title" className="font-bold text-gray-900">{t('pickup.scanCode')}</h2>
          </div>
          <BarcodeScanner onScan={(value) => void checkCode(value)} active={!busy && !released} large />
          <form onSubmit={submitManualCode} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="pickup-token-code" className="sr-only">{t('pickup.enterCode')}</label>
            <input id="pickup-token-code" value={manualCode} onChange={(event) => setManualCode(event.target.value.toUpperCase())} autoComplete="off" className="min-h-12 min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-2 font-mono text-lg font-bold tracking-wider" placeholder={t('pickup.enterCode')} />
            <button type="submit" disabled={busy || !manualCode.trim()} className="min-h-12 rounded-xl bg-primary px-5 py-3 font-semibold text-white touch-target disabled:opacity-50">{busy ? t('common.loading') : t('pickup.verify')}</button>
          </form>
        </section>

        {validation && (
          <section className={`rounded-2xl border p-5 shadow-sm ${validation.valid ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`} aria-live="assertive" role="status">
            <div className="flex items-center gap-3">
              {validation.valid ? <CheckCircle2 className="h-8 w-8 text-emerald-700" aria-hidden="true" /> : <CircleAlert className="h-8 w-8 text-red-700" aria-hidden="true" />}
              <h2 className={`text-xl font-extrabold ${validation.valid ? 'text-emerald-900' : 'text-red-900'}`}>{released ? t('pickup.fulfilled') : resultLabel}</h2>
            </div>
            {validation.token && <p className="mt-3 font-mono text-lg font-bold text-gray-900">{validation.token.order_number}</p>}
            {error && <p className="mt-3 text-sm font-medium text-red-800">{error}</p>}
            {message && <p className="mt-3 text-sm font-semibold text-emerald-800">{message}</p>}
            {validation.valid && !released && (
              <button type="button" onClick={() => void releaseGoods()} disabled={busy} className="mt-5 min-h-14 w-full rounded-xl bg-emerald-700 px-5 py-4 text-lg font-bold text-white touch-target disabled:opacity-50">{t('pickup.releaseGoods')}</button>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-labelledby="pickup-override-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="pickup-override-title" className="font-bold text-gray-900">{t('pickup.override')}</h2>
              <p className="mt-1 text-xs text-gray-500">{t('pickup.ownerPinHint')}</p>
            </div>
            <button type="button" onClick={() => setOverrideOpen((open) => !open)} className="min-h-11 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 touch-target">{overrideOpen ? t('common.cancel') : t('pickup.override')}</button>
          </div>
          {overrideOpen && (
            <form onSubmit={submitOverride} className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-gray-700">{t('pickup.enterCode')}
                <input value={overrideCode} onChange={(event) => setOverrideCode(event.target.value.toUpperCase())} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono" />
              </label>
              <label className="block text-sm font-medium text-gray-700">{t('pickup.ownerPin')}
                <input value={overridePin} onChange={(event) => setOverridePin(event.target.value)} type="password" inputMode="numeric" maxLength={4} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2" />
              </label>
              <label className="block text-sm font-medium text-gray-700">{t('pickup.overrideReason')}
                <input value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} required minLength={3} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2" />
              </label>
              <button type="submit" disabled={busy || !overridePin || !overrideReason.trim()} className="min-h-12 w-full rounded-xl bg-amber-800 px-4 py-3 font-bold text-white touch-target disabled:opacity-50">{t('pickup.override')}</button>
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" aria-labelledby="pickup-audit-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="pickup-audit-title" className="font-bold text-gray-900">{t('pickup.auditLog')}</h2>
            <button type="button" onClick={() => void refreshAudit()} className="min-h-10 rounded-lg border px-3 py-2 text-sm font-semibold touch-target">{t('common.refresh')}</button>
          </div>
          {auditRows.length === 0 ? <p className="mt-3 text-sm text-gray-500">{t('pickup.noVerifications')}</p> : (
            <ul className="mt-3 divide-y divide-gray-100">
              {auditRows.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{entry.event_type === 'override' ? t('pickup.override') : t('pickup.releaseGoods')}</p>
                    <p className="mt-1 truncate font-mono text-xs text-gray-600">{entry.order_number || entry.scanned_code || t('pickup.invalid')}</p>
                    <p className="mt-1 text-xs text-gray-500">{t('pickup.verifiedBy', { name: entry.verified_by_name })}</p>
                  </div>
                  <time className="shrink-0 text-xs text-gray-500" dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleTimeString()}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
        {message && !validation && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
      </main>
    </div>
  );
}
