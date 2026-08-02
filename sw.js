/* Three Gentlemen — service worker: offline-first everything */
importScripts('precache-manifest.js'); // defines self.__PRECACHE and self.__VERSION

const SHELL = 'tg-shell-' + self.__VERSION;
const TILES = 'tg-tiles-v1';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // chunked, tolerant precache — a single miss must not brick the install
    const chunk = 20;
    for (let i = 0; i < self.__PRECACHE.length; i += chunk) {
      await Promise.all(self.__PRECACHE.slice(i, i + chunk).map(u =>
        cache.add(u).catch(() => {})));
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL && key !== TILES) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // external "read more" links: hands off

  if (url.pathname.includes('/tiles/')) {
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return new Response('', { status: 404 });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok && e.request.method === 'GET') {
        const cache = await caches.open(SHELL);
        cache.put(e.request, res.clone());
      }
      return res;
    } catch {
      if (e.request.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      return new Response('offline', { status: 503 });
    }
  })());
});
