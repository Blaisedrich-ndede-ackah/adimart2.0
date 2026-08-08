/**
 * Captures barcode data from connected handheld scanners.
 *
 * Supports:
 *  1. HID keyboard-wedge scanners (Bluetooth Classic / USB) — rapid keystrokes ending with Enter
 *  2. BLE GATT scanners subscribed via bluetoothPeripherals.subscribeBleScanner
 */

import { loadBluetoothPrefs, subscribeBleScanner } from './bluetoothPeripherals';

export type BarcodeScanHandler = (barcode: string) => void;

const HID_INTER_KEY_MS = 80;
const HID_MIN_LENGTH = 3;
const DEDUPE_MS = 600;

let hidStarted = false;
let hidBuffer = '';
let lastKeyAt = 0;
let rapidKeyCount = 0;
let lastEmitted = { code: '', at: 0 };

const handlers = new Set<BarcodeScanHandler>();
let bleUnsubscribe: (() => void) | null = null;

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-block-scanner="true"]')) return true;

  if (target instanceof HTMLInputElement) {
    if (target.dataset.barcodeInput === 'true') return false;
    const type = (target.type || '').toLowerCase();
    if (type === 'password') return true;
    // PIN-style numeric fields (max 4–6 digits)
    if (
      (type === 'tel' || type === 'number' || target.inputMode === 'numeric') &&
      target.maxLength > 0 &&
      target.maxLength <= 6
    ) {
      return true;
    }
  }
  return false;
}

function emitScan(barcode: string): void {
  const cleaned = barcode.replace(/[\r\n\t]+/g, '').trim();
  if (cleaned.length < HID_MIN_LENGTH) return;

  const now = Date.now();
  if (cleaned === lastEmitted.code && now - lastEmitted.at < DEDUPE_MS) return;
  lastEmitted = { code: cleaned, at: now };

  handlers.forEach((handler) => {
    try {
      handler(cleaned);
    } catch {
      // ignore handler errors
    }
  });
}

function onKeyDown(event: KeyboardEvent): void {
  const prefs = loadBluetoothPrefs();
  if (!prefs.hidScannerEnabled) return;
  if (handlers.size === 0) return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (shouldIgnoreTarget(event.target)) return;

  const now = Date.now();
  const gap = now - lastKeyAt;
  lastKeyAt = now;

  if (gap > HID_INTER_KEY_MS * 2.5) {
    hidBuffer = '';
    rapidKeyCount = 0;
  }

  if (event.key === 'Enter') {
    if (hidBuffer.length >= HID_MIN_LENGTH && rapidKeyCount >= HID_MIN_LENGTH - 1) {
      event.preventDefault();
      event.stopPropagation();
      const code = hidBuffer;
      hidBuffer = '';
      rapidKeyCount = 0;
      emitScan(code);
    } else {
      hidBuffer = '';
      rapidKeyCount = 0;
    }
    return;
  }

  if (event.key === 'Escape' || event.key === 'Tab') {
    hidBuffer = '';
    rapidKeyCount = 0;
    return;
  }

  if (event.key.length === 1) {
    hidBuffer += event.key;
    if (gap > 0 && gap <= HID_INTER_KEY_MS) {
      rapidKeyCount += 1;
    }
    // Suppress scanner keystrokes from leaking into focused search fields
    if (
      rapidKeyCount >= 2 &&
      hidBuffer.length >= HID_MIN_LENGTH &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset.barcodeInput !== 'true' &&
      document.activeElement.dataset.allowTyping !== 'true'
    ) {
      event.preventDefault();
    }
  }
}

function ensureHidListener(): void {
  if (hidStarted || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown, true);
  hidStarted = true;
}

function ensureBleBridge(): void {
  if (bleUnsubscribe) return;
  bleUnsubscribe = subscribeBleScanner((barcode) => emitScan(barcode));
}

/**
 * Subscribe to barcode scans from HID wedge and/or BLE scanners.
 * Returns an unsubscribe function.
 */
export function subscribeBarcodeScans(handler: BarcodeScanHandler): () => void {
  ensureHidListener();
  ensureBleBridge();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function isHidScannerEnabled(): boolean {
  return loadBluetoothPrefs().hidScannerEnabled;
}
