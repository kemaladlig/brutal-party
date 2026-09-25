// Generic phone-side world frame presenter. It stores authoritative snapshots,
// presents them through a small jitter buffer, and draws with requestAnimationFrame.
// It never advances game simulation.

import {
  blendWorldFrames,
  canBlendWorldFrames,
  selectBufferedWorldFrame,
} from '../core/worldInterpolation.js';

export { blendWorldFrames };

const STALE_AFTER_MS = 1500;
const DEFAULT_INTERVAL_MS = 1000 / 30;
const MIN_INTERVAL_MS = 25;
const MAX_INTERVAL_MS = 250;
const DEFAULT_PLAYOUT_DELAY_MS = 50;
const MIN_PLAYOUT_DELAY_MS = 50;
const MAX_PLAYOUT_DELAY_MS = 120;
const MAX_BUFFER_FRAMES = 8;
const MAX_INTERPOLATION_GAP_MS = 100;

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
    this.interpolate = typeof renderer?.interpolate === 'function'
      ? renderer.interpolate.bind(renderer)
      : blendWorldFrames;
    this.slots = slots;
    this.selfSlot = Number.isInteger(selfSlot) ? selfSlot : -1;

    // `frame` is the newest accepted snapshot. `buffer` contains the samples
    // used by the delayed presenter; it is intentionally separate from frame.
    this.frame = null;
    this.prevFrame = null;
    this.buffer = [];
    this.prevAt = 0;
    this.currAt = 0;
    this.intervalMs = DEFAULT_INTERVAL_MS;
    this.jitterMs = 0;
    this.playoutDelayMs = DEFAULT_PLAYOUT_DELAY_MS;
    this.lastReceiveAt = 0;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.isStale = false;
    this.renderDurations = [];
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

    this.prevFrame = previousFrame;
    this.prevAt = this.currAt || now;
    this.currAt = now;
    this.frame = frame;
    this.lastReceiveAt = now;
    this.lastSeq = frame.seq;
    this.lastFrameAt = now;
    this.isStale = false;
    this.stats.acceptedFrames += 1;
    this._updateSourceClock(frame.sentAt, now);
    this._queueRender();
    return true;
  }

  reset() {
    this._clearBuffer();
    this.frame = null;
    this.prevFrame = null;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.isStale = false;
    this._queueRender();
  }

  getStats() {
    const sortedRenderDurations = [...this.renderDurations].sort((a, b) => a - b);
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

  _sampleAt(now) {
    let samples = this.buffer;
    const hasSourceClock = this.buffer.length > 1
      && this.buffer.every((sample) => sample.sentAt !== null);
    if (hasSourceClock) {
      // `sentAt` is on the host's monotonic clock. Align the newest sample to
      // local receive time, then interpolate on the host's send cadence rather
      // than on network arrival jitter. Old clients without sentAt use receive
      // time directly.
      const latest = this.buffer[this.buffer.length - 1];
      const sourceOffset = latest.receivedAt - latest.sentAt;
      samples = this.buffer.map((sample) => ({
        ...sample,
        playbackAt: sample.sentAt + sourceOffset,
      }));
    }

    return selectBufferedWorldFrame(
      samples,
      now - this.playoutDelayMs,
      MAX_INTERPOLATION_GAP_MS,
      this.interpolate,
    );
  }

  _resize() {
    if (this.destroyed) return;
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
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
    this.ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);

    if (!this.frame) {
      this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      return;
    }

    if (this.isStale) {
      this.renderer.renderStale?.(this.ctx, this.logicalWidth, this.logicalHeight);
      return;
    }

    const sample = this._sampleAt(now);
    if (!sample) {
      this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      return;
    }

    try {
      const renderStarted = performance.now();
      this.stats.lastAlpha = sample.alpha;
      this.stats.lastFrameAgeMs = now - sample.after.receivedAt;
      this.renderer.render(
        this.ctx,
        sample.frame,
        this.logicalWidth,
        this.logicalHeight,
        this.slots,
        now,
        this.selfSlot,
      );
      this.stats.lastRenderMs = performance.now() - renderStarted;
      this.renderDurations.push(this.stats.lastRenderMs);
      if (this.renderDurations.length > 120) this.renderDurations.shift();
    } catch (err) {
      console.warn('[GamepadWorldView] Frame render hatası:', err);
      this.frame = null;
      this._clearBuffer();
      this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      return;
    }

    // Keep one uninterrupted presentation loop while a world is mounted.
    // This gives the canvas a real display-refresh cadence between 30 Hz
    // snapshots instead of starting/stopping rAF for every packet.
    this._queueRender();
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
    this.renderDurations.length = 0;
    this.renderer = null;
  }
}
