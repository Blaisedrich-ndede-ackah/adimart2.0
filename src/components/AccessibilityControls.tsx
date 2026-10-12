import { useEffect, useRef, useState } from 'react';
import { Accessibility, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useAccessibilityStore } from '@/lib/accessibility';

export default function AccessibilityControls({
  variant,
}: {
  variant: 'sidebar' | 'menu';
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fontSize = useAccessibilityStore((state) => state.fontSize);
  const highContrast = useAccessibilityStore((state) => state.highContrast);
  const leftHanded = useAccessibilityStore((state) => state.leftHanded);
  const setFontSize = useAccessibilityStore((state) => state.setFontSize);
  const setHighContrast = useAccessibilityStore((state) => state.setHighContrast);
  const setLeftHanded = useAccessibilityStore((state) => state.setLeftHanded);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('accessibility.open')}
        className={
          variant === 'sidebar'
            ? 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-emerald-50 hover:bg-white/10 touch-target'
            : 'flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 touch-target'
        }
      >
        <Accessibility className="h-5 w-5" aria-hidden="true" />
        {t('accessibility.title')}
      </button>

      <dialog
        ref={dialogRef}
        className="accessibility-dialog w-[min(92vw,28rem)] rounded-2xl bg-white p-0 text-left text-slate-900 shadow-2xl"
        aria-labelledby="accessibility-dialog-title"
        aria-describedby="accessibility-dialog-description"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <h2 id="accessibility-dialog-title" className="text-lg font-bold">
              {t('accessibility.title')}
            </h2>
            <p id="accessibility-dialog-description" className="mt-1 text-sm text-slate-600">
              {t('accessibility.description')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-800 touch-target"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="accessibility-font-size" className="mb-1 block text-sm font-semibold">
              {t('accessibility.textSize')}
            </label>
            <select
              id="accessibility-font-size"
              value={fontSize}
              onChange={(event) => setFontSize(event.target.value as typeof fontSize)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="normal">{t('accessibility.textNormal')}</option>
              <option value="large">{t('accessibility.textLarge')}</option>
              <option value="larger">{t('accessibility.textLarger')}</option>
            </select>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={highContrast}
            onClick={() => setHighContrast(!highContrast)}
            className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 p-3 text-left touch-target"
          >
            <span>
              <span className="block text-sm font-semibold">{t('accessibility.highContrast')}</span>
              <span className="mt-0.5 block text-xs text-slate-600">{t('accessibility.highContrastHint')}</span>
            </span>
            <span aria-hidden="true" className="shrink-0 font-bold">
              {highContrast ? t('common.yes') : t('common.no')}
            </span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={leftHanded}
            onClick={() => setLeftHanded(!leftHanded)}
            className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 p-3 text-left touch-target"
          >
            <span>
              <span className="block text-sm font-semibold">{t('accessibility.leftHanded')}</span>
              <span className="mt-0.5 block text-xs text-slate-600">{t('accessibility.leftHandedHint')}</span>
            </span>
            <span aria-hidden="true" className="shrink-0 font-bold">
              {leftHanded ? t('common.yes') : t('common.no')}
            </span>
          </button>
        </div>
      </dialog>
    </>
  );
}
