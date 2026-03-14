const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `nihongo-flash-${VERSION}`;
const APP_SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'];

const isSuccessfulResponse = (response) => response && response.status === 200 && response.type !== 'opaque';

const cacheResponse = async (request, response) => {
  if (!isSuccessfulResponse(response)) {
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => cacheResponse('./', networkResponse))
        .catch(async () => {
          const cachedResponse = await caches.match(event.request);
          return cachedResponse || caches.match('./');
        }),
    );
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then(async (cachedResponse) => {
        const networkResponsePromise = fetch(event.request)
          .then((networkResponse) => cacheResponse(event.request, networkResponse))
          .catch(() => null);

        if (cachedResponse) {
          networkResponsePromise.catch(() => null);
          return cachedResponse;
        }

        const networkResponse = await networkResponsePromise;
        return networkResponse || caches.match('./');
      }),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => cacheResponse(event.request, networkResponse))
      .catch(() => {
        if (isSameOrigin) {
          return caches.match(event.request);
        }

        return caches.match('./');
      }),
  );
});
