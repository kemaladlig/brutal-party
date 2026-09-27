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

test('quick tap declares tap, drag and long press do not', async () => {
  const restore = installPointerWindow();
  try {
    const zone = new FakeElement();
    const packets = [];
    const controller = new TwinStickAimController({
      zoneEl: zone,
      knobEl: new FakeElement(),
      onPress: (input) => packets.push({ type: 'press', input }),
      onMove: (input) => packets.push({ type: 'move', input }),
      onRelease: (input, meta) => packets.push({ type: 'release', input, meta }),
    });

    zone.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 120, button: 0 });
    window.dispatch('pointerup', { pointerId: 1, clientX: 122, clientY: 121 });
    assert.equal(packets.at(-1).meta.tap, true);

    packets.length = 0;
    zone.dispatch('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 120, clientY: 120, button: 0 });
    window.dispatch('pointermove', { pointerId: 2, clientX: 180, clientY: 120 });
    window.dispatch('pointerup', { pointerId: 2, clientX: 180, clientY: 120 });
    assert.equal(packets.at(-1).meta.tap, false);

    packets.length = 0;
    zone.dispatch('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 120, clientY: 120, button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 240));
    window.dispatch('pointerup', { pointerId: 3, clientX: 120, clientY: 120 });
    assert.equal(packets.at(-1).meta.tap, false);

    packets.length = 0;
    zone.dispatch('pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 120, clientY: 120, button: 0 });
    window.dispatch('pointercancel', { pointerId: 4 });
    assert.equal(packets.at(-1).meta.tap, false);
    assert.equal(packets.at(-1).meta.cancelled, true);
    controller.destroy();
  } finally {
    restore();
  }
});
