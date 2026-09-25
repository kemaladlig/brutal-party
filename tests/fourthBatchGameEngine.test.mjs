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
let LaserGame;
let CloneGame;
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
  ({ LaserGame } = await server.ssrLoadModule('/src/games/laser.js'));
  ({ CloneGame } = await server.ssrLoadModule('/src/games-retired/clone.js'));
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

test('LASER neutral quick tap does not fire', () => {
  const game = setup(LaserGame);
  const player = game.players[0];
  player.shotCooldown = 0;
  player.ammo = 2;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0 });
  assert.equal(game.lasers.length, 0);
});

test('LASER blocked shot gives one cooldown feedback episode and a ready pulse', () => {
  const game = setup(LaserGame);
  const player = game.players[0];
  player.shotCooldown = 0.22;
  player.ammo = 2;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.fireFeedback.kind, 'blocked');
  const serial = player.fireFeedback.serial;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.fireFeedback.serial, serial);

  player.shotCooldown = 0;
  game.update(1016);
  assert.equal(player.fireFeedback.kind, 'ready');
});

test('LASER timeout is an explicit draw and world packet carries it', () => {
  const game = setup(LaserGame);
  game.matchTimer = 0;
  game.update(1016);
  assert.equal(game.state, 'MATCH_OVER');
  assert.equal(game.matchDraw, true);
  assert.equal(game.createWorldPacket().matchDraw, true);
});

test('LASER aim stick releases into fire and cancellation does not shoot', () => {
  const game = setup(LaserGame);
  const player = game.players[0];
  player.shotCooldown = 0;
  player.ammo = 2;

  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.isAiming, true);
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.isAiming, false);
  assert.equal(game.lasers.length, 1);

  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, cancelled: true });
  assert.equal(player.isAiming, false);
  assert.equal(game.lasers.length, 1);
});

test('CLONE timeout awards a survivor and advances round identity', () => {
  const game = setup(CloneGame);
  assert.equal(game.roundId, 1);
  game.players[1].isAlive = false;
  game.roundTime = 0;
  game.update(1016);
  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.roundWinner, game.players[0]);
  assert.equal(game.scores[0], 1);
});

test('COLLAPSE expires pickups and keeps a terminal round clock', () => {
  const game = setup(CollapseGame);
  assert.equal(game.roundId, 1);
  game.pickupSpawnTimer = 99;
  game.pickups = [{ x: game.arena.cx, y: game.arena.cy, type: 'SUPER_JUMP', life: 0.001 }];
  game.update(1016);
  assert.equal(game.pickups.length, 0);
  assert.ok(game.roundTime <= 60);
});

test('NINJA resize preserves lantern lifecycle state', () => {
  const game = setup(NinjaGame);
  game.lanterns[0].active = false;
  game.lanterns[0].respawnTimer = 4;
  game.resize(900, 700);
  assert.equal(game.lanterns[0].active, false);
  assert.equal(game.lanterns[0].respawnTimer, 4);
});
