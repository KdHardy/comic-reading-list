/* Minimal same-origin shell cache so a warm visit can reload offline.
   App data (lists) lives in localStorage; this only covers HTML/JS/CSS/icons. */
const CACHE = 'comiclist-shell-v2';

async function precacheShell(cache) {
  const roots = ['/', '/index.html', '/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png'];
  await cache.addAll(roots);

  // Vite emits hashed /assets/* links in index.html — precache those too.
  try {
    const htmlResponse = await cache.match('/index.html') || (await fetch('/index.html'));
    const html = await htmlResponse.clone().text();
    if (!(await cache.match('/index.html'))) {
      await cache.put('/index.html', htmlResponse.clone());
    }
    const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    if (assetPaths.length > 0) {
      await cache.addAll(assetPaths);
    }
  } catch {
    // Install still succeeds with the roots; runtime caching may fill the rest.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(precacheShell).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE);
        const cached =
          (await cache.match(request)) ||
          (await cache.match(url.pathname)) ||
          (request.mode === 'navigate' ? (await cache.match('/index.html')) || (await cache.match('/')) : null);
        if (cached) return cached;
        throw new Error('offline-miss');
      })
  );
});
