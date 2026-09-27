// Tek screen wake-lock sahibi. Eskiden `main.js` (host) ve `gamepad.js`
// (kumanda) aynı API'yi ayrı ayrı kopyalıyordu; ekranı açık tutma bütçesi
// tek yerde yaşar. İstek zaten tutuluysa yeni istek atılmaz (çift uygulama
// kavgası olmaz), release tek sentinel üzerinden çalışır.

let sentinel = null;

function supported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export async function acquireWakeLock() {
  if (!supported() || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

export function releaseWakeLock() {
  if (!sentinel) return;
  try {
    sentinel.release();
  } catch {}
  sentinel = null;
}

export function hasWakeLock() {
  return !!sentinel;
}
