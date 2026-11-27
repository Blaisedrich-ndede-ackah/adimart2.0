const CACHE_NAME = 'adimat-v15';
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

  if (/^\/(logo\.png|icon-[^/]+\.png|apple-touch-icon\.png|manifest\.json)$/.test(requestUrl.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
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

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || '' }; }
  const title = typeof payload.title === 'string' ? payload.title : 'Adimat notification';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: typeof payload.type === 'string' ? `adimat-${payload.type}` : 'adimat-notification',
    data: { ...(payload.data && typeof payload.data === 'object' ? payload.data : {}) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const type = event.notification.data?.event || event.notification.data?.type;
  const page = type === 'stock.low' || type === 'low_stock'
    ? 'inventory'
    : type === 'order.online' || type === 'online_order'
      ? 'ecommerce'
      : type === 'sync_failed'
        ? 'devices'
        : type === 'customer.created' || type === 'customer_created' || type === 'debt_reminder_due'
          ? 'customers'
          : event.notification.data?.purpose === 'topup'
            ? 'notifications'
            : 'ecommerce';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const matching = clients.find((client) => client.url.startsWith(self.location.origin));
    if (matching) { matching.postMessage({ type: 'OPEN_NOTIFICATIONS', page }); return matching.focus(); }
    return self.clients.openWindow(`/?open-notifications=1&open-page=${encodeURIComponent(page)}`);
  })());
});
