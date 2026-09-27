// End-to-end producer→host chain for the quick-tap auto-aim gesture:
// TwinStickAimController emits AIM_RELEASE{tap}, the packet survives relay
// validation + intent projection, and the authoritative engine fires toward
// the nearest rival.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { TwinStickAimController } from '../src/controllers/aimController.js';
import { isValidNetworkInput } from '../src/core/networkProtocol.js';
import { normalizeInputIntent } from '../src/core/inputIntent.js';
import { getControlDescriptor } from '../src/core/controlDescriptor.js';
import { GAMEPAD_SCHEMAS } from '../src/controllers/gamepadSchemas.js';

let server;
let ArcherGame;

after(async () => { await server?.close(); });

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((n) => this.values.add(n)); }
  remove(...names) { names.forEach((n) => this.values.delete(n)); }
  toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }
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

test('quick tap travels from phone stick to a host-authoritized auto-aim shot', async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  ({ ArcherGame } = await server.ssrLoadModule('/src/games/archer.js'));
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
  globalThis.document = {
    activeElement: null,
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const descriptor = getControlDescriptor('ARCHER', GAMEPAD_SCHEMAS.ARCHER);

  // Host side: a live ARCHER match with a rival straight above P1.
  const context = new Proxy({
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set(target, key, value) { target[key] = value; return true; },
  });
  const game = new ArcherGame({ width: 800, height: 600, getContext: () => context });
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  const shooter = game.players[0];
  const rival = game.players[1];
  shooter.x = 200;
  shooter.y = 300;
  shooter.angle = Math.PI;
  shooter.shotCooldown = 0;
  rival.spawnProt = 0;
  rival.shield = 0;
  rival.x = 200;
  rival.y = 100;

  // Phone side: the very callbacks mountTwinStickAction wires to _sendAimInput,
  // plus the seq stamping gamepad.js performs.
  let seq = 0;
  const deliver = (payload) => {
    assert.equal(isValidNetworkInput(payload), true, payload.action);
    game.handleRemoteInput(0, normalizeInputIntent(payload, descriptor));
  };
  const zone = new FakeElement();
  const controller = new TwinStickAimController({
    zoneEl: zone,
    knobEl: new FakeElement(),
    onPress: (input) => deliver({ action: 'AIM_PRESS', ...input, seq: ++seq }),
    onMove: (input) => deliver({ action: 'AIM_MOVE', ...input, seq: ++seq }),
    onRelease: (input, { cancelled = false, tap = false } = {}) => deliver({
      action: 'AIM_RELEASE',
      ...input,
      seq: ++seq,
      ...(cancelled ? { cancelled: true } : {}),
      ...(tap ? { tap: true } : {}),
    }),
  });

  zone.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 120, button: 0 });
  window.dispatch('pointerup', { pointerId: 1, clientX: 120, clientY: 120 });

  assert.equal(game.arrows.length, 1, 'tap must loose exactly one arrow on the host');
  assert.ok(Math.abs(Math.atan2(game.arrows[0].vy, game.arrows[0].vx) + Math.PI / 2) < 0.25,
    'arrow must be auto-aimed at the rival above');
  controller.destroy();
});
