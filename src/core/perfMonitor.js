// Tek kaynak performans defteri: host kare döngüsü (sim / broadcast / render)
// ve client world sunumu aynı örnekleyiciye yazar. Burada DOM/CSS YOK; görünüm
// `src/ui/perfOverlay.js`'tedir ve yalnız `?perf` / `bp.perf=1` ile açılır.
//
// Amaç: ONLINE "akıcı değil" hissinin hangi katmanda olduğunu TAHMİN etmek
// yerine ölçmek — host CPU (update/render/broadcast), client çizim maliyeti
// (render/frame) veya ağ (playout/jitter/frame age). Sunum-only; oyun durumu
// üretmez, host yetkisini değiştirmez.

const RING = 120;

function makeSeries() {
  return { buf: new Float64Array(RING), count: 0, head: 0 };
}

function pushSeries(series, value) {
  if (!Number.isFinite(value)) return;
  series.buf[series.head] = value;
  series.head = (series.head + 1) % RING;
  if (series.count < RING) series.count++;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function summarize(series) {
  if (series.count === 0) return null;
  const values = [];
  for (let i = 0; i < series.count; i++) values.push(series.buf[i]);
  values.sort((a, b) => a - b);
  let sum = 0;
  for (const value of values) sum += value;
  return {
    avg: round1(sum / values.length),
    p95: round1(values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]),
    max: round1(values[values.length - 1]),
    n: values.length,
  };
}

const series = new Map();
const gauges = new Map();

// ── FX kademe defteri (MOTION_PLAN 2.3) ─────────────────────────────────────
// Boot'ta cihaz metriğinden low/mid/high seçilir; 20 ms üstü kare-süresi
// SÜRERSE bir kademe düşer. Kademe TEK YERDEN okunur (`fxParticleScale` /
// `fxGlowEnabled`); motorlar ve fxKit başka sayı uydurmaz. Tanımlanmamış
// ortamda (test/node) kademe 'high' ve çarpan 1'dir — saf fonksiyon
// kilitleri deterministik kalır.
const FX_TIER_ORDER = ['low', 'mid', 'high'];
const FX_TIER_SPEC = {
  low: { particleScale: 0.4, glow: false },
  mid: { particleScale: 0.7, glow: true },
  high: { particleScale: 1.0, glow: true },
};
const FX_SLOW_FRAME_MS = 20;
const FX_SLOW_STREAK = 30;

let fxTier = 'high';
let fxSlowStreak = 0;
let fxTierBooted = false;

/**
 * Lazy boot: ilk FX kademe okumasında cihaz metriğinden başlangıç kademesi
 * seçilir (tarayıcıda bir kez). Node/test ortamında (`typeof window ===
 * 'undefined'`) hiç boot edilmez — kademe 'high' kalır, saf kilitler
 * deterministik (tanksFx kill burst >= 18).
 */
function ensureFxTierBoot() {
  if (fxTierBooted) return;
  if (typeof window === 'undefined') return;
  fxTierBooted = true;
  try { noteFxDeviceMetrics({}); } catch {}
}

/**
 * Cihaz metriklerinden başlangıç kademesi. `tier` verilirse metrik yok sayılır
 * (test/özel iğneleme). @param {{ cores?: number, memoryMb?: number, tier?: 'low'|'mid'|'high' }} [metrics]
 */
export function noteFxDeviceMetrics(metrics = {}) {
  if (metrics && FX_TIER_ORDER.includes(metrics.tier)) {
    fxTier = metrics.tier;
    fxSlowStreak = 0;
    return fxTier;
  }
  const navAny = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator) : null;
  const cores = Number(metrics?.cores) || (navAny ? Number(navAny.hardwareConcurrency) : 0) || 0;
  const memoryMb = Number(metrics?.memoryMb) || (navAny ? Number(navAny.deviceMemory) * 1024 : 0) || 0;
  // Hiç sinyal yoksa 'high': masaüstü varsayılanı, testler deterministik.
  if (!cores && !memoryMb) {
    fxTier = 'high';
  } else if (cores <= 2 || (memoryMb > 0 && memoryMb <= 2048)) {
    fxTier = 'low';
  } else if (cores >= 8 && (memoryMb === 0 || memoryMb >= 3072)) {
    fxTier = 'high';
  } else {
    fxTier = 'mid';
  }
  fxSlowStreak = 0;
  return fxTier;
}

/** Kare süresi örneği: 20 ms üstü sürerse kademe bir basamak iner (2.3). */
export function noteFxFrameTime(ms) {
  ensureFxTierBoot();
  if (!Number.isFinite(ms) || ms <= 0) return;
  if (ms > FX_SLOW_FRAME_MS) {
    fxSlowStreak += 1;
    if (fxSlowStreak >= FX_SLOW_STREAK) {
      const idx = FX_TIER_ORDER.indexOf(fxTier);
      if (idx > 0) fxTier = FX_TIER_ORDER[idx - 1];
      fxSlowStreak = 0;
    }
  } else {
    fxSlowStreak = 0;
  }
}

/** Kademe adı (rapor/perf overlay). */
export function fxTierName() {
  return fxTier;
}

/** Partikül çarpanı — TEK okuma noktası (fxRuntime burst boyutu). */
export function fxParticleScale() {
  ensureFxTierBoot();
  return FX_TIER_SPEC[fxTier].particleScale;
}

/** Glow/puls aurası katmanı açık mı (low'da kapalı). */
export function fxGlowEnabled() {
  ensureFxTierBoot();
  return FX_TIER_SPEC[fxTier].glow;
}

export const perfMonitor = {
  /** Kare içi süre örneği (ms). Ortalama/p95/max bu seriden türetilir. */
  record(key, valueMs) {
    let entry = series.get(key);
    if (!entry) {
      entry = makeSeries();
      series.set(key, entry);
    }
    pushSeries(entry, valueMs);
  },
  /** Son değer (ortalama alınmaz): playout, jitter, frame age gibi anlık ölçüler. */
  gauge(key, value) {
    if (Number.isFinite(value)) gauges.set(key, value);
  },
  reset() {
    series.clear();
    gauges.clear();
  },
  snapshot() {
    const out = {};
    for (const [key, entry] of series) out[key] = summarize(entry);
    return { series: out, gauges: Object.fromEntries(gauges) };
  },
};

/** Debug HUD yalnız açıkça istenirse kurulur (URL `?perf` veya `bp.perf=1`). */
export function isPerfEnabled() {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf')) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('bp.perf') === '1') return true;
  } catch {}
  return false;
}
