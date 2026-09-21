const CACHE_NAME = 'brutal-party-v12';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/assets/games/pong.jpg',
  '/assets/games/tanks.jpg',
  '/assets/games/curve.jpg',
  '/assets/games/bomb.jpg',
  '/assets/games/heist.jpg',
  '/assets/games/duel.jpg',
  '/assets/games/crown.jpg',
  '/assets/games/zone.jpg',
  '/assets/games/snake.jpg',
  '/assets/games/laser.jpg',
  '/assets/games/clone.jpg',
  '/assets/games/collapse.jpg',
  '/assets/games/ninja.jpg',
];

// Runtime cache şişmesin: üst sınırı aşınca en eskiler silinir
const MAX_RUNTIME_ENTRIES = 60;
function trimCache(cache) {
  return cache.keys().then((keys) => {
    if (keys.length <= MAX_RUNTIME_ENTRIES) return;
    const overflow = keys.length - MAX_RUNTIME_ENTRIES;
    return Promise.all(keys.slice(0, overflow).map((k) => cache.delete(k)));
  });
}

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

  const isNavigate = event.request.mode === 'navigate';

  // Network-first stratejisi: her zaman önce şebekeden taze kodu al
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && url.origin === self.location.origin) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, copy).then(() => trimCache(cache));
          });
        }
        return networkResponse;
      })
      .catch(() =>
        // ?join= / ?source=pwa gibi navigasyonlar offline'da index'e düşer
        caches.match(event.request).then((hit) => hit || (isNavigate ? caches.match('/index.html') : undefined))
      )
  );
});

