// Production twin-stick aim surface. It only produces canonical transport
// packets; attack policy remains authoritative in the game engine.

const MIN_RADIUS = 44;
const MAX_RADIUS = 64;
const DEADZONE = 0.1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class TwinStickAimController {
  constructor({
    zoneEl,
    knobEl,
    baseEl = null,
    onPress,
    onMove,
    onRelease,
    vibrate = () => {},
    signal = null,
  }) {
    this.zone = zoneEl;
    this.knob = knobEl;
    this.base = baseEl;
    this.onPress = onPress;
    this.onMove = onMove;
    this.onRelease = onRelease;
    this.vibrate = vibrate;
    this.externalSignal = signal;
    this.abortController = new AbortController();
    this.externalAbortHandler = null;

    this.activePointerId = null;
    this.activeTouchId = null;
    this.pointerMode = typeof window !== 'undefined' && 'PointerEvent' in window;
    this.originX = 0;
    this.originY = 0;
    this.maxRadius = 54;
    this.lastInput = { dx: 0, dy: 0, angle: 0, force: 0, aimHeld: false };
    this.heartbeatTimer = null;
    this.destroyed = false;

    this.bind();
    if (signal) {
      this.externalAbortHandler = () => this.destroy();
      if (signal.aborted) this.destroy();
      else signal.addEventListener('abort', this.externalAbortHandler, { once: true });
    }
  }

  bind() {
    if (!this.zone) return;
    if (this.pointerMode) this.bindPointer();
    else this.bindTouch();
  }

  start(clientX, clientY) {
    if (this.destroyed || this.activePointerId !== null || this.activeTouchId !== null) return false;
    const rect = this.zone.getBoundingClientRect();
    const shortSide = Math.min(rect.width || 54, rect.height || 54);
    this.originX = clientX;
    this.originY = clientY;
    this.maxRadius = clamp(shortSide * 0.24, MIN_RADIUS, MAX_RADIUS);
    this.lastInput = { dx: 0, dy: 0, angle: 0, force: 0, aimHeld: true };
    this.positionBase(clientX, clientY, rect);
    this.base?.classList.add('aim-held');
    this.updateKnob(0, 0, 0);
    this.vibrate(10);
    this.onPress?.({ ...this.lastInput });
    this.startHeartbeat();
    return true;
  }

  move(clientX, clientY) {
    if (this.destroyed || (this.activePointerId === null && this.activeTouchId === null)) return;
    const rawDx = clientX - this.originX;
    const rawDy = clientY - this.originY;
    const distance = Math.hypot(rawDx, rawDy);
    const clampedDistance = Math.min(distance, this.maxRadius);
    const angle = distance > 0.001 ? Math.atan2(rawDy, rawDx) : this.lastInput.angle;
    const rawForce = clampedDistance / this.maxRadius;
    const force = rawForce < DEADZONE
      ? 0
      : clamp((rawForce - DEADZONE) / (1 - DEADZONE), 0, 1);
    const input = {
      dx: Math.cos(angle) * force,
      dy: Math.sin(angle) * force,
      angle,
      force,
      aimHeld: true,
    };
    this.lastInput = input;
    this.updateKnob(clampedDistance, angle);
    this.base?.classList.toggle('aim-active', force >= 0.08);
    this.onMove?.({ ...input });
  }

  finish(cancelled = false) {
    if (this.activePointerId === null && this.activeTouchId === null) return false;
    const finalInput = {
      ...this.lastInput,
      dx: cancelled ? 0 : this.lastInput.dx,
      dy: cancelled ? 0 : this.lastInput.dy,
      force: cancelled ? 0 : this.lastInput.force,
      aimHeld: false,
    };
    this.activePointerId = null;
    this.activeTouchId = null;
    this.stopHeartbeat();
    this.clearVisual();
    this.onRelease?.(finalInput, { cancelled });
    return true;
  }

  updateKnob(distance, angle) {
    if (!this.knob) return;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    this.knob.style.transform = `translate(${x}px, ${y}px) rotate(${angle + Math.PI / 2}rad)`;
  }

  positionBase(clientX, clientY, rect = this.zone?.getBoundingClientRect()) {
    if (!this.base || !rect) return;
    this.base.classList.add('floating');
    this.base.style.left = `${clientX - rect.left}px`;
    this.base.style.top = `${clientY - rect.top}px`;
  }

  clearVisual() {
    if (this.base) {
      this.base.classList.remove('floating', 'aim-held', 'aim-active');
      this.base.style.left = '';
      this.base.style.top = '';
    }
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px) rotate(0rad)';
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed || (this.activePointerId === null && this.activeTouchId === null)) return;
      this.onMove?.({ ...this.lastInput, aimHeld: true }, { keepalive: true });
    }, 200);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  bindPointer() {
    const signal = this.abortController.signal;
    this.zone.addEventListener('pointerdown', (event) => {
      if (this.destroyed || this.activePointerId !== null) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      try { this.zone.setPointerCapture?.(event.pointerId); } catch {}
      if (this.start(event.clientX, event.clientY) && !this.destroyed) {
        this.activePointerId = event.pointerId;
      }
    }, { passive: false });

    window.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.activePointerId) return;
      event.preventDefault();
      this.move(event.clientX, event.clientY);
    }, { passive: false, signal });

    const endPointer = (event, cancelled) => {
      if (event.pointerId !== this.activePointerId) return;
      if (!cancelled) this.move(event.clientX, event.clientY);
      this.finish(cancelled);
      try { this.zone.releasePointerCapture?.(event.pointerId); } catch {}
    };
    window.addEventListener('pointerup', (event) => endPointer(event, false), { passive: true, signal });
    window.addEventListener('pointercancel', (event) => endPointer(event, true), { passive: true, signal });
    this.zone.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId === this.activePointerId) this.finish(true);
    }, { passive: true });
  }

  bindTouch() {
    const signal = this.abortController.signal;
    this.zone.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches[0];
      if (!touch || this.destroyed || this.activeTouchId !== null) return;
      event.preventDefault();
      if (this.start(touch.clientX, touch.clientY) && !this.destroyed) {
        this.activeTouchId = touch.identifier;
      }
    }, { passive: false });

    window.addEventListener('touchmove', (event) => {
      if (this.activeTouchId === null) return;
      for (const touch of event.changedTouches) {
        if (touch.identifier !== this.activeTouchId) continue;
        event.preventDefault();
        this.move(touch.clientX, touch.clientY);
        break;
      }
    }, { passive: false, signal });

    const endTouch = (event, cancelled) => {
      if (this.activeTouchId === null) return;
      const touch = [...event.changedTouches].find((candidate) => candidate.identifier === this.activeTouchId);
      if (!touch && !cancelled && event.touches?.length) return;
      if (touch && !cancelled) this.move(touch.clientX, touch.clientY);
      this.finish(cancelled);
    };
    window.addEventListener('touchend', (event) => endTouch(event, false), { passive: true, signal });
    window.addEventListener('touchcancel', (event) => endTouch(event, true), { passive: true, signal });
  }

  destroy() {
    if (this.destroyed) return;
    this.finish(true);
    this.destroyed = true;
    this.stopHeartbeat();
    this.abortController.abort();
    if (this.externalSignal && this.externalAbortHandler) {
      this.externalSignal.removeEventListener?.('abort', this.externalAbortHandler);
    }
  }
}
