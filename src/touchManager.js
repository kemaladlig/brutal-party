// Universal Multi-Touch Manager for Local Party Games Suite
// Supports multi-touch finger tracking, 1D dragging, and 1-touch corner hold/release
import { checkScoreboardPeekTap } from './ui/hud.js';

export class TouchManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.activeHandler = null; // Can be PongGame or TanksGame

    // Map: touch.identifier -> { id, x, y, startX, startY, startTime }
    this.activeTouches = new Map();

    // Mouse fallback tracking
    this.isMouseDown = false;
    this.mouseId = 'mouse';

    this.logicalWidth = 0;
    this.logicalHeight = 0;
    this.dpr = 1;

    // Visual touch feedback ripples
    this.ripples = [];

    this.initListeners();
  }

  setDimensions(width, height, dpr) {
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.dpr = dpr || Math.min(window.devicePixelRatio || 1, 2.5);
    this.updateRect();
  }

  updateRect() {
    this.rect = this.canvas.getBoundingClientRect();
  }

  setHandler(handler) {
    this.activeHandler = handler;
    this.updateRect();
    this.reset();
  }

  reset() {
    this.activeTouches.clear();
    this.isMouseDown = false;
    if (this.activeHandler && typeof this.activeHandler.onTouchesReset === 'function') {
      this.activeHandler.onTouchesReset();
    }
  }

  resetTouches() {
    this.reset();
  }

  getCanvasCoords(clientX, clientY) {
    // Dynamically retrieve client bounding rect to prevent drift from mobile address bar changes
    const rect = this.canvas.getBoundingClientRect();
    this.rect = rect;

    const logicalW = this.logicalWidth || rect.width || window.innerWidth;
    const logicalH = this.logicalHeight || rect.height || window.innerHeight;

    // Convert client CSS coordinates to canvas logical coordinate space (1:1 with drawing context)
    const scaleX = rect.width > 0 ? logicalW / rect.width : 1;
    const scaleY = rect.height > 0 ? logicalH / rect.height : 1;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  initListeners() {
    const opts = { passive: false };

    // Touch Events
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), opts);
    this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), opts);
    this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), opts);
    this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), opts);

    // Mouse Fallback
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
  }

  handleTouchStart(e) {
    e.preventDefault();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const pos = this.getCanvasCoords(t.clientX, t.clientY);

      const touchData = {
        id: t.identifier,
        x: pos.x,
        y: pos.y,
        startX: pos.x,
        startY: pos.y,
        startTime: performance.now(),
      };

      if (checkScoreboardPeekTap(touchData)) {
        continue;
      }

      this.activeTouches.set(t.identifier, touchData);
      this.addRipple(pos.x, pos.y);

      if (this.activeHandler && typeof this.activeHandler.onTouchStart === 'function') {
        this.activeHandler.onTouchStart(touchData);
      }
    }
  }

  handleTouchMove(e) {
    e.preventDefault();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const pos = this.getCanvasCoords(t.clientX, t.clientY);

      if (this.activeTouches.has(t.identifier)) {
        const touchData = this.activeTouches.get(t.identifier);
        touchData.x = pos.x;
        touchData.y = pos.y;

        if (this.activeHandler && typeof this.activeHandler.onTouchMove === 'function') {
          this.activeHandler.onTouchMove(touchData);
        }
      }
    }
  }

  handleTouchEnd(e) {
    e.preventDefault();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const pos = this.getCanvasCoords(t.clientX, t.clientY);

      if (this.activeTouches.has(t.identifier)) {
        const touchData = this.activeTouches.get(t.identifier);
        touchData.x = pos.x;
        touchData.y = pos.y;

        if (this.activeHandler && typeof this.activeHandler.onTouchEnd === 'function') {
          this.activeHandler.onTouchEnd(touchData);
        }
        this.activeTouches.delete(t.identifier);
      }
    }
  }

  handleMouseDown(e) {
    const pos = this.getCanvasCoords(e.clientX, e.clientY);
    this.isMouseDown = true;

    const touchData = {
      id: this.mouseId,
      x: pos.x,
      y: pos.y,
      startX: pos.x,
      startY: pos.y,
      startTime: performance.now(),
    };

    if (checkScoreboardPeekTap(touchData)) {
      return;
    }

    this.activeTouches.set(this.mouseId, touchData);
    this.addRipple(pos.x, pos.y);

    if (this.activeHandler && typeof this.activeHandler.onTouchStart === 'function') {
      this.activeHandler.onTouchStart(touchData);
    }
  }

  handleMouseMove(e) {
    if (!this.isMouseDown) return;
    const pos = this.getCanvasCoords(e.clientX, e.clientY);

    const touchData = this.activeTouches.get(this.mouseId);
    if (touchData) {
      touchData.x = pos.x;
      touchData.y = pos.y;

      if (this.activeHandler && typeof this.activeHandler.onTouchMove === 'function') {
        this.activeHandler.onTouchMove(touchData);
      }
    }
  }

  handleMouseUp() {
    if (!this.isMouseDown) return;
    this.isMouseDown = false;

    const touchData = this.activeTouches.get(this.mouseId);
    if (touchData) {
      if (this.activeHandler && typeof this.activeHandler.onTouchEnd === 'function') {
        this.activeHandler.onTouchEnd(touchData);
      }
      this.activeTouches.delete(this.mouseId);
    }
  }

  addRipple(x, y) {
    if (this.ripples.length > 12) {
      this.ripples.shift();
    }
    this.ripples.push({
      x,
      y,
      startTime: performance.now(),
      duration: 320,
    });
  }

  renderOverlay(ctx) {
    const now = performance.now();
    ctx.save();

    // 1. Draw crisp brutalist feedback rings around active touching fingers
    for (const [id, t] of this.activeTouches) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, 22, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(28, 28, 26, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(t.x, t.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#1C1C1A';
      ctx.fill();
    }

    // 2. Draw expanding tap ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      const elapsed = now - r.startTime;
      if (elapsed > r.duration) {
        this.ripples.splice(i, 1);
        continue;
      }
      const progress = elapsed / r.duration;
      const radius = 14 + progress * 32;
      const alpha = (1 - progress) * 0.45;

      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(216, 71, 39, ${alpha})`;
      ctx.lineWidth = Math.max(1, 3 * (1 - progress));
      ctx.stroke();
    }

    ctx.restore();
  }
}
