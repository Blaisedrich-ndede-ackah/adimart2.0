const CACHE_NAME = 'adimat-v13';
const CAMPAIGN_MEDIA_CACHE = 'adimat-campaign-media-v1';
const OFFLINE_URL = '/';

const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/apple-touch-icon.png',
  '/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== CAMPAIGN_MEDIA_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  const isNavigate = event.request.mode === 'navigate';

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Never cache HTML documents — Opera/Chrome must not keep different app versions.
        if (response.status === 200 && !isNavigate) {
          const responseToCache = response.clone();
          const length = Number(response.headers.get('content-length') || 0);
          if (!length || length < 2_000_000) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache)).catch(() => {
              // iOS Safari limits the service worker cache. A failed write must not break the page.
            });
          }
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (isNavigate) {
            return caches.match(OFFLINE_URL);
          }
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'adimat-sync') return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'adimat-background-sync' }));
    })
  );
});
