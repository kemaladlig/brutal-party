// AI Bot Firewall: Zero-Copy Read-Only BotView Proxy.
// Bot'ların simülasyon state'ini (arena, oyuncular, mermiler, engeller, skorlar)
// doğrudan mutasyona uğratmasını mekanik olarak engeller.
// Girdiler daima bot varlığının kendi kontrol alanlarına yazılır (inputX, wantJump, vb.).

const MUTATING_ARRAY_METHODS = /** @type {Set<string | symbol>} */ (new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
]));

const MUTATING_SET_METHODS = /** @type {Set<string | symbol>} */ (new Set(['add', 'delete', 'clear']));
const MUTATING_MAP_METHODS = /** @type {Set<string | symbol>} */ (new Set(['set', 'delete', 'clear']));

const proxyCache = new WeakMap();

/**
 * Verilen oyun/durum nesnesini salt-okunur bir Proxy ile sarmalar.
 * Zero-copy ve WeakMap memoization ile kare başına GC yükü oluşturmaz.
 * Görünüm hedefin şekilini korur: tip hedeften türer (MiniGameEngine annotate'ları).
 * @template {object} T
 * @param {T | null | undefined} target - Ana simülasyon nesnesi
 * @returns {T | null | undefined} Salt-okunur proxy görünümü
 */
export function createReadOnlyView(target) {
  if (target === null || typeof target !== 'object') return target;
  if (/** @type {any} */ (target).__isReadOnlyProxy) return target;

  let proxy = proxyCache.get(target);
  if (proxy) return proxy;

  proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === '__isReadOnlyProxy') return true;
      if (prop === '__rawTarget') return t;

      if (Array.isArray(t) && MUTATING_ARRAY_METHODS.has(prop)) {
        return () => {
          throw new Error(`[BotView Firewall] Cannot call mutating array method "${String(prop)}" on read-only game state`);
        };
      }
      if (t instanceof Set && MUTATING_SET_METHODS.has(prop)) {
        return () => {
          throw new Error(`[BotView Firewall] Cannot call mutating Set method "${String(prop)}" on read-only game state`);
        };
      }
      if (t instanceof Map && MUTATING_MAP_METHODS.has(prop)) {
        return () => {
          throw new Error(`[BotView Firewall] Cannot call mutating Map method "${String(prop)}" on read-only game state`);
        };
      }

      const val = Reflect.get(t, prop, receiver);
      if (typeof val === 'function') {
        return val.bind(t);
      }
      if (typeof val === 'object' && val !== null) {
        return createReadOnlyView(val);
      }
      return val;
    },
    set(t, prop) {
      throw new Error(`[BotView Firewall] Read-only violation: cannot set property "${String(prop)}" on game state`);
    },
    deleteProperty(t, prop) {
      throw new Error(`[BotView Firewall] Read-only violation: cannot delete property "${String(prop)}" from game state`);
    },
    defineProperty(t, prop) {
      throw new Error(`[BotView Firewall] Read-only violation: cannot define property "${String(prop)}" on game state`);
    },
    setPrototypeOf() {
      throw new Error('[BotView Firewall] Read-only violation: cannot set prototype of game state');
    },
  });

  proxyCache.set(target, proxy);
  return proxy;
}

export function isReadOnlyView(target) {
  return !!target?.__isReadOnlyProxy;
}

export function unwrapReadOnlyView(target) {
  return target?.__rawTarget || target;
}
