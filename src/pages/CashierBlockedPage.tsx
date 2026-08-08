import { Ban, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

/**
 * Shown after a blocked cashier successfully authenticates.
 * They cannot use POS until the store owner unblocks them.
 */
export default function CashierBlockedPage() {
  const { currentUser, switchUser } = useAuthStore();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-800 to-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/20 flex items-center justify-center mx-auto mb-5">
          <Ban className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Account blocked</h1>
        <p className="text-slate-300 text-sm leading-relaxed mb-1">
          {currentUser?.name ? `Hi ${currentUser.name}. ` : ''}
          Your cashier account has been blocked.
        </p>
        <p className="text-slate-400 text-sm leading-relaxed mb-8">
          Please contact the store owner to restore your access.
        </p>
        <button
          type="button"
          onClick={switchUser}
          className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white text-slate-900 font-semibold touch-target"
        >
          <LogOut className="w-4 h-4" />
          Back to login
        </button>
      </div>
    </div>
  );
}
