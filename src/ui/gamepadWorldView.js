// Generic phone-side world frame presenter. It stores snapshots and draws
// them; it never advances game simulation.

const STALE_AFTER_MS = 1500;

export class GamepadWorldView {
  constructor(canvas, renderer, { slots = [] } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderer = renderer;
    this.slots = slots;
    this.frame = null;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.renderQueued = false;
    this.destroyed = false;

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

  accept(frame) {
    if (this.destroyed || !frame || typeof this.renderer.validate === 'function' && !this.renderer.validate(frame)) return false;

    if (this.hostId && frame.hostId && frame.hostId !== this.hostId) {
      this.lastSeq = -1;
      this.frame = null;
    }
    if (frame.hostId) this.hostId = frame.hostId;
    if (frame.seq <= this.lastSeq) return false;

    this.lastSeq = frame.seq;
    this.frame = frame;
    this.lastFrameAt = performance.now();
    this._queueRender();
    return true;
  }

  reset() {
    this.frame = null;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this._queueRender();
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
    if (this.destroyed || this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(this._draw);
  }

  _draw() {
    this.renderQueued = false;
    if (this.destroyed) return;
    this.ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    if (this.frame) {
      try {
        this.renderer.render(
          this.ctx,
          this.frame,
          this.logicalWidth,
          this.logicalHeight,
          this.slots,
          performance.now()
        );
      } catch (err) {
        console.warn('[GamepadWorldView] Frame render hatası:', err);
        this.frame = null;
        this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      }
    } else {
      this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
    }
  }

  _checkStale() {
    if (this.destroyed || !this.frame || performance.now() - this.lastFrameAt < STALE_AFTER_MS) return;
    this.ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    this.renderer.renderStale?.(this.ctx, this.logicalWidth, this.logicalHeight);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.staleTimer);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this._resize);
    this.frame = null;
    this.renderer = null;
  }
}
