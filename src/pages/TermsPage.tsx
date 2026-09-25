import { ArrowLeft, FileText } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="h-full overflow-y-auto bg-emerald-50/60">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
        <a href="#/" className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to Adimat
        </a>
        <article className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-emerald-100 md:p-10">
          <div className="flex items-center gap-3 text-primary">
            <FileText className="h-7 w-7" />
            <p className="text-xs font-bold uppercase tracking-[0.16em]">Adimat</p>
          </div>
          <h1 className="mt-4 text-3xl font-bold text-gray-900">Terms & conditions</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 25, 2026</p>
          <div className="mt-8 space-y-6 text-sm leading-7 text-gray-700">
            <section>
              <h2 className="text-base font-bold text-gray-900">Using Adimat</h2>
              <p className="mt-2">Adimat provides point-of-sale, inventory, and online ordering tools. Store owners are responsible for the accuracy of their store information, prices, product availability, and customer communications.</p>
            </section>
            <section>
              <h2 className="text-base font-bold text-gray-900">Online orders</h2>
              <p className="mt-2">An order submitted through a storefront is a request for fulfilment. The store owner confirms availability, delivery details, payment arrangements, and any applicable charges directly with the customer.</p>
            </section>
            <section>
              <h2 className="text-base font-bold text-gray-900">Store content and links</h2>
              <p className="mt-2">Store owners may publish logos, descriptions, product information, and external links. They must have the right to publish that content and must keep links accurate and safe for customers.</p>
            </section>
            <section>
              <h2 className="text-base font-bold text-gray-900">Availability</h2>
              <p className="mt-2">We work to keep Adimat available and accurate, but online access may occasionally be interrupted for maintenance, connectivity, or circumstances outside our control.</p>
            </section>
            <section>
              <h2 className="text-base font-bold text-gray-900">Contact</h2>
              <p className="mt-2">Questions about an order should be directed to the store shown on that storefront. Questions about Adimat can be raised through the account administrator.</p>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
