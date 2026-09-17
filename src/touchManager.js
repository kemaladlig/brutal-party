// Universal Multi-Touch Manager for Local Party Games Suite
// Supports multi-touch finger tracking, 1D dragging, and 1-touch corner hold/release

export class TouchManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.activeHandler = null; // Can be PongGame or TanksGame

    // Map: touch.identifier -> { id, x, y, startX, startY, startTime }
    this.activeTouches = new Map();

    // Mouse fallback tracking
    this.isMouseDown = false;
    this.mouseId = 'mouse';

    this.rect = null;
    this.updateRect();
    window.addEventListener('resize', () => this.updateRect());
    window.addEventListener('scroll', () => this.updateRect(), { passive: true });

    this.initListeners();
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
    if (!this.rect) this.updateRect();
    const rect = this.rect;
    const scaleX = this.canvas.width / (rect.width || 1);
    const scaleY = this.canvas.height / (rect.height || 1);

    // Convert to CSS logical coordinates (matching context scaling)
    const rawX = (clientX - rect.left) * scaleX;
    const rawY = (clientY - rect.top) * scaleY;

    // Returns logical canvas coordinates
    return {
      x: rawX / (window.devicePixelRatio || 1),
      y: rawY / (window.devicePixelRatio || 1),
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
      this.activeTouches.set(t.identifier, touchData);

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
    this.activeTouches.set(this.mouseId, touchData);

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
}
