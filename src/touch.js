// Touch & Input Manager with Multi-Touch Identifier Locking

export class InputManager {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;

    // Assigned touch identifier for each player (0: Bottom, 1: Top, 2: Left, 3: Right)
    this.playerTouchIds = [-1, -1, -1, -1];
    this.mouseControlPlayer = 0; // Default mouse controls Bottom player
    this.isMouseDown = false;

    this.initListeners();
  }

  getCanvasCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const logicalW = window.innerWidth;
    const logicalH = window.innerHeight;
    const scaleX = rect.width > 0 ? logicalW / rect.width : 1;
    const scaleY = rect.height > 0 ? logicalH / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  initListeners() {
    // Prevent default touch behaviors (zoom, scroll, refresh)
    const passiveOpts = { passive: false };

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), passiveOpts);
    this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), passiveOpts);
    this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), passiveOpts);
    this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), passiveOpts);

    // Mouse fallback for desktop testing
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
  }

  // Determine which player's zone a canvas point belongs to
  getPlayerZoneAt(point) {
    const { arena } = this.game;
    if (!arena) return -1;

    const cx = arena.cx;
    const cy = arena.cy;
    const dx = point.x - cx;
    const dy = point.y - cy;

    // Diagonal quadrant split:
    // If |dy| >= |dx|: Top or Bottom
    // If |dx| > |dy|: Left or Right
    if (Math.abs(dy) >= Math.abs(dx)) {
      return dy > 0 ? 0 : 1; // 0: Bottom, 1: Top
    } else {
      return dx < 0 ? 2 : 3; // 2: Left, 3: Right
    }
  }

  handleTouchStart(e) {
    e.preventDefault();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      const pos = this.getCanvasCoords(touch.clientX, touch.clientY);

      // Handle UI interactions (Lobby Join / Start / Restart)
      const handled = this.game.handleUiTap(pos);
      if (handled) continue;

      // In Gameplay: determine zone and lock touch.identifier
      if (this.game.state === 'PLAYING') {
        const playerIndex = this.getPlayerZoneAt(pos);
        if (playerIndex !== -1 && this.game.isPlayerActive(playerIndex)) {
          // Lock finger to this player
          this.playerTouchIds[playerIndex] = touch.identifier;
          this.updatePaddlePosition(playerIndex, pos);
        }
      }
    }
  }

  handleTouchMove(e) {
    e.preventDefault();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      const pos = this.getCanvasCoords(touch.clientX, touch.clientY);

      // Route touch strictly to the locked player, even if finger dragged into another zone!
      for (let p = 0; p < 4; p++) {
        if (this.playerTouchIds[p] === touch.identifier) {
          this.updatePaddlePosition(p, pos);
          break;
        }
      }
    }
  }

  handleTouchEnd(e) {
    e.preventDefault();
    const touches = e.changedTouches;

    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      for (let p = 0; p < 4; p++) {
        if (this.playerTouchIds[p] === touch.identifier) {
          this.playerTouchIds[p] = -1;
          break;
        }
      }
    }
  }

  handleMouseDown(e) {
    const pos = this.getCanvasCoords(e.clientX, e.clientY);
    const handled = this.game.handleUiTap(pos);
    if (handled) return;

    if (this.game.state === 'PLAYING') {
      this.isMouseDown = true;
      const playerIndex = this.getPlayerZoneAt(pos);
      if (playerIndex !== -1 && this.game.isPlayerActive(playerIndex)) {
        this.mouseControlPlayer = playerIndex;
        this.updatePaddlePosition(playerIndex, pos);
      }
    }
  }

  handleMouseMove(e) {
    if (!this.isMouseDown || this.game.state !== 'PLAYING') return;
    const pos = this.getCanvasCoords(e.clientX, e.clientY);
    this.updatePaddlePosition(this.mouseControlPlayer, pos);
  }

  handleMouseUp() {
    this.isMouseDown = false;
  }

  updatePaddlePosition(playerIndex, pos) {
    const paddle = this.game.paddles[playerIndex];
    if (!paddle) return;

    if (paddle.axis === 'horizontal') {
      // Bottom or Top players follow X coordinate
      paddle.setTarget(pos.x);
    } else {
      // Left or Right players follow Y coordinate
      paddle.setTarget(pos.y);
    }
  }

  resetTouches() {
    this.playerTouchIds = [-1, -1, -1, -1];
    this.isMouseDown = false;
  }
}
