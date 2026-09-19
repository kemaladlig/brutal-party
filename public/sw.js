const CACHE_NAME = 'brutal-party-v10';
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
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
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
  const url = new URL(event.request.url);

  // Realtime/API trafiğine dokunma — her zaman şebekeye git
  if (isBypassed(url) || event.request.method !== 'GET') {
    return;
  }

  // Network-first stratejisi: her zaman önce şebekeden taze kodu al
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && url.origin === self.location.origin) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

