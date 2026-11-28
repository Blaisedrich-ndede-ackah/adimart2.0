import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { getWhatsAppSupportUrl } from '@/lib/support';

interface WhatsAppSupportButtonProps {
  storeName?: string | null;
  isPos?: boolean;
}

export default function WhatsAppSupportButton({ storeName, isPos = false }: WhatsAppSupportButtonProps) {
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [offlineNote, setOfflineNote] = useState(false);
  const [posPlacement, setPosPlacement] = useState<{ right: number; bottom: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const modalOpen = Boolean(document.querySelector(
          '.sheet-backdrop, [role="dialog"], [aria-modal="true"], .fixed.inset-0'
        ));
        let controlOverlap = false;
        const anchorRect = anchorRef.current?.getBoundingClientRect();
        if (anchorRect && anchorRect.width > 0) {
          const controls = document.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [role="button"], [role="status"], [role="alert"], [aria-live], .pointer-events-auto'
          );
          controlOverlap = Array.from(controls).some((control) => {
            if (anchorRef.current?.contains(control) || control === anchorRef.current) return false;
            const rect = control.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            const style = window.getComputedStyle(control);
            if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
            return anchorRect.left < rect.right && anchorRect.right > rect.left &&
              anchorRect.top < rect.bottom && anchorRect.bottom > rect.top;
          });
        }
        const nextBlocked = modalOpen || controlOverlap;
        setBlocked((previous) => previous === nextBlocked ? previous : nextBlocked);

        const products = document.querySelector<HTMLElement>('[data-pos-pane="products"]');
        const cart = document.querySelector<HTMLElement>('[data-pos-pane="cart"]');
        if (isPos && products && cart && window.innerWidth >= 1024) {
          const rect = products.getBoundingClientRect();
          const nextPlacement = {
            right: Math.max(12, window.innerWidth - rect.right + 12),
            bottom: Math.max(12, window.innerHeight - rect.bottom + 12),
          };
          setPosPlacement((previous) => previous !== null && previous.right === nextPlacement.right && previous.bottom === nextPlacement.bottom
            ? previous
            : nextPlacement);
        } else {
          setPosPlacement((previous) => previous === null ? previous : null);
        }
      });
    };

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
    const observePanes = () => {
      document.querySelectorAll('[data-pos-pane]').forEach((pane) => resizeObserver?.observe(pane));
    };
    const observer = new MutationObserver(() => {
      observePanes();
      refresh();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'aria-modal'] });
    observePanes();
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    refresh();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [isPos]);

  useEffect(() => {
    if (!offlineNote) return;
    const timeout = window.setTimeout(() => setOfflineNote(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [offlineNote]);

  const dismissOfflineNote = () => setOfflineNote(false);

  return (
    <div className={`whatsapp-support ${isPos ? 'is-pos' : ''} ${blocked ? 'is-obstructed' : ''}`} style={posPlacement || undefined}>
      {offlineNote && (
        <div className="whatsapp-support-note" role="status" aria-live="polite">
          <span>WhatsApp support needs an internet connection.</span>
          <button type="button" onClick={dismissOfflineNote} aria-label="Dismiss offline message">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <a
        ref={anchorRef}
        href={getWhatsAppSupportUrl(storeName)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        title="Chat with us on WhatsApp"
        className="whatsapp-support-link"
        onClick={(event) => {
          if (navigator.onLine) return;
          event.preventDefault();
          setOfflineNote(true);
        }}
      >
        <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>Chat with us</span>
      </a>
    </div>
  );
}
