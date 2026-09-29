// Debug performans HUD'u — yalnız `?perf` / `bp.perf=1` açıkken DOM'a girer
// (`core/perfMonitor.isPerfEnabled`). Üretim yüzeyi değildir; veri tek kaynaktan
// (`core/perfMonitor.js`) gelir, burada yalnız okunur biçime çevrilir.

import { perfMonitor, isPerfEnabled } from '../core/perfMonitor.js';

const REFRESH_MS = 250;

function pair(snapshot, key) {
  const stat = snapshot.series[key];
  return stat ? `${stat.avg}/${stat.p95}` : '—';
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function format(snapshot) {
  const gauges = snapshot.gauges;
  return [
    `HOST   frame ${pair(snapshot, 'host.frame')}  upd ${pair(snapshot, 'host.update')}  `
      + `bc ${pair(snapshot, 'host.broadcast')}  rnd ${pair(snapshot, 'host.render')}`,
    `CLIENT frame ${pair(snapshot, 'client.frame')}  rnd ${pair(snapshot, 'client.render')}  `
      + `playout ${round(gauges['client.playout'])}  jitter ${round(gauges['client.jitter'])}  `
      + `age ${round(gauges['client.frameAge'])}`,
  ].join('\n');
}

/** @returns {() => void} teardown (kurulmadıysa no-op) */
export function mountPerfOverlay() {
  if (typeof document === 'undefined' || !isPerfEnabled()) return () => {};
  if (document.querySelector('.perf-hud')) return () => {};

  const el = document.createElement('div');
  el.className = 'perf-hud';
  el.setAttribute('aria-hidden', 'true');

  const paint = () => { el.textContent = format(perfMonitor.snapshot()); };
  paint();
  document.body.appendChild(el);

  let rafId = 0;
  let lastPaint = 0;
  const tick = (now) => {
    if (now - lastPaint >= REFRESH_MS) {
      lastPaint = now;
      paint();
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(rafId);
    el.remove();
  };
}
