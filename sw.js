// Service Worker eKiKare
const CACHE_NAME = 'ekikare-cache-v1.6.44';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=1.6.44',
  './app.js?v=1.6.44',
  './db.js?v=1.6.44',
  './sync-manager.js?v=1.6.44',
  './manifest.json',
  './favicon.ico',
  './assets/logo-icon.png',
  './assets/logo-ekikare.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignorer les requêtes d'API distantes (Supabase, CDN tiers) et les protocoles spéciaux
  if (url.origin.includes('supabase.co') || !url.protocol.startsWith('http')) {
    return;
  }

  // Stratégie Network-First avec repli sur le cache pour un usage hors-ligne fiable
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
