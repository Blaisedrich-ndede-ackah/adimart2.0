export function supportsBackdropFilter(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
}

export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
}

export function webShareAvailable(data?: ShareData): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    if (data && typeof navigator.canShare === 'function') return navigator.canShare(data);
  } catch {
    return false;
  }
  return true;
}

export function webBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator && !!navigator.bluetooth;
}

export function biometricAvailableSync(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

export function backgroundSyncAvailable(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window;
}

/** Safari private mode often rejects IndexedDB writes. Returns true when storage cannot be used. */
export function detectPrivateIndexedDb(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (blocked: boolean) => {
      if (settled) return;
      settled = true;
      resolve(blocked);
    };
    try {
      const request = indexedDB.open('adimat-idb-probe');
      request.onerror = () => finish(true);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('probe')) db.createObjectStore('probe');
      };
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('probe', 'readwrite');
          tx.objectStore('probe').put('ok', 'probe');
          tx.oncomplete = () => {
            db.close();
            finish(false);
          };
          tx.onerror = () => {
            db.close();
            finish(true);
          };
          tx.onabort = () => {
            db.close();
            finish(true);
          };
        } catch {
          db.close();
          finish(true);
        }
      };
    } catch {
      finish(true);
    }
  });
}
