// Sürüm adıyla birlikte tüm çalışma zamanı önbelleği düşürülür (activate).
// Statik varlıklarda cache-first kullanıldığı için, bir kapak ya da simge
// değiştiğinde bu sürüm numarası da yükseltilir.
const CACHE_NAME = 'brutal-party-v22';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/background.webp',
  '/icon-192.png',
  '/icon-512.png',
  '/assets/illustrations/tv.webp',
  '/assets/illustrations/online.webp',
  '/assets/games/pong.webp',
  '/assets/games/tanks.webp',
  '/assets/games/curve.webp',
  '/assets/games/bomb.webp',
  '/assets/games/heist.webp',
  '/assets/games/archer.webp',
  '/assets/games/crown.webp',
  '/assets/games/zone.webp',
  '/assets/games/snake.webp',
  '/assets/games/collapse.webp',
  '/assets/games/ninja.webp',
  '/assets/games/horde.webp',
  '/assets/games/colossus.webp',
];

// Runtime cache şişmesin: üst sınırı aşınca en eskiler silinir. Tavan
// precache (23) + hash'li motor chunk'ları (~20) + kapak görselleri + yazı
// tipleri için yeterli olmalı; 60 iken açılış sırasında precache'lenmiş kapaklar
// süpürülüp çevrimdışı açılışı görselsiz bırakıyordu.
const MAX_RUNTIME_ENTRIES = 240;
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

// Değiştirilemez statik varlıklar: Vite'ın hash'li çıktısı (`/assets/*-HASH.js`),
// kapak görselleri, simgeler ve yazı tipi sunucusu. Bunlarda network-first
// kullanmak, kurulmuş PWA'nın soğuk açılışını tüm modül grafı için ağa
// bağlardı — uçak modunda uygulama hiç açılmıyordu. Tazeliği bozan şey değil:
// dosya adı hash'i değişince yeni istek yeni girdidir, eski sürüm CACHE_NAME
// yükseltmesiyle zaten düşürülür.
function isImmutableAsset(url) {
  if (url.origin === self.location.origin) {
    // Kenney ogg'ları hash'siz ama değişmez lisanslı pakettir: bir kez indi mi
    // runtime'da tekrar ağa sorulmaz (ilk maçtan sonra çevrimdışı da çalar).
    if (url.pathname.startsWith('/sound/')) return true;
    return /^\/assets\//.test(url.pathname) || /^\/(icon|background|manifest)/.test(url.pathname);
  }
  return /(^|\.)(fonts\.googleapis|fonts\.gstatic)\.com$/.test(url.hostname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const results = await Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url))
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn(`[SW] Precache incomplete: ${failed.length} assets failed`, failed);
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  // Cache-first: açılışın kritik yolundaki statik varlıklar. Ağda kalırsa
  // uçak modunda / yavaş bağlantıda uygulama hiç boyanmıyor.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        // Yazı tipi sunucusu opaque (CORS'suz) döndürür: status 0'dır ve yine
        // de önbelleğe değer — yoksa her açılışta şebeke beklenir.
        const worthCaching = res && (res.status === 200 || res.type === 'opaque');
        if (worthCaching) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, copy).then(() => trimCache(cache));
          });
        }
        return res;
      }))
    );
    return;
  }

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

