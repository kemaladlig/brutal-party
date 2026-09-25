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
let HordeGame;
let GAME_ORDER;
let CARTRIDGES;

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
  ({ HordeGame } = await server.ssrLoadModule('/src/games/horde.js'));
  ({ GAME_ORDER, CARTRIDGES } = await server.ssrLoadModule('/src/core/engineRegistry.js'));
});

after(async () => {
  await server?.close();
});

function setup() {
  const game = new HordeGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

function step(game, seconds) {
  const frames = Math.ceil(seconds / 0.016);
  for (let i = 0; i < frames; i++) game.update(1000 + (i + 1) * 16);
}

test('horde is registered once with world-view and declared controls', () => {
  assert.equal(GAME_ORDER.length, 15);
  assert.equal(GAME_ORDER.filter((mode) => mode === 'HORDE').length, 1);
  assert.ok(GAME_ORDER.indexOf('HORDE') < GAME_ORDER.indexOf('RACE'));
  assert.equal(CARTRIDGES.HORDE.worldView ? true : false, true);
  assert.equal(CARTRIDGES.HORDE.schema.def.right.join(','), 'fire,dash');
  assert.equal(typeof CARTRIDGES.HORDE.createEngine, 'function');
});

test('single-player horde starts and keeps authoritative values finite', () => {
  const game = setup();
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;

  assert.equal(game.state, 'PLAYING');
  assert.equal(game.round, 1);
  assert.equal(game.wave, 1);
  assert.ok(game.enemies.length > 0);
  step(game, 0.25);

  for (const player of game.players) {
    assert.ok(Number.isFinite(player.x));
    assert.ok(Number.isFinite(player.y));
    assert.ok(Number.isFinite(player.angle));
  }
  assert.equal(game.createWorldPacket().mode, 'HORDE');
  assert.doesNotThrow(() => game.render());
});

test('remote joystick, held fire and dash share the current input contract', () => {
  const game = setup();
  const player = game.players[0];
  player.invulnTimer = 0;

  game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', dx: 0.8, dy: 0, angle: 0, force: 0.8 });
  assert.equal(player.steerX, 0.8);
  assert.equal(player.targetAngle, 0);

  game.handleRemoteInput(0, { action: 'HORDE_FIRE' });
  assert.equal(player.remoteFireHeld, true);
  assert.equal(player.isAiming, true);
  game.handleRemoteInput(0, { action: 'DASH' });
  assert.equal(player.dashCooldown, 4);

  game.handleRemoteInput(0, { action: 'HORDE_FIRE_RELEASE' });
  assert.equal(player.remoteFireHeld, false);
  assert.equal(player.isAiming, false);

  game.state = 'LOBBY';
  game.handleRemoteInput(0, { action: 'HORDE_FIRE' });
  assert.equal(player.remoteFireHeld, false);
});

test('pickups apply heal, shield, speed and triple-shot effects', () => {
  const game = setup();
  const player = game.players[0];
  player.hp = 2;
  game.applyPickup(player, { type: 'HEAL' });
  game.applyPickup(player, { type: 'SHIELD' });
  game.applyPickup(player, { type: 'FAST' });
  game.applyPickup(player, { type: 'TRIPLE' });

  assert.equal(player.hp, 3);
  assert.equal(player.shield, true);
  assert.ok(player.fastTimer > 0);
  assert.ok(player.tripleTimer > 0);
});

test('a living player can revive a teammate and all-dead ends the match', () => {
  const reviveGame = setup();
  reviveGame.enemies = [];
  const downed = reviveGame.players[0];
  const rescuer = reviveGame.players[1];
  downed.spawnProt = 0;
  downed.invulnTimer = 0;
  downed.hp = 1;
  reviveGame.damagePlayer(downed, 1);
  rescuer.x = downed.x;
  rescuer.y = downed.y;
  rescuer.invulnTimer = 999;
  step(reviveGame, 3.2);
  assert.equal(downed.isAlive, true);
  assert.equal(downed.hp, 5);

  const lossGame = setup();
  lossGame.enemies = [];
  for (const player of lossGame.players.slice(0, 2)) {
    player.spawnProt = 0;
    player.invulnTimer = 0;
    player.hp = 1;
    lossGame.damagePlayer(player, 1);
  }
  assert.equal(lossGame.state, 'MATCH_OVER');
  assert.equal(lossGame.matchResult, 'loss');
});

test('portal completion advances waves and wins after the final boss wave', () => {
  const advanceGame = setup();
  advanceGame.enemies = [];
  advanceGame.players[0].x = advanceGame.arena.cx;
  advanceGame.players[0].y = advanceGame.arena.cy;
  advanceGame.players[1].x = advanceGame.arena.cx;
  advanceGame.players[1].y = advanceGame.arena.cy;
  advanceGame.players.forEach((player) => { player.invulnTimer = 999; });
  step(advanceGame, 3.2);
  assert.equal(advanceGame.state, 'PLAYING');
  assert.equal(advanceGame.wave, 2);
  assert.ok(advanceGame.enemies.length > 0);

  const winGame = setup();
  winGame.round = 3;
  winGame.wave = 3;
  winGame.startWave();
  assert.equal(winGame.isBossWave, true);
  assert.deepEqual(new Set(winGame.enemies.map((enemy) => enemy.type)), new Set(['chaser', 'shooter', 'tank', 'healer']));
  winGame.enemies = [];
  winGame.players.forEach((player) => {
    player.x = winGame.arena.cx;
    player.y = winGame.arena.cy;
    player.invulnTimer = 999;
  });
  step(winGame, 3.2);
  assert.equal(winGame.state, 'MATCH_OVER');
  assert.equal(winGame.matchResult, 'win');
});
