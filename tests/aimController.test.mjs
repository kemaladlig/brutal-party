import test from 'node:test';
import assert from 'node:assert/strict';
import { TwinStickAimController } from '../src/controllers/aimController.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force === undefined) {
      if (this.values.has(name)) this.values.delete(name);
      else this.values.add(name);
    } else if (force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.style = {};
    this.classList = new FakeClassList();
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler({ preventDefault() {}, ...event });
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 240, height: 240 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function installPointerWindow() {
  const previous = globalThis.window;
  const listeners = new Map();
  globalThis.window = {
    PointerEvent: class PointerEvent {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) handler({ preventDefault() {}, ...event });
    },
  };
  return () => { globalThis.window = previous; };
}

test('twin-stick aim sends a real final vector and does not cancel on recenter', () => {
  const restore = installPointerWindow();
  try {
    const zone = new FakeElement();
    const knob = new FakeElement();
    const base = new FakeElement();
    const packets = [];
    const controller = new TwinStickAimController({
      zoneEl: zone,
      knobEl: knob,
      baseEl: base,
      onPress: (input) => packets.push({ type: 'press', input }),
      onMove: (input) => packets.push({ type: 'move', input }),
      onRelease: (input, meta) => packets.push({ type: 'release', input, meta }),
    });

    zone.dispatch('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 120, clientY: 120, button: 0 });
    window.dispatch('pointermove', { pointerId: 7, clientX: 170, clientY: 120 });
    window.dispatch('pointermove', { pointerId: 7, clientX: 120, clientY: 120 });
    window.dispatch('pointerup', { pointerId: 7, clientX: 120, clientY: 120 });

    assert.equal(packets[0].type, 'press');
    assert.equal(packets.at(-1).type, 'release');
    assert.equal(packets.at(-1).meta.cancelled, false);
    assert.equal(packets.some((packet) => packet.type === 'move' && packet.input.force > 0), true);
    assert.equal(packets.at(-1).input.aimHeld, false);
    controller.destroy();
  } finally {
    restore();
  }
});
