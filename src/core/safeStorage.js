// SafeStorage — localStorage'a dayanıklı erişim katmanı.
// Safari Private Browsing, iframe/çerez engeli veya kota doluluğunda (QuotaExceededError)
// localStorage doğrudan exception fırlatır. Bu wrapper okuma/yazmayı dener,
// başarısız olursa bellek-içi (in-memory) depoya düşer: oturum içi davranış
// korunur, uygulama asla çökmez. API localStorage ile aynı semantiğe sahiptir
// (get → string|null, set/remove sessiz).
const memoryStore = new Map();

function nativeAvailable() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

export function safeGet(key) {
  if (nativeAvailable()) {
    try {
      return localStorage.getItem(key);
    } catch {
      // native erişim patladı → memory fallback'e düş
    }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

export function safeSet(key, value) {
  const str = String(value);
  let nativeOk = false;
  if (nativeAvailable()) {
    try {
      localStorage.setItem(key, str);
      nativeOk = true;
    } catch {
      nativeOk = false;
    }
  }
  // Native yazı başarısızsa oturum içi tutarlılık için belleğe yaz.
  // Native başarılıysa bellekteki bayat kopyayı temizle (tek gerçek kaynak disk).
  if (nativeOk) memoryStore.delete(key);
  else memoryStore.set(key, str);
}

export function safeRemove(key) {
  if (nativeAvailable()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // sessiz geç
    }
  }
  memoryStore.delete(key);
}

// Native kalıcı depolama şu an yazılabilir mi? (ayar ekranları için bilgi amaçlı)
export function isPersistent() {
  if (!nativeAvailable()) return false;
  try {
    const probe = '__brutal_storage_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
