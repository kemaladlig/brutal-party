const CACHE_NAME = 'brutal-party-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

// ASLA cache'lenmeyecek / bypass edilecek istekler:
// - Supabase Realtime/REST (çevrimiçi relay)
// - Lokal WebSocket yükseltmesi ve LAN-IP API'si
// - WebSocket şemalı istekler
function isBypassed(url) {
  const host = url.hostname;
  if (host.endsWith('.supabase.co')) return true;
  if (url.pathname.startsWith('/party-ws')) return true;
  if (url.pathname.startsWith('/api/')) return true;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Realtime/API trafiğine dokunma — her zaman şebekeye git
  if (isBypassed(url) || event.request.method !== 'GET') {
    return;
  }

  // Sayfa geçişlerinde (/?join=XXXX dahil) önce şebeke, olmazsa cache'teki uygulama kabuğu
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Aynı origin statik asset'ler (Vite hashed JS/CSS dahil): cache-first + runtime doldurma
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Üçüncü parti (font vb.): şebeke öncelikli, düşerse cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => networkResponse)
      .catch(() => caches.match(event.request))
  );
});
