// Service Worker eKiKare
const IS_BETA = self.location.pathname.includes('/beta');
const CACHE_VERSION = 'v1.8.2';
const CACHE_PREFIX = IS_BETA ? 'ekikare-beta-' : 'ekikare-cache-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=1.8.2',
  './app.js?v=1.8.2',
  './db.js?v=1.8.2',
  './sync-manager.js?v=1.8.2',
  './lib/pinch-zoom.umd.js?v=1.8.2',
  './manifest.json',
  './favicon.ico',
  './horse_skeleton.png',
  './assets/logo-icon.png',
  './assets/logo-ekikare.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          const belongsToSameEnv = IS_BETA
            ? key.startsWith('ekikare-beta-')
            : !key.startsWith('ekikare-beta-');
          if (belongsToSameEnv && key !== CACHE_NAME) {
            console.log('[SW] Suppression ancien cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignorer les requêtes d'API distantes (Supabase, CDN tiers) et les protocoles spéciaux
  if (url.origin.includes('supabase.co') || !url.protocol.startsWith('http')) {
    return;
  }

  // Stratégie Network-First avec repli sur le cache isolé (Prod vs Beta)
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
        return caches.open(CACHE_NAME).then((cache) => {
          return cache.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            if (request.headers.get('accept')?.includes('text/html')) {
              return cache.match('./index.html');
            }
          });
        });
      })
  );
});
