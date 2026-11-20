import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Apply the saved theme before React paints to avoid a light-mode flash.
const savedTheme = window.localStorage.getItem('adimat-theme');
if (savedTheme !== 'light') {
  document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = 'dark';
}

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
    <Suspense
      fallback={
        <div className="h-full min-h-screen bg-primary flex items-center justify-center">
          <p className="text-white font-medium tracking-wide" role="status">Loading Adimat…</p>
        </div>
      }
    >
      <App />
    </Suspense>
  </StrictMode>
);
