import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get(target, key) {
    return key in target ? target[key] : noop;
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

const canvas = { width: 800, height: 600, getContext: () => context };
let server;
let CollapseGame;
let NinjaGame;

before(async () => {
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
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
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  ({ CollapseGame } = await server.ssrLoadModule('/src/games/collapse.js'));
  ({ NinjaGame } = await server.ssrLoadModule('/src/games/ninja.js'));
});

after(async () => {
  await server?.close();
});

function setup(Game) {
  const game = new Game(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

test('COLLAPSE expires pickups and keeps a terminal round clock', () => {
  const game = setup(CollapseGame);
  assert.equal(game.roundId, 1);
  const started = game.roundTime;
  game.pickupSpawnTimer = 99;
  game.pickups = [{ x: game.arena.cx, y: game.arena.cy, type: 'SUPER_JUMP', life: 0.001 }];
  game.update(1016);
  assert.equal(game.pickups.length, 0);
  assert.ok(game.roundTime < started && game.roundTime > 0, 'raunt saati geri sayar ve tavanını aşmaz');
});

test('NINJA resize preserves lantern lifecycle state', () => {
  const game = setup(NinjaGame);
  game.lanterns[0].active = false;
  game.lanterns[0].respawnTimer = 4;
  game.resize(900, 700);
  assert.equal(game.lanterns[0].active, false);
  assert.equal(game.lanterns[0].respawnTimer, 4);
});
