// Generic phone-side world frame presenter. It stores snapshots and draws
// them; it never advances game simulation.
//
// 30 Hz host snapshot'ları 60 Hz hissi için tek merkezde interpole edilir:
// son iki kare tutulur, yeni kare anında prev gösterilip beklenen aralığa
// (EMA ~33ms) yayılan lineer blend ile curr'a yürünür. Kayıpta clamp (t=1)
// donar, extrapolasyon yok — duvar içinden geçme olmaz. Oyun bazlı kod yok,
// renderer imzası değişmez.

const STALE_AFTER_MS = 1500;
const DEFAULT_INTERVAL_MS = 1000 / 30;
const MIN_INTERVAL_MS = 25;
const MAX_INTERVAL_MS = 250;

const finiteNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function lerpAngleRad(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function blendPointArrays(prevTrail, currTrail, t) {
  if (!Array.isArray(currTrail)) return currTrail;
  if (!Array.isArray(prevTrail) || prevTrail.length === 0) return currTrail;
  const out = new Array(currTrail.length);
  for (let i = 0; i < currTrail.length; i += 1) {
    const cp = currTrail[i];
    const pp = prevTrail[i];
    const cx = Array.isArray(cp) ? finiteNum(cp[0]) : null;
    const cy = Array.isArray(cp) ? finiteNum(cp[1]) : null;
    const px = Array.isArray(pp) ? finiteNum(pp[0]) : null;
    const py = Array.isArray(pp) ? finiteNum(pp[1]) : null;
    if (cx === null || cy === null || px === null || py === null) {
      out[i] = cp;
    } else {
      out[i] = [lerp(px, cx, t), lerp(py, cy, t)];
    }
  }
  return out;
}

function blendPlayers(prevPlayers, currPlayers, t) {
  if (!Array.isArray(currPlayers)) return currPlayers;
  if (!Array.isArray(prevPlayers) || prevPlayers.length === 0) return currPlayers;
  const prevBySlot = new Map();
  for (const p of prevPlayers) {
    if (p && Number.isInteger(p.slot)) prevBySlot.set(p.slot, p);
  }
  return currPlayers.map((cp) => {
    if (!cp || !Number.isInteger(cp.slot)) return cp;
    const pp = prevBySlot.get(cp.slot);
    if (!pp) return cp;
    const cx = finiteNum(cp.x);
    const cy = finiteNum(cp.y);
    const px = finiteNum(pp.x);
    const py = finiteNum(pp.y);
    if (cx === null || cy === null || px === null || py === null) return cp;
    const next = { ...cp, x: lerp(px, cx, t), y: lerp(py, cy, t) };
    const ca = finiteNum(cp.angle);
    const pa = finiteNum(pp.angle);
    if (ca !== null && pa !== null && ca !== pa) next.angle = lerpAngleRad(pa, ca, t);
    if (Array.isArray(cp.trail) && Array.isArray(pp.trail)) {
      next.trail = blendPointArrays(pp.trail, cp.trail, t);
    }
    return next;
  });
}

function blendArrows(prevArrows, currArrows, t) {
  if (!Array.isArray(currArrows)) return currArrows;
  if (!Array.isArray(prevArrows) || prevArrows.length !== currArrows.length) return currArrows;
  let ok = true;
  const out = new Array(currArrows.length);
  for (let i = 0; i < currArrows.length; i += 1) {
    const c = currArrows[i];
    const p = prevArrows[i];
    const cx = Array.isArray(c) ? finiteNum(c[0]) : null;
    const cy = Array.isArray(c) ? finiteNum(c[1]) : null;
    const px = Array.isArray(p) ? finiteNum(p[0]) : null;
    const py = Array.isArray(p) ? finiteNum(p[1]) : null;
    if (cx === null || cy === null || px === null || py === null) {
      ok = false;
      break;
    }
    const blended = [...c];
    blended[0] = lerp(px, cx, t);
    blended[1] = lerp(py, cy, t);
    out[i] = blended;
  }
  return ok ? out : currArrows;
}

function blendBullets(prevBullets, currBullets, t) {
  if (!Array.isArray(currBullets)) return currBullets;
  if (!Array.isArray(prevBullets) || !prevBullets.length) return currBullets;
  const prevById = new Map();
  prevBullets.forEach((bullet, index) => {
    if (!Array.isArray(bullet)) return;
    const id = Number.isInteger(bullet[6]) ? bullet[6] : index;
    prevById.set(id, bullet);
  });
  return currBullets.map((bullet, index) => {
    if (!Array.isArray(bullet)) return bullet;
    const id = Number.isInteger(bullet[6]) ? bullet[6] : index;
    const previous = prevById.get(id);
    if (!previous) return bullet;
    const x = finiteNum(bullet[0]);
    const y = finiteNum(bullet[1]);
    const px = finiteNum(previous[0]);
    const py = finiteNum(previous[1]);
    if (x === null || y === null || px === null || py === null) return bullet;
    const blended = [...bullet];
    blended[0] = lerp(px, x, t);
    blended[1] = lerp(py, y, t);
    return blended;
  });
}

// Prev/curr arası lineer blend. Discrete alanlar (alive, skor, state)
// curr'dan gelir; yalnız sürekli pozisyonlar (oyuncu x/y/angle/trail,
// ok x/y) yumuşatılır. Raunt/state/mode/host değişince snap (curr).
export function blendWorldFrames(prev, curr, t) {
  if (!prev || !curr) return curr;
  const alpha = clamp01(t);
  if (alpha <= 0) return prev;
  if (alpha >= 1) return curr;
  if (
    prev.mode !== curr.mode
    || prev.roundId !== curr.roundId
    || prev.gameState !== curr.gameState
    || (prev.hostId && curr.hostId && prev.hostId !== curr.hostId)
  ) {
    return curr;
  }
  const out = { ...curr };
  if (Array.isArray(prev.players) && Array.isArray(curr.players)) {
    out.players = blendPlayers(prev.players, curr.players, alpha);
  }
  if (Array.isArray(prev.arrows) && Array.isArray(curr.arrows)) {
    out.arrows = blendArrows(prev.arrows, curr.arrows, alpha);
  }
  if (Array.isArray(prev.bullets) && Array.isArray(curr.bullets)) {
    out.bullets = blendBullets(prev.bullets, curr.bullets, alpha);
  }
  return out;
}

export class GamepadWorldView {
  constructor(canvas, renderer, { slots = [], selfSlot = -1 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.renderer = renderer;
    this.slots = slots;
    this.selfSlot = Number.isInteger(selfSlot) ? selfSlot : -1;
    this.frame = null;
    this.prevFrame = null;
    this.prevAt = 0;
    this.currAt = 0;
    this.intervalMs = DEFAULT_INTERVAL_MS;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.rafId = 0;
    this.destroyed = false;
    try {
      this.reduceMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      this.reduceMotion = false;
    }

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
    if (this.destroyed || !frame || typeof this.renderer.validate === 'function' && !this.renderer.validate(frame)) return false;

    if (this.hostId && frame.hostId && frame.hostId !== this.hostId) {
      this.prevFrame = null;
      this.frame = null;
      this.lastSeq = -1;
      this.intervalMs = DEFAULT_INTERVAL_MS;
    }
    if (frame.hostId) this.hostId = frame.hostId;
    if (frame.seq <= this.lastSeq) return false;

    const now = performance.now();
    this.lastSeq = frame.seq;
    if (!this.frame) {
      this.prevFrame = null;
      this.prevAt = now;
    } else {
      this.prevFrame = this.frame;
      this.prevAt = this.currAt || now;
      const delta = now - this.prevAt;
      if (delta > 0 && delta < 1000) {
        this.intervalMs = Math.max(
          MIN_INTERVAL_MS,
          Math.min(MAX_INTERVAL_MS, this.intervalMs * 0.8 + delta * 0.2),
        );
      }
    }
    this.frame = frame;
    this.currAt = now;
    this.lastFrameAt = now;
    this._queueRender();
    return true;
  }

  reset() {
    this.frame = null;
    this.prevFrame = null;
    this.hostId = null;
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.prevAt = 0;
    this.currAt = 0;
    this.intervalMs = DEFAULT_INTERVAL_MS;
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
    if (this.destroyed || this.rafId) return;
    this.rafId = requestAnimationFrame(this._draw);
  }

  _blendAlpha(now) {
    if (this.reduceMotion || !this.prevFrame || !this.frame) return 1;
    if (!this.currAt || this.intervalMs <= 0) return 1;
    return clamp01((now - this.currAt) / this.intervalMs);
  }

  _draw() {
    this.rafId = 0;
    if (this.destroyed) return;
    const now = performance.now();
    this.ctx.setTransform(this.dpr || 1, 0, 0, this.dpr || 1, 0, 0);
    if (this.frame) {
      try {
        const view = this.prevFrame
          ? blendWorldFrames(this.prevFrame, this.frame, this._blendAlpha(now))
          : this.frame;
        this.renderer.render(
          this.ctx,
          view,
          this.logicalWidth,
          this.logicalHeight,
          this.slots,
          now,
          this.selfSlot,
        );
      } catch (err) {
        console.warn('[GamepadWorldView] Frame render hatası:', err);
        this.frame = null;
        this.prevFrame = null;
        this.renderer.renderPlaceholder?.(this.ctx, this.logicalWidth, this.logicalHeight);
      }
      if (!this.reduceMotion && this.prevFrame && this._blendAlpha(performance.now()) < 1) {
        this.rafId = requestAnimationFrame(this._draw);
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
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    clearInterval(this.staleTimer);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this._resize);
    this.frame = null;
    this.prevFrame = null;
    this.renderer = null;
  }
}
