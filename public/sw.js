const CACHE_NAME = 'adimat-v13';
const CAMPAIGN_MEDIA_CACHE = 'adimat-campaign-media-v1';
const OFFLINE_URL = '/';
const PRECACHE_MANIFEST_URL = '/precache-manifest.json';

const PRECACHE_ASSETS = [
  '/',
  PRECACHE_MANIFEST_URL,
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/apple-touch-icon.png',
  '/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_ASSETS);
      const manifestResponse = await cache.match(PRECACHE_MANIFEST_URL);
      const assets = await manifestResponse.json();
      if (!Array.isArray(assets) || !assets.every((asset) => typeof asset === 'string')) {
        throw new Error('The offline asset manifest is invalid.');
      }
      for (let index = 0; index < assets.length; index += 20) {
        await cache.addAll(assets.slice(index, index + 20));
      }
    })()
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
  const requestUrl = new URL(event.request.url);

  if (requestUrl.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        try {
          const response = await fetch(event.request);
          if (response.status === 200) await cache.put(event.request, response.clone());
          return response;
        } catch {
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        }
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Never cache HTML documents — Opera/Chrome must not keep different app versions.
        if (response.status === 200 && !isNavigate) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
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
