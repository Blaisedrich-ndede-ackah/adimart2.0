import { useCallback, useEffect, useState } from 'react';
import { Ban, Headphones, Loader2, LogOut, Mail, MessageCircle, Phone, RefreshCcw } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { formatSubscriptionDate, getSubscriptionInfo, subscriptionStatusLabel } from '@/lib/subscription';
import {
  loadAdminContactInfo,
  normalizeGhanaPhone,
  type AdminContactInfo,
} from '@/lib/platformSettings';
import { syncFromSupabase } from '@/lib/dexie';
import { isSupabaseConfigured } from '@/lib/supabase';
import SubscriptionPackagesCard from '@/components/SubscriptionPackagesCard';
import CommunityChatButton from '@/components/CommunityChatButton';
import LanguageSwitcher from '@/components/LanguageSwitcher';

/**
 * Shown after login when an administrator has blocked the store for unpaid
 * subscription. Owners can pay a package to restore access.
 */
export default function StoreAccessBlockedPage() {
  const { currentStore, currentUser, refreshStore, switchUser } = useAuthStore();
  const isOwner = currentUser?.role === 'owner';
  const [contact, setContact] = useState<AdminContactInfo>({ whatsapp: '', email: '' });
  const [loadingContact, setLoadingContact] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const info = getSubscriptionInfo(
    currentStore?.subscription_expires_at,
    currentStore?.subscription_started_at
  );

  const loadContact = useCallback(async () => {
    setLoadingContact(true);
    const data = await loadAdminContactInfo();
    setContact(data);
    setLoadingContact(false);
  }, []);

  useEffect(() => {
    void loadContact();
  }, [loadContact]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshStore();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [refreshStore]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (isSupabaseConfigured()) {
        await syncFromSupabase();
      }
      await refreshStore();
      await loadContact();
    } catch {
      // stay on paywall; refreshStore already best-effort
    }
    setRefreshing(false);
  };

  const whatsappDigits = normalizeGhanaPhone(contact.whatsapp);
  const careMessage = encodeURIComponent(
    `Hello Adimat customer care, my store "${currentStore?.name || 'my store'}" is blocked pending subscription payment. ` +
      `Plan status: ${subscriptionStatusLabel(info.status)}` +
      (info.expiresAt ? ` (expires ${formatSubscriptionDate(info.expiresAt)})` : '') +
      `. — ${currentUser?.name || 'Store user'}`
  );

  return (
    <div className="min-h-full min-h-dvh bg-[var(--color-surface)] flex flex-col">
      <header className="bg-primary text-white px-4 py-5 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center mb-3 border border-white/20">
              <Ban className="w-6 h-6 text-amber-200" />
            </div>
            <h1 className="text-xl font-bold">Store access paused</h1>
            <p className="text-emerald-100 text-sm mt-1 leading-relaxed">
              {currentStore?.name || 'This store'} is blocked because the subscription has not been paid.
              Choose a package below to restore access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="p-2.5 rounded-xl bg-white/20 text-white touch-target shrink-0"
            title="Refresh status"
          >
            <RefreshCcw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 md:max-w-3xl md:mx-auto md:w-full pb-8 xl:max-w-none xl:mx-0 xl:grid xl:grid-cols-2 xl:items-start xl:gap-4 xl:space-y-0 xl:px-8 2xl:px-12">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 xl:col-span-2">
          <p className="text-sm font-semibold">Pay a package to continue</p>
          <p className="text-xs mt-1 leading-relaxed">
            An administrator locked this store. After a successful payment the lock is removed
            automatically and you can use the POS again.
          </p>
          <p className="text-xs mt-2">
            Plan: <span className="font-semibold">{subscriptionStatusLabel(info.status)}</span>
            {info.expiresAt ? ` · expires ${formatSubscriptionDate(info.expiresAt)}` : ''}
          </p>
        </div>

        {currentStore && (
          <SubscriptionPackagesCard
            store={currentStore}
            isOwner={isOwner}
            ownerPhone={currentUser?.phone || currentStore.support_number || ''}
            title="Pay to restore access"
            onActivated={async () => {
              if (isSupabaseConfigured()) await syncFromSupabase();
              await refreshStore();
            }}
          />
        )}

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 xl:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <Headphones className="w-5 h-5 text-slate-700" />
            <h2 className="font-bold text-gray-900">Customer care</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Need help with payment? Contact Adimat support.
          </p>

          {loadingContact ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading contact details…
            </div>
          ) : !whatsappDigits && !contact.email ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs mb-2">
              Customer care contacts are not set yet.
            </div>
          ) : (
            <div className="space-y-2 mb-2 xl:grid xl:grid-cols-3 xl:gap-3 xl:space-y-0">
              {whatsappDigits && (
                <a
                  href={`https://wa.me/${whatsappDigits}?text=${careMessage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 touch-target"
                >
                  <MessageCircle className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold">WhatsApp support</p>
                    <p className="text-xs opacity-80 truncate">+{whatsappDigits}</p>
                  </div>
                </a>
              )}
              {contact.whatsapp && (
                <a
                  href={`tel:${contact.whatsapp}`}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 touch-target"
                >
                  <Phone className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold">Call support</p>
                    <p className="text-xs text-gray-500 truncate">{contact.whatsapp}</p>
                  </div>
                </a>
              )}
              {contact.email && (
                <a
                  href={`mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(
                    `Adimat blocked store — ${currentStore?.name || 'Store'}`
                  )}&body=${careMessage}`}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-900 touch-target"
                >
                  <Mail className="w-5 h-5 flex-shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-semibold">Email support</p>
                    <p className="text-xs opacity-80 truncate">{contact.email}</p>
                  </div>
                </a>
              )}
            </div>
          )}
          <LanguageSwitcher compact />
          <CommunityChatButton variant="care" label="Community chat" />
        </div>

        <button
          type="button"
          onClick={switchUser}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white border border-gray-200 text-slate-800 font-semibold touch-target"
        >
          <LogOut className="w-4 h-4" />
          Back to login
        </button>
      </div>
    </div>
  );
}
