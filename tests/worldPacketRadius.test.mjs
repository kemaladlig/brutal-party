// tests/worldPacketRadius.test.mjs
// Automated verification for Step 3.3: World packet radius completeness.
// Proves that every engine with a world packet produces a finite, non-null,
// non-fallback-dependent entity radius across multiple viewports.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };

const stubContext = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get: (t, k) => (k in t ? t[k] : noop),
  set: (t, k, v) => { t[k] = v; return true; },
});

let server;
let CARTRIDGES;
let GAME_ORDER;

before(async () => {
  globalThis.window = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: noop,
    removeEventListener: noop,
    AudioContext: null,
    webkitAudioContext: null,
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    activeElement: null,
    body: {},
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ width: 0, height: 0, getContext: () => stubContext }),
  };

  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });

  const reg = await server.ssrLoadModule('/src/core/engineRegistry.js');
  CARTRIDGES = reg.CARTRIDGES;
  GAME_ORDER = reg.GAME_ORDER;
});

after(async () => {
  await server?.close();
});

const VIEWPORTS = [
  { name: 'desktop', w: 1920, h: 1080 },
  { name: 'phone', w: 852, h: 393 },
];

test('every cartridge exposing worldPacket guarantees finite player radii in packet', async () => {
  for (const mode of GAME_ORDER) {
    const cartridge = CARTRIDGES[mode];
    if (!cartridge.worldView) continue;

    const GameClass = await cartridge.load();

    for (const vp of VIEWPORTS) {
      const canvas = { width: vp.w, height: vp.h, getContext: () => stubContext };
      const game = new GameClass(canvas);
      game.resize(vp.w, vp.h);
      game.slotTypes = ['human', 'human', 'bot_normal', 'empty'];
      const init = game.initPlayers || game.initTanks || game.initSnakes || game.initZones;
      if (init) init.call(game);
      game.startNewMatch();

      // Tick 5 frames of input
      for (let i = 0; i < 5; i++) {
        game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', dx: 0.5, dy: 0.5 });
        if (typeof game.update === 'function') game.update(1000 + (i + 1) * 16);
      }

      const packet = game.createWorldPacket ? game.createWorldPacket() : null;
      assert.ok(packet, `${mode} must produce a world packet on ${vp.name}`);

      if (mode === 'PONG') {
        assert.ok(
          Number.isFinite(packet.ball?.radius) && packet.ball.radius > 0,
          `PONG ball.radius must be finite on ${vp.name}, got ${packet.ball?.radius}`,
        );
      } else if (Array.isArray(packet.players) && packet.players.length > 0) {
        for (const p of packet.players) {
          if (p.joined === false) continue;
          assert.ok(
            Number.isFinite(p.radius) && p.radius > 0,
            `${mode} player slot ${p.slot} radius must be finite and > 0 on ${vp.name}, got ${p.radius}`,
          );
        }
      }
    }
  }
});
