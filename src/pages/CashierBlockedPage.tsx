import { Ban, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import CommunityChatButton from '@/components/CommunityChatButton';

/**
 * Shown after a blocked cashier successfully authenticates.
 * They cannot use POS until the store owner unblocks them.
 */
export default function CashierBlockedPage() {
  const { currentUser, switchUser } = useAuthStore();

  return (
    <div className="auth-shell">
      <div className="auth-panel text-center animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/20 flex items-center justify-center mx-auto mb-5 border border-amber-400/30">
          <Ban className="w-8 h-8 text-amber-300" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Account blocked</h1>
        <p className="text-emerald-100/90 text-sm leading-relaxed mb-1">
          {currentUser?.name ? `Hi ${currentUser.name}. ` : ''}
          Your cashier account has been blocked.
        </p>
        <p className="text-emerald-200/70 text-sm leading-relaxed mb-8">
          Please contact the store owner to restore your access.
        </p>
        <button
          type="button"
          onClick={switchUser}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white text-primary font-semibold touch-target"
        >
          <LogOut className="w-4 h-4" />
          Back to login
        </button>
        <CommunityChatButton variant="blocked" className="mt-3" />
      </div>
    </div>
  );
}
