import { ArrowRight, BookOpen, Download, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { canAccessCashbook } from '@/lib/staffAccess';

interface LearnAdimatPageProps {
  onNavigate: (page: string) => void;
}

interface LessonCardProps {
  title: string;
  steps: string[];
  action?: string;
  onAction?: () => void;
}

function LessonCard({ title, steps, action, onAction }: LessonCardProps) {
  return (
    <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      {action && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-primary touch-target"
        >
          {action}<ArrowRight className="h-4 w-4" />
        </button>
      )}
    </section>
  );
}

function ScreenIllustration({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
      <img src={src} alt={alt} className="mx-auto block h-auto w-full max-w-[420px] rounded-xl" />
      <figcaption className="mt-2 text-center text-xs leading-5 text-slate-500">{caption}</figcaption>
    </figure>
  );
}

export default function LearnAdimatPage({ onNavigate }: LearnAdimatPageProps) {
  const { currentUser, currentStore } = useAuthStore();
  if (!currentUser) return null;

  const isOwner = currentUser?.role === 'owner';
  const canUseCashBook = canAccessCashbook(currentUser);
  const canManageOnline =
    currentStore?.ecommerce_enabled === 1 &&
    (isOwner || (currentUser?.can_manage_ecommerce ?? 0) === 1);

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="text-emerald-200 text-xs font-semibold uppercase tracking-wide">
          {isOwner ? 'Store owner learning' : 'Cashier learning'}
        </p>
        <h1 className="mt-1 text-white text-xl font-bold">Learn Adimat</h1>
        <p className="mt-1 text-emerald-100 text-xs">
          Lessons for {isOwner ? 'store owners' : 'cashiers'} · {currentStore?.name || 'Your store'}
        </p>
      </header>

      <div className="page-body space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>
            {isOwner
              ? 'This learning area is for the store owner. It covers your dashboard, products, stock, expenses, reports, staff, and store settings.'
              : 'This learning area is for cashiers. It covers your till, sales, receipts, and only the optional tools your owner has enabled for you.'}
          </p>
        </div>

        {isOwner ? (
          <>
            <ScreenIllustration
              src="/learn/owner-dashboard.svg"
              alt="Illustration of the Adimat owner dashboard showing sales totals, stock alerts, and quick actions"
              caption="Owner Home — sample screen illustration; figures shown are examples."
            />
            <LessonCard
              title="1. Read your owner dashboard"
              steps={[
                'Today’s sales is the total of completed sales recorded today on this device.',
                'Cash received and MoMo / Paystack separate the payment totals.',
                'Tap Low-stock products to open Inventory, then use the quick actions to start a sale, add a product, or record an expense.',
              ]}
              action="Open Home"
              onAction={() => onNavigate('home')}
            />
            <LessonCard
              title="2. Maintain products and stock"
              steps={[
                'Open Inventory to add products, prices, barcodes, photos, and stock.',
                'Set a Restock alert quantity on products you want included in reorder suggestions.',
                'Use Restock & audit to review stock changes. Use Purchasing to save suppliers, create orders, and receive full or partial deliveries.',
                'If Warehouse is enabled, select the correct shop or warehouse before receiving or transferring stock.',
              ]}
              action="Open Inventory"
              onAction={() => onNavigate('inventory')}
            />
            <LessonCard
              title="3. Control store spending and performance"
              steps={[
                'Record costs in Expenses; add a receipt photo when available.',
                'Set monthly category budgets and recurring monthly expenses to track planned costs.',
                'Use Reports to review sales, payment methods, product performance, expenses, and estimated profit. Export reports when needed.',
              ]}
              action="Open Reports"
              onAction={() => onNavigate('reports')}
            />
            <LessonCard
              title="4. Manage people, security, and backups"
              steps={[
                'In Settings → Staff, give each cashier a separate PIN and choose their permitted actions.',
                'Set the idle timeout and discount approval rules to match your till procedures.',
                'Use Backup & sync health to check pending changes, sync status, and download a backup. Store the backup securely away from this device.',
                'Use Plan for subscription status and Settings → Mobile Money Payout for the payout account.',
              ]}
              action="Open Settings"
              onAction={() => onNavigate('settings')}
            />
            {canManageOnline && (
              <LessonCard
                title="5. Manage your online orders"
                steps={[
                  'Open Online to copy your public shop link and check the order inbox.',
                  'Only list products you want customers to browse online.',
                  'Review pay-on-delivery orders and update their fulfilment status as you process them.',
                ]}
                action="Open Online"
                onAction={() => onNavigate('ecommerce')}
              />
            )}
          </>
        ) : (
          <>
            <ScreenIllustration
              src="/learn/cashier-pos.svg"
              alt="Illustration of the Adimat cashier POS showing product search, products, and a cart total"
              caption="Cashier POS — sample screen illustration; products and totals are examples."
            />
            <LessonCard
              title="1. Find products and build a cart"
              steps={[
                'Open POS and search by product name or barcode. You can scan with the camera or a paired handheld scanner.',
                'Tap a product to add it. Check the cart quantity and total before checkout.',
                'Adimat checks available stock. If an item cannot be sold, ask the owner to review its stock.',
              ]}
              action="Open POS"
              onAction={() => onNavigate('pos')}
            />
            <LessonCard
              title="2. Take payment and give the receipt"
              steps={[
                'At checkout choose Cash, Paystack, Split, or record an offline MTN/Telecel/AirtelTigo MoMo, bank transfer, or card-terminal payment with its reference number.',
                'Paystack needs internet. Do not repeat a payment while it is still processing; check My Sales if you are unsure.',
                'Use Hold sale to suspend a cart while serving another customer. Choose Resume in Held sales to continue later in this POS session.',
                'After success, show or share the PDF receipt, send it via WhatsApp where available, or print it if a printer is connected.',
                'Ask the owner to approve a discount if the till requests the owner PIN.',
              ]}
            />
            <LessonCard
              title="3. Check your sales and end your shift"
              steps={[
                'Open My Sales to find your recorded transactions and receipts.',
                'At shift handover, follow your store’s cash-count procedure and tell the owner about any mismatch.',
                'Use Switch user when you finish so the next staff member signs in with their own PIN.',
                'The till may lock after inactivity. Sign in again to continue; the previous cart is cleared.',
              ]}
              action="Open My Sales"
              onAction={() => onNavigate('transactions')}
            />
            {canUseCashBook && (
              <LessonCard
                title="Your enabled Cash Book access"
                steps={[
                  'Your owner has enabled Cash Book access for your account.',
                  'Open Cash Book to follow your store’s cash recording and handover rules. Record entries accurately.',
                ]}
                action="Open Cash Book"
                onAction={() => onNavigate('cashbook')}
              />
            )}
            {canManageOnline && (
              <LessonCard
                title="Your enabled Online shop access"
                steps={[
                  'Your owner has enabled order management for you.',
                  'Open Online to review new pay-on-delivery orders and update fulfilment as instructed by your store.',
                ]}
                action="Open Online"
                onAction={() => onNavigate('ecommerce')}
              />
            )}
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <p>Never share your PIN or use another staff member’s PIN. Contact your owner if you need access or a PIN reset.</p>
            </div>
          </>
        )}

        <a
          href={isOwner ? '/guides/adimat-store-owner-guide.pdf' : '/guides/adimat-cashier-guide.pdf'}
          download
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white touch-target"
        >
          <Download className="h-4 w-4" />
          Download {isOwner ? 'store owner' : 'cashier'} guide (PDF)
        </a>
      </div>
    </div>
  );
}
