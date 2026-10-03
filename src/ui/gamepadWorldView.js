// Generic phone-side world frame presenter. It stores authoritative snapshots,
// presents them through a small jitter buffer, and draws with requestAnimationFrame.
// It never advances game simulation.

import {
  createWorldFrameBlender,
  blendWorldFrames,
  canBlendWorldFrames,
  selectBufferedWorldFrame,
} from '../core/worldInterpolation.js';
import { applySelfPrediction, createSelfPredictor, observeSelfFrame, selfPredictionHorizon } from '../core/selfPrediction.js';
import { perfMonitor, noteFxFrameTime } from '../core/perfMonitor.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import { fxFlashAlpha, isFxKind } from '../core/fxKit.js';
import { drawFxFlash } from '../games/worldCore.js';
import { renderWorldConnecting } from './worldViewKit.js';

export { blendWorldFrames };

const STALE_AFTER_MS = 1500;
const CONNECTING_AFTER_MS = 1500;
const DEFAULT_INTERVAL_MS = 1000 / 30;
const MIN_INTERVAL_MS = 25;
const MAX_INTERVAL_MS = 250;
// Taban playout = bir 30 Hz kare aralığı + pay. 50 ms taban, düşük jitterli
// bağlantıda bile kendi hareketini gecikmeli gösteriyordu; 35 ms gerçek
// gecikmeyi ~15 ms kısar, jitter yükselince adaptif formül yine yukarı çeker.
const DEFAULT_PLAYOUT_DELAY_MS = 35;
const MIN_PLAYOUT_DELAY_MS = 35;
const MAX_PLAYOUT_DELAY_MS = 120;
const MAX_BUFFER_FRAMES = 8;
const MAX_INTERPOLATION_GAP_MS = 100;
// Maç sonu kartının giriş yumuşaması: host canvas'ıyla AYNI süre
// (`tabletopRenderer.MATCH_OVER_ENTER_MS`) — telefon ve TV aynı anda açar.
const MATCH_OVER_ENTER_MS = 260;
// Render süresi kuyruğu (`?perf` HUD p95'i) sabit boyutlu halka tampondur.
const RENDER_DURATION_SAMPLES = 120;

const finiteNum = (value) => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class GamepadWorldView {
  constructor(canvas, renderer, { slots = [], selfSlot = -1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderer = renderer;
    // Gameplay position smoothing is essential state presentation, not a
    // decorative animation, so reduced-motion never disables this path.
    // Havuzlu blender: kare başına tahsis yok (aşağıda `_sampleAt`).
    this.interpolate = typeof renderer?.interpolate === 'function'
      ? renderer.interpolate.bind(renderer)
      : createWorldFrameBlender();
    this.slots = slots;
    this.selfSlot = Number.isInteger(selfSlot) ? selfSlot : -1;
    // Raunt boşluğu (STATE_SYNC `roundGap`): raunt-sonu bandının geri sayımı.
    // Simülasyon değil sunumdur; host yalnız sayıyı yayınlar.
    this.roundGapSeconds = 0;
    // Maç sonu kartının giriş ilerlemesi (0..1): world-view finali host ile
    // aynı yumuşamayla açar. Yine sunum-only.
    this.matchOverEnter = 1;
    this._matchOverAt = 0;
    // Self-avatar prediction: sunum-only, host yetkisini değiştirmez.
    this.predictor = createSelfPredictor();
    this.selfInput = { dx: 0, dy: 0, force: 0 };

    // FX olay playback'i (MOTION_PLAN 2.2): anlık güvenilir yoldan gelen
    // olaylar burada yalnız SUNUM durumuna çevrilir (§2: kumandada sim yok).
    // `fxLive` mandalı: ilk olaydan itibaren frame.fx/frame.particles YERİNE
    // bu katman çizer — iki kaynak aynı anda çizilirse partikül ikiye katlanır.
    this.fx = createFxRuntime({});
    this.fxLive = false;
    this._fxUpdatedAt = 0;
    // Render context'i kare başına yeniden kurmak yerine tek nesne üzerinde
    // güncellenir; view'lar onu yalnız senkron okur.
    this._renderContext = { selfSlot: this.selfSlot, roundGap: 0, matchOverEnter: 1, fx: null };

    // `frame` is the newest accepted snapshot. `buffer` contains the samples
    // used by the delayed presenter; it is intentionally separate from frame.
    this.frame = null;
    this.prevFrame = null;
    this.buffer = [];
    // Buffer yalnız `accept`/`_clearBuffer` ile değişir; kaynak-saat
    // hazırlığı (`sentAt` dolu mu) bu yüzden kare başına `.every()` yerine
    // kabul anında bir kez hesaplanır.
    this._sourceClockReady = false;
    this.prevAt = 0;
    this.currAt = 0;
    this.intervalMs = DEFAULT_INTERVAL_MS;
    this.jitterMs = 0;
    this.playoutDelayMs = DEFAULT_PLAYOUT_DELAY_MS;
    this.lastReceiveAt = 0;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.mountedAt = performance.now();
    this.isStale = false;
    // Render süresi kuyruğu: eski `array.push` + `array.shift()` kare başına
    // 120 elemanlı memmove yapıyordu; halka O(1)'dir.
    this.renderDurBuf = new Float64Array(RENDER_DURATION_SAMPLES);
    this.renderDurHead = 0;
    this.renderDurCount = 0;
    // Render hata sayacı: log kare başına değil, ilk hatada ve her 60.'da.
    this.renderFailures = 0;
    this.rafId = 0;
    this.destroyed = false;

    this.stats = {
      acceptedFrames: 0,
      droppedFrames: 0,
      lastAlpha: 0,
      lastRenderMs: 0,
      p95RenderMs: 0,
      lastFrameAgeMs: 0,
      sourceClockOffsetMs: null,
    };

    this._resize = this._resize.bind(this);
    this._draw = this._draw.bind(this);
    this._checkStale = this._checkStale.bind(this);

    this.resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(this._resize)
      : null;
    this.resizeObserver?.observe(canvas);
    window.addEventListener('resize', this._resize, { passive: true });
    this.staleTimer = window.setInterval(this._checkStale, 500);
    this._resize();
  }

  setSlots(slots) {
    this.slots = Array.isArray(slots) ? slots : [];
    this._queueRender();
  }

  setSelfSlot(slot) {
    this.selfSlot = Number.isInteger(slot) ? slot : -1;
    this._queueRender();
  }

  // Raunt boşluğunun kalan saniyesi (STATE_SYNC). Değişmezse yeniden çizme.
  setRoundGap(seconds) {
    const next = Math.max(0, Number(seconds) || 0);
    if (next === this.roundGapSeconds) return;
    this.roundGapSeconds = next;
    this._queueRender();
  }

  // Live local move input for self-avatar prediction. Zeros (release/neutral)
  // simply disable prediction for the next draw — no simulation happens here.
  setSelfInput(input) {
    this.selfInput = input
      ? { dx: Number(input.dx) || 0, dy: Number(input.dy) || 0, force: Number(input.force) || 0 }
      : { dx: 0, dy: 0, force: 0 };
  }

  accept(frame) {
    if (
      this.destroyed
      || !frame
      || !Number.isInteger(frame.seq)
      || typeof this.renderer?.validate === 'function' && !this.renderer.validate(frame)
    ) return false;

    const now = performance.now();
    const hostChanged = !!(this.hostId && frame.hostId && frame.hostId !== this.hostId);
    const recoveredFromStale = this.isStale;
    const boundaryChanged = recoveredFromStale
      || !!(this.frame && !canBlendWorldFrames(this.frame, frame));
    if (!hostChanged && frame.seq <= this.lastSeq) return false;
    if (hostChanged) {
      this.lastSeq = -1;
      this.stats.sourceClockOffsetMs = null;
    }
    if (hostChanged || boundaryChanged) {
      this._clearBuffer();
      this.frame = null;
    }

    if (frame.seq <= this.lastSeq) return false;
    if (this.lastSeq >= 0 && frame.seq > this.lastSeq + 1) {
      this.stats.droppedFrames += frame.seq - this.lastSeq - 1;
    }
    if (frame.hostId) this.hostId = frame.hostId;

    const previousFrame = this.frame;
    const receiveDelta = this.lastReceiveAt > 0 ? now - this.lastReceiveAt : 0;
    if (!boundaryChanged && !hostChanged && receiveDelta > 0 && receiveDelta < 1000) {
      this._updateTiming(receiveDelta);
    }

    this.buffer.push({
      frame,
      receivedAt: now,
      sentAt: finiteNum(frame.sentAt),
    });
    if (this.buffer.length > MAX_BUFFER_FRAMES) this.buffer.splice(0, this.buffer.length - MAX_BUFFER_FRAMES);
    this._sourceClockReady = this.buffer.length > 1
      && this.buffer.every((sample) => sample.sentAt !== null);

    this.prevFrame = previousFrame;
    this.prevAt = this.currAt || now;
    this.currAt = now;
    this.frame = frame;
    observeSelfFrame(this.predictor, frame, this.selfSlot, now);
    this.lastReceiveAt = now;
    this.lastSeq = frame.seq;
    this.lastFrameAt = now;
    this.isStale = false;
    // Yeni kare geldi: hata sayacı sıfırlanır, bir sonraki hata "ilk" sayılır.
    this.renderFailures = 0;
    this.stats.acceptedFrames += 1;
    this._updateSourceClock(frame.sentAt, now);
    this._stampPlaybackTimes();
    this._queueRender();
    return true;
  }

  /**
   * FX olayı kabulü (anlık güvenilir yol). Olaylar damgalı ve süzülmüş gelir
   * (gamepad.handleFxEvents); burada yalnız oynatılır.
   * @param {any[]} events
   */
  acceptFx(events) {
    if (this.destroyed || !Array.isArray(events) || !events.length) return;
    for (const ev of events) {
      if (!ev || !isFxKind(ev.fx)) continue;
      this.fx.emit(ev.fx, {
        x: ev.x,
        y: ev.y,
        unit: ev.u,
        color: ev.color,
        dirX: ev.dirX,
        dirY: ev.dirY,
        angle: ev.angle,
        size: ev.size,
        ringRadius: ev.ringRadius ?? null,
        slot: ev.slot,
        haptic: false,
      });
    }
    this.fxLive = true;
    this._queueRender();
  }

  /** FX katmanı (obje biçimi) — view'lar `context.fx` üzerinden çizer. */
  fxLayer() {
    return {
      pops: this.fx.pops,
      rings: this.fx.rings,
      particles: this.fx.particles,
      flash: this.fx.flash,
      flashPeak: this.fx.flashPeak,
    };
  }

  reset() {
    this._clearBuffer();
    this.fx.clear();
    this.fxLive = false;
    this.frame = null;
    this.prevFrame = null;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.isStale = false;
    this._queueRender();
  }

  getStats() {
    const sortedRenderDurations = [];
    for (let i = 0; i < this.renderDurCount; i += 1) {
      sortedRenderDurations.push(this.renderDurBuf[i]);
    }
    sortedRenderDurations.sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sortedRenderDurations.length * 0.95) - 1);
    return {
      ...this.stats,
      p95RenderMs: sortedRenderDurations[p95Index] || 0,
      bufferDepth: this.buffer.length,
      playoutDelayMs: this.playoutDelayMs,
      estimatedIntervalMs: this.intervalMs,
      jitterMs: this.jitterMs,
      lastFrameAgeMs: this.lastFrameAt ? performance.now() - this.lastFrameAt : 0,
    };
  }

  _clearBuffer() {
    this.buffer.length = 0;
    this.prevFrame = null;
    this.prevAt = 0;
    this.currAt = 0;
    this.lastReceiveAt = 0;
    this.intervalMs = DEFAULT_INTERVAL_MS;
    this.jitterMs = 0;
    this.playoutDelayMs = DEFAULT_PLAYOUT_DELAY_MS;
    this.predictor = createSelfPredictor();
    this._sourceClockReady = false;
  }

  _updateTiming(delta) {
    const deviation = Math.abs(delta - this.intervalMs);
    this.intervalMs = clamp(
      this.intervalMs * 0.8 + delta * 0.2,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    );
    this.jitterMs = this.jitterMs * 0.8 + deviation * 0.2;

    const desiredDelay = clamp(
      DEFAULT_PLAYOUT_DELAY_MS + Math.max(0, this.jitterMs - 4) * 2.5,
      MIN_PLAYOUT_DELAY_MS,
      MAX_PLAYOUT_DELAY_MS,
    );
    this.playoutDelayMs += (desiredDelay - this.playoutDelayMs) * 0.12;
  }

  _updateSourceClock(sentAt, receivedAt) {
    const sourceTime = finiteNum(sentAt);
    if (sourceTime === null) return;
    const sampleOffset = receivedAt - sourceTime;
    this.stats.sourceClockOffsetMs = this.stats.sourceClockOffsetMs === null
      ? sampleOffset
      : this.stats.sourceClockOffsetMs * 0.9 + sampleOffset * 0.1;
  }

  /**
   * Kaynak-saat hizalamasını buffer örneklerine YERİNDE yazar (`playbackAt`).
   *
   * Eskiden her çizim karesinde `alignSourceClock` çağrılıp yeni bir dizi +
   * örnek başına `{...sample}` üretiliyordu (60 Hz GC baskısı). Örnekler yalnız
   * `accept`/`_clearBuffer` ile değiştiği ve yumuşatılmış ofset de yalnız kabul
   * anında güncellendiği için damga burada bir kez atılır; `_sampleAt` artık
   * tahsis yapmaz. Eski istemcilerde (`sentAt` yok) damga atılmaz ve sunum
   * varış zamanına düşer — davranış aynıdır.
   */
  _stampPlaybackTimes() {
    const offset = this.stats.sourceClockOffsetMs;
    const ready = this._sourceClockReady && Number.isFinite(offset);
    for (let i = 0; i < this.buffer.length; i += 1) {
      const sample = this.buffer[i];
      if (ready) {
        sample.playbackAt = (finiteNum(sample.sentAt) ?? 0) + offset;
      } else if (sample.playbackAt !== undefined) {
        sample.playbackAt = undefined;
      }
    }
  }

  _sampleAt(now) {
    // `playbackAt` kabul anında damgalanır (`_stampPlaybackTimes`); burada
    // yalnız oynatma başlığı seçilir. Kare başına tahsis yok.
    return selectBufferedWorldFrame(
      this.buffer,
      now - this.playoutDelayMs,
      MAX_INTERPOLATION_GAP_MS,
      this.interpolate,
    );
  }

  _resize() {
    if (this.destroyed) return;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1);
    // Perf: world-view DPR bütçesi host canvas'ından AYRIDIR. Client'ta
    // HORDE gibi yoğun sahneler ~2000 op/kare üretiyor; 2.1 Mpx + DPR 2.5
    // orta segment telefonda rAF'ı 30-45 Hz'e düşürüyordu. 2.0 tavan ve
    // 1.6 Mpx bütçesi keskinliği korur, çizim maliyetini ~%35 kısar.
    const raw = Math.min(window.devicePixelRatio || 1, 2);
    const maxPx = 1_600_000;
    const pixels = width * height * raw * raw;
    const dpr = pixels <= maxPx ? raw : Math.max(1, Math.sqrt(maxPx / (width * height)));
    const targetWidth = Math.floor(width * dpr);
    const targetHeight = Math.floor(height * dpr);
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.dpr = dpr;
    this._queueRender();
  }

  _queueRender() {
    if (this.destroyed || this.rafId) return;
    this.rafId = requestAnimationFrame(this._draw);
  }

  _draw() {
    this.rafId = 0;
    if (this.destroyed) return;

    const now = performance.now();
    if (this._lastDrawAt) {
      perfMonitor.record('client.frame', now - this._lastDrawAt);
      noteFxFrameTime(now - this._lastDrawAt);
    }
    this._lastDrawAt = now;
    // FX playback kendi saatini burada işletir (sunum-only); kare yokken de
    // sönmesi gerekir — şuursuz birikme olmasın.
    const fxDt = this._fxUpdatedAt ? Math.min(0.05, (now - this._fxUpdatedAt) / 1000) : 0.016;
    this._fxUpdatedAt = now;
    if (this.fxLive) this.fx.update(fxDt);
    this.ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);

    if (!this.frame) {
      if (now - this.mountedAt >= CONNECTING_AFTER_MS) {
        renderWorldConnecting(this.ctx, this.logicalWidth, this.logicalHeight);
      } else {
        this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      }
      // Degrade (Supabase: world kanalı yok) — kabul edilmiş gramer: yalnız
      // flaş (MOTION_PLAN madde 2). Katmanı view çizemez (çerçeve yok).
      this._drawFlashOverlay();
      return;
    }

    if (this.isStale) {
      this.renderer.renderStale?.(this.ctx, this.logicalWidth, this.logicalHeight);
      return;
    }

    const sample = this._sampleAt(now);
    if (!sample) {
      if (now - this.mountedAt >= CONNECTING_AFTER_MS) {
        renderWorldConnecting(this.ctx, this.logicalWidth, this.logicalHeight);
      } else {
        this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      }
      return;
    }

    try {
      const renderStarted = performance.now();
      this.stats.lastAlpha = sample.alpha;
      this.stats.lastFrameAgeMs = now - sample.after.receivedAt;
      // Self-avatar ufku yalnız sunumun geride kaldığı boşluğu kapatır
      // (`selfPrediction.js`); playout gecikmesi ikinci kez eklenmez.
      const presentedFrame = applySelfPrediction(
        this.predictor,
        sample.frame,
        this.selfSlot,
        this.selfInput,
        selfPredictionHorizon(this.playoutDelayMs),
      );
      // Maç sonu kartı girişi: durum MATCH_OVER'a ilk düştüğünde damgala.
      // gameState sunum tahmininden etkilenmez; ham örnekten okunur.
      if (sample.frame.gameState === 'MATCH_OVER') {
        if (!this._matchOverAt) this._matchOverAt = now;
        this.matchOverEnter = Math.min(1, (now - this._matchOverAt) / MATCH_OVER_ENTER_MS);
      } else if (this._matchOverAt) {
        this._matchOverAt = 0;
        this.matchOverEnter = 1;
      }
      const renderContext = this._renderContext;
      renderContext.selfSlot = this.selfSlot;
      renderContext.roundGap = this.roundGapSeconds;
      renderContext.matchOverEnter = this.matchOverEnter;
      renderContext.fx = this.fxLive ? this.fxLayer() : null;
      this.renderer.render(
        this.ctx,
        presentedFrame,
        this.logicalWidth,
        this.logicalHeight,
        this.slots,
        now,
        renderContext,
      );
      this.stats.lastRenderMs = performance.now() - renderStarted;
      perfMonitor.record('client.render', this.stats.lastRenderMs);
      perfMonitor.gauge('client.playout', this.playoutDelayMs);
      perfMonitor.gauge('client.jitter', this.jitterMs);
      perfMonitor.gauge('client.frameAge', this.stats.lastFrameAgeMs);
      // Tanı kuyruğu (perf HUD, kumanda sayfasında `?perf`): kare düşüşü,
      // jitter buffer derinliği ve ölçülen gönderim aralığı — "kasma" nın
      // ağ (#1/#4/#5) mı çizim (#3/#6) mı olduğunu tek oturumda ayrıştırır.
      perfMonitor.gauge('client.dropped', this.stats.droppedFrames);
      perfMonitor.gauge('client.accepted', this.stats.acceptedFrames);
      perfMonitor.gauge('client.buffer', this.buffer.length);
      perfMonitor.gauge('client.interval', this.intervalMs);
      const durBuf = this.renderDurBuf;
      durBuf[this.renderDurHead] = this.stats.lastRenderMs;
      this.renderDurHead = (this.renderDurHead + 1) % durBuf.length;
      if (this.renderDurCount < durBuf.length) this.renderDurCount += 1;
    } catch (err) {
      // Kare başına log telefon konsolunu dolduruyordu: ilk hatayı ve her 60.'ı yaz.
      this.renderFailures += 1;
      if (this.renderFailures === 1 || this.renderFailures % 60 === 0) {
        console.warn('[GamepadWorldView] Frame render hatası:', err);
      }
      this.frame = null;
      this._clearBuffer();
      this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      // Döngüyü burada durdurmak canvas'ı kalan placeholder'da kalıcı olarak
      // donduruyordu (beyaz ekran). Yeni kare gelince sunum kendi toparlanır.
      this._queueRender();
      return;
    }

    // Keep one uninterrupted presentation loop while a world is mounted.
    // This gives the canvas a real display-refresh cadence between 30 Hz
    // snapshots instead of starting/stopping rAF for every packet.
    this._queueRender();
  }

  /** Ekran-uzayı flaş katmanı (yalnız çerçevesiz degrade yolunda çağrılır). */
  _drawFlashOverlay() {
    if (!this.fxLive) return;
    const alpha = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    if (alpha > 0) drawFxFlash(this.ctx, this.logicalWidth, this.logicalHeight, alpha);
  }

  _checkStale() {
    if (this.destroyed || !this.frame || performance.now() - this.lastFrameAt < STALE_AFTER_MS) return;
    if (this.isStale) return;
    this.isStale = true;
    this._queueRender();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    clearInterval(this.staleTimer);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this._resize);
    this.frame = null;
    this.prevFrame = null;
    this.buffer.length = 0;
    this.renderDurCount = 0;
    this.renderDurHead = 0;
    this.renderer = null;
  }
}
