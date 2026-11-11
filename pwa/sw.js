// Offline first: answer from the cache immediately and fetch the newest version in the background
// (stale-while-revalidate). The build fills in the cache version and file list (see vite.config.ts).
const CACHE = 'delaycam-__VERSION__';
const FILES = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('delaycam-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function notifyUpdate() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: 'update-ready' }));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const isPage = request.mode === 'navigate';

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      const oldCopy = cached && cached.clone();

      const update = fetch(request, { cache: 'no-cache' }).then(async (response) => {
        if (response.ok && response.type === 'basic') {
          if (oldCopy && isPage) {
            const [before, after] = await Promise.all([oldCopy.text(), response.clone().text()]);
            if (before !== after) {
              await cache.put(request, response.clone());
              await notifyUpdate();
              return response;
            }
          }
          await cache.put(request, response.clone());
        }
        return response;
      });

      if (cached) {
        event.waitUntil(update.catch(() => {}));
        return cached;
      }
      // Not cached yet: use the network; offline page loads fall back to the app shell.
      return update.catch(async (error) => (isPage && (await cache.match('./index.html'))) || Promise.reject(error));
    })(),
  );
});
