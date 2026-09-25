import { ArrowLeft, Compass } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="h-full flex items-center justify-center bg-emerald-50/60 px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
          <Compass className="h-8 w-8" />
        </div>
        <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-primary">404</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">That address does not point to an Adimat page.</p>
        <a href="#/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white">
          <ArrowLeft className="h-4 w-4" /> Go to Adimat
        </a>
      </div>
    </div>
  );
}
