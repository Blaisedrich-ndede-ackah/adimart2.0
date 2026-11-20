import { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";

function LoadingFallback() {
  const [isTakingLong, setIsTakingLong] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setIsTakingLong(true), 12_000);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-primary px-5 py-10 text-white">
      <section className="text-center">
        <p className="font-medium tracking-wide" role="status">Loading Adimat…</p>
        {isTakingLong && (
          <div className="mt-4">
            <p className="text-sm">The app is taking longer than expected. Check your connection and reload.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl bg-white px-5 py-3 font-semibold text-primary touch-target"
            >
              Reload app
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

// Apply the saved theme before React paints to avoid a light-mode flash.
let savedTheme: string | null = null;
try {
  savedTheme = window.localStorage.getItem('adimat-theme');
} catch {
  // Storage can be unavailable in private or restricted browser contexts.
}
if (savedTheme !== 'light') {
  document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = 'dark';
}

const PRELOAD_RETRY_KEY = 'adimat-vite-preload-retry';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  let alreadyRetried = false;
  try {
    alreadyRetried = window.sessionStorage.getItem(PRELOAD_RETRY_KEY) === '1';
    window.sessionStorage.setItem(PRELOAD_RETRY_KEY, '1');
  } catch {
    // Continue with the in-app error boundary if session storage is unavailable.
  }
  if (!alreadyRetried) window.location.reload();
});
window.addEventListener('load', () => {
  try {
    window.sessionStorage.removeItem(PRELOAD_RETRY_KEY);
  } catch {
    // Ignore unavailable session storage.
  }
}, { once: true });

// Register Service Worker for PWA
if (
  'serviceWorker' in navigator &&
  (window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage('skipWaiting');
                window.location.reload();
              }
            });
          }
        });
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

function isFormField(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : document.activeElement;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

document.addEventListener('gesturestart', (event) => event.preventDefault());
document.addEventListener('gesturechange', (event) => event.preventDefault());
document.addEventListener('touchmove', (event) => {
  if (event.touches.length > 1) event.preventDefault();
}, { passive: false });
document.addEventListener('wheel', (event) => {
  if (event.ctrlKey) event.preventDefault();
}, { passive: false });
document.addEventListener('keydown', (event) => {
  const command = event.ctrlKey || event.metaKey;
  const zoomKey = event.key === '+' || event.key === '-' || event.key === '=' || event.key === '0';
  if (command && zoomKey) event.preventDefault();
  const copyKey = event.key === 'c' || event.key === 'C' || event.key === 'x' || event.key === 'X';
  if (command && copyKey && !isFormField(document.activeElement)) event.preventDefault();
});
document.addEventListener('copy', (event) => {
  if (!isFormField(event.target)) event.preventDefault();
});
document.addEventListener('cut', (event) => {
  if (!isFormField(event.target)) event.preventDefault();
});
document.addEventListener('contextmenu', (event) => {
  if (!isFormField(event.target)) event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </StrictMode>
);
