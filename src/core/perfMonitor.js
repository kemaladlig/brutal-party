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
