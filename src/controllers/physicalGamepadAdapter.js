// Optional secondary input source for the browser Gamepad API.
// It never becomes authoritative: it only emits the same transport packets as
// the phone controller, and the host router/engine remains authoritative.

import { getNeutralInputs } from './controlDefs.js';
import { GamepadInputAdapter } from './gamepadInputAdapter.js';

const DEFAULT_DEADZONE = 0.18;
// Host'un analog sessizlik süpürücüsü 1500 ms sonra basılı yönü sıfırlar; tutulan
// yön bu aralıkta tekrarlanmalı (telefon kumandası `controllerTemplates.js` ile aynı).
const STEER_KEEPALIVE_MS = 250;

function clamp(value, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function axisValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function buttonValue(pad, index) {
  const button = pad?.buttons?.[index];
  if (typeof button === 'number') return button;
  if (typeof button?.value === 'number') return button.value;
  return button?.pressed ? 1 : 0;
}

export class PhysicalGamepadAdapter {
  constructor({
    send,
    getMode,
    getDescriptor,
    isBlocked = () => false,
    getGamepads = () => globalThis.navigator?.getGamepads?.() || [],
    now = () => performance.now(),
    schedule = (callback) => globalThis.requestAnimationFrame?.(callback) ?? setTimeout(callback, 16),
    cancel = (handle) => globalThis.cancelAnimationFrame?.(handle) ?? clearTimeout(handle),
    deadzone = DEFAULT_DEADZONE,
  } = {}) {
    this.send = send;
    this.getMode = getMode;
    this.getDescriptor = getDescriptor;
    this.isBlocked = isBlocked;
    this.getGamepads = getGamepads;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.deadzone = deadzone;
    this.analog = new GamepadInputAdapter(send, { now });
    this.running = false;
    this.handle = null;
    this.padIndex = null;
    this.previous = this.emptyState();
  }

  static isSupported(getGamepads = () => globalThis.navigator?.getGamepads?.()) {
    try {
      return typeof getGamepads === 'function' && Array.isArray(getGamepads());
    } catch {
      return false;
    }
  }

  emptyState() {
    return {
      dir: 0,
      dirSentAt: 0,
      driving: false,
      position: 0.5,
      primaryDown: false,
      actionId: null,
      activeActions: [],
      mode: null,
      vectorActive: false,
      aimActive: false,
      aimVector: { dx: 0, dy: 0, angle: 0, force: 0 },
      blocked: false,
      padAvailable: false,
    };
  }

  start() {
    if (this.running) return true;
    if (!PhysicalGamepadAdapter.isSupported(this.getGamepads)) return false;
    this.running = true;
    this.previous = this.emptyState();
    this.analog.reset();
    this.handle = this.schedule(() => this.tick());
    return true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
    this.releaseAim(true);
    this.releasePrimary();
    this.sendNeutral();
    this.padIndex = null;
    this.previous = this.emptyState();
    this.analog.reset();
  }

  sendNeutral() {
    for (const neutral of getNeutralInputs(this.getMode())) this.send(neutral);
  }

  findPad() {
    const pads = this.getGamepads() || [];
    for (let index = 0; index < pads.length; index += 1) {
      const pad = pads[index];
      if (pad?.connected) return { pad, index };
    }
    return null;
  }

  readDirection(pad) {
    const dpad = Number(buttonValue(pad, 15)) - Number(buttonValue(pad, 14));
    if (dpad !== 0) return dpad;
    const x = axisValue(pad?.axes?.[0]);
    return Math.abs(x) < this.deadzone ? 0 : Math.sign(x);
  }

  readAxis(pad) {
    const rawX = axisValue(pad?.axes?.[0]);
    const rawY = axisValue(pad?.axes?.[1]);
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude < this.deadzone) return { dx: 0, dy: 0, angle: 0, force: 0 };
    const force = Math.min(1, (magnitude - this.deadzone) / (1 - this.deadzone));
    return {
      dx: clamp((rawX / magnitude) * force),
      dy: clamp((-rawY / magnitude) * force),
      angle: Math.atan2(-rawY, rawX),
      force,
    };
  }

  readAimAxis(pad) {
    const rawX = axisValue(pad?.axes?.[2]);
    const rawY = axisValue(pad?.axes?.[3]);
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude < this.deadzone) return { dx: 0, dy: 0, angle: 0, force: 0 };
    const force = Math.min(1, (magnitude - this.deadzone) / (1 - this.deadzone));
    return {
      dx: clamp((rawX / magnitude) * force),
      dy: clamp((-rawY / magnitude) * force),
      angle: Math.atan2(-rawY, rawX),
      force,
    };
  }

  emitAction(action, payload = {}) {
    if (action) this.send({ action, ...payload });
  }

  releasePrimary() {
    for (const active of this.previous.activeActions) {
      const action = active.action;
      const releaseAction = action.releaseAction
        || (action.transportActions?.length > 1 ? action.transportActions.at(-1) : null);
      this.emitAction(releaseAction);
    }
    this.previous.activeActions = [];
    this.previous.primaryDown = false;
    this.previous.actionId = null;
  }

  releaseAim(cancelled = true) {
    if (this.previous.aimActive) {
      this.emitAction('AIM_RELEASE', {
        ...this.previous.aimVector,
        aimHeld: false,
        ...(cancelled ? { cancelled: true } : {}),
      });
    }
    this.previous.aimActive = false;
    this.previous.aimVector = { dx: 0, dy: 0, angle: 0, force: 0 };
  }

  updatePrimary(pad, descriptor) {
    const phoneActions = descriptor?.phone?.actions || [];
    for (let index = 0; index < phoneActions.length; index += 1) {
      const action = descriptor.network?.actions?.find((candidate) => candidate.id === phoneActions[index].id);
      if (!action) continue;
      const down = buttonValue(pad, index) > 0.5;
      const activeIndex = this.previous.activeActions.findIndex((entry) => entry.index === index);
      if (down && activeIndex < 0) {
        this.emitAction(action.transportActions?.[0]);
        this.previous.activeActions.push({ index, action });
        this.previous.primaryDown = true;
        this.previous.actionId = action;
      } else if (!down && activeIndex >= 0) {
        const [active] = this.previous.activeActions.splice(activeIndex, 1);
        const releaseAction = active.action.transportActions?.length > 1
          ? (active.action.releaseAction || active.action.transportActions.at(-1))
          : null;
        this.emitAction(releaseAction);
        if (this.previous.activeActions.length === 0) {
          this.previous.primaryDown = false;
          this.previous.actionId = null;
        }
      }
    }
  }

  updateDiscrete(pad, descriptor) {
    const left = descriptor?.phone?.left;
    if (left === 'steer') {
      const dir = this.readDirection(pad);
      const action = this.getMode() === 'SNAKE' ? 'SNAKE_STEER' : 'CURVE_STEER';
      if (dir !== this.previous.dir) {
        this.emitAction(action, { dir });
        this.previous.dir = dir;
        this.previous.dirSentAt = 0;
      } else if (dir !== 0) {
        // Basılı yön keepalive'i: host'un analog sessizlik süpürücüsü (1500 ms)
        // basılı yönü sıfırlıyor, fiziksel kumandada da aynı beliri oluyordu.
        const now = performance.now();
        if (now - (this.previous.dirSentAt || 0) >= STEER_KEEPALIVE_MS) {
          this.emitAction(action, { dir });
          this.previous.dirSentAt = now;
        }
      }
    } else if (left === 'pedal') {
      const driving = buttonValue(pad, 6) > 0.5;
      if (driving !== this.previous.driving) {
        this.emitAction('TANK_DRIVE', { driving });
        this.previous.driving = driving;
      }
    } else if (left === 'slider') {
      const direction = this.readDirection(pad);
      if (direction !== 0) {
        this.previous.position = clamp(this.previous.position + direction * 0.08, 0, 1);
        this.analog.sendAnalog({ action: 'PADDLE_MOVE', position: this.previous.position });
      }
    } else {
      const vector = this.readAxis(pad);
      if (vector.force > 0 || this.previous.vectorActive) {
        this.analog.sendAnalog({ action: 'JOYSTICK_MOVE', ...vector });
      }
      this.previous.vectorActive = vector.force > 0;
      if (descriptor.phone?.aim) {
        const aim = this.readAimAxis(pad);
        const aimActive = aim.force > 0;
        if (aimActive || this.previous.aimActive) {
          this.analog.sendAnalog({
            action: 'AIM_MOVE',
            ...aim,
            aimHeld: aimActive || this.previous.aimActive,
          });
        }
        if (aimActive) {
          this.previous.aimVector = { ...aim };
          if (!this.previous.aimActive) this.emitAction('AIM_PRESS', { ...aim, aimHeld: true });
        } else if (this.previous.aimActive) {
          this.releaseAim(false);
        }
        this.previous.aimActive = aimActive;
      } else {
        this.releaseAim(true);
      }
    }
    this.updatePrimary(pad, descriptor);
  }

  poll() {
    if (!this.running) return false;
    const mode = this.getMode();
    const descriptor = this.getDescriptor();
    if (this.previous.mode !== mode) {
      this.releaseAim(true);
      this.releasePrimary();
      this.previous.mode = mode;
      this.previous.dir = 0;
      this.previous.dirSentAt = 0;
      this.previous.driving = false;
      this.previous.vectorActive = false;
      this.previous.aimActive = false;
    }
    if (!descriptor || mode === 'LOBBY' || this.isBlocked()) {
      if (!this.previous.blocked) {
        this.releaseAim(true);
        this.releasePrimary();
        this.sendNeutral();
      }
      this.previous.blocked = true;
      this.previous.padAvailable = false;
      this.previous.dir = 0;
      this.previous.dirSentAt = 0;
      this.previous.driving = false;
      this.previous.vectorActive = false;
      this.previous.aimActive = false;
      this.analog.reset();
      return true;
    }

    const found = this.findPad();
    if (!found) {
      if (this.previous.padAvailable) {
        this.releaseAim(true);
        this.releasePrimary();
        this.sendNeutral();
      }
      this.previous.padAvailable = false;
      this.previous.blocked = false;
      this.previous.vectorActive = false;
      this.previous.aimActive = false;
      this.analog.reset();
      return true;
    }
    this.previous.blocked = false;
    this.previous.padAvailable = true;
    this.padIndex = found.index;
    this.updateDiscrete(found.pad, descriptor);
    return true;
  }

  tick() {
    if (!this.running) return;
    this.handle = null;
    this.poll();
    if (this.running) this.handle = this.schedule(() => this.tick());
  }
}
