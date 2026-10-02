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