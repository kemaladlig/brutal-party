/**
 * Çizim kaydedici ctx — iki GC/performans düşmanını sessiz geçmek yerine
 * PATLATIR: kare başına gradyan/pattern üretimi. Diğer her çağrı loglanır ki
 * op bütçesi ve çizim sırası testlerde okunabilsin.
 *
 * Paylaşılan yardımcı: arenaLayout (op bütçesi) ve depthScene (sıralama)
 * aynı kaydediciyi kullanır — kopya yok.
 */
export function strictRecorder(label = 'çizim') {
  const log = [];
  const bomb = (name) => { throw new Error(`${label} kare başına ${name} üretti`); };
  const target = {
    log,
    createLinearGradient: () => bomb('createLinearGradient'),
    createRadialGradient: () => bomb('createRadialGradient'),
    createPattern: () => bomb('createPattern'),
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => {
        log.push(`${String(key)}(${args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : String(a))).join(',')})`);
      };
    },
    set(t, key, value) { t[key] = value; return true; },
  });
}

/**
 * Kaydedici ctx — gradyan üretimini PATLATMAZ, yalnız loglar.
 *
 * `strictRecorder` çizim yolunu disipline eder ama gradyanı bilerek kullanan
 * (ve katman bake'inde bir kez üreten) çağrıları da reddeder. Böyle bir yolu
 * incelerken bu gevşek sürüm gerekir: `drawRailDetail` ray üst yüzüne
 * gradyan basar.
 */
export function logRecorder() {
  const log = [];
  const dummy = { addColorStop: () => {} };
  const target = {
    log,
    createLinearGradient: (...a) => { log.push(`linGrad(${a.length})`); return dummy; },
    createRadialGradient: (...a) => { log.push(`radGrad(${a.length})`); return dummy; },
    createPattern: () => { log.push('pattern()'); return null; },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: () => ({ width: 0 }),
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => {
        log.push(`${String(key)}(${args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : String(a))).join(',')})`);
      };
    },
    set(t, key, value) { t[key] = value; return true; },
  });
}