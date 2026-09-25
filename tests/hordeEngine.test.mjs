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
  assert.equal(CARTRIDGES.HORDE.schema.def.right.join(','), 'dash');
  assert.deepEqual(CARTRIDGES.HORDE.schema.actions.map((action) => action.id), ['dash']);
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

  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(game.getAimState(0).held, true);
  assert.equal(player.isAiming, true);
  game.handleRemoteInput(0, { action: 'DASH' });
  assert.equal(player.dashCooldown, 4);

  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(game.getAimState(0).held, false);
  assert.equal(player.isAiming, false);

  game.state = 'ROUND_PAUSE';
  game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', dx: 0.5, dy: 0, angle: 0, force: 0.5 });
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(player.steerX, 0.5);
  assert.equal(game.getAimState(0).held, false);

  game.state = 'LOBBY';
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(game.getAimState(0).held, false);
});

test('neutral Horde aim does not fire until a real direction is held', () => {
  const game = setup();
  const player = game.players[0];
  game.enemies = [];
  player.attackCooldown = 0;
  player.ammo = 5;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0 });
  game.update(1016);
  assert.equal(game.projectiles.length, 0);

  game.handleRemoteInput(0, { action: 'AIM_MOVE', dx: 1, dy: 0, angle: 0, force: 1, aimHeld: true });
  game.update(1032);
  assert.equal(player.ammo, 4);
  const afterReleaseAmmo = player.ammo;
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 });
  game.update(1048);
  assert.equal(player.ammo, afterReleaseAmmo);
});

test('Horde blocked hold reports one cooldown episode without spam', () => {
  const game = setup();
  const player = game.players[0];
  player.attackCooldown = 0.5;
  game.handleRemoteInput(0, { action: 'AIM_MOVE', dx: 1, dy: 0, angle: 0, force: 1, aimHeld: true });
  game.update(1016);
  assert.equal(player.fireFeedback.kind, 'blocked');
  const serial = player.fireFeedback.serial;
  game.update(1032);
  assert.equal(player.fireFeedback.serial, serial);

  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 });
  player.attackCooldown = 0;
  game.update(1048);
  assert.equal(player.fireFeedback.kind, 'ready');
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

test('weapon fire, reload and melee use distinct host-authoritative rules', () => {
  const game = setup();
  const player = game.players[0];
  game.obstacles = [];
  game.enemies = [];
  player.weaponId = 'RIFLE';
  player.magazine = 5;
  player.ammo = 5;
  player.attackCooldown = 0;
  const rifleTarget = game.createEnemy('tank', false, 1, false);
  rifleTarget.spawnDelay = 0;
  rifleTarget.x = player.x + 55;
  rifleTarget.y = player.y;
  game.enemies.push(rifleTarget);
  player.angle = 0;
  game.firePlayer(player);
  assert.equal(game.projectiles.length, 1);
  assert.equal(game.projectiles[0].damage, 3);
  assert.equal(player.ammo, 4);

  player.ammo = 0;
  player.attackCooldown = 0;
  game.projectiles = [];
  game.firePlayer(player);
  assert.equal(game.projectiles.length, 0);
  assert.ok(player.reloadTimer > 0);

  player.reloadTimer = 0;
  player.weaponId = 'BLADE';
  player.magazine = Infinity;
  player.attackCooldown = 0;
  const bladeTarget = game.createEnemy('chaser', false, 1, false);
  bladeTarget.spawnDelay = 0;
  bladeTarget.x = player.x + 42;
  bladeTarget.y = player.y;
  const beforeHp = bladeTarget.hp;
  game.enemies.push(bladeTarget);
  game.fireBlade(player, { damage: 4, fireInterval: 0.48, range: 78, arc: 1.45, knockback: 150 });
  assert.ok(bladeTarget.hp < beforeHp);
  assert.ok(player.weaponSwingTimer > 0);
});

test('armory upgrades alter survivability and reload behavior', () => {
  const game = setup();
  const player = game.players[0];
  player.maxHp = 5;
  player.hp = 3;
  game.applyLoadoutUpgrade(player, 'ARMOR');
  game.applyLoadoutUpgrade(player, 'QUICK_RELOAD');
  assert.equal(player.maxHp, 6);
  assert.equal(player.hp, 4);
  assert.equal(player.upgrades.QUICK_RELOAD, 1);
  player.weaponId = 'RIFLE';
  player.reloadTimer = 0;
  game.startReload(player);
  assert.ok(player.reloadTimer < 1.55);
});

test('map cover blocks projectiles and bosses summon pressure adds', () => {
  const coverGame = setup();
  coverGame.obstacles = [{ x: 300, y: 180, w: 60, h: 240 }];
  const target = coverGame.createEnemy('tank', false, 1, false);
  target.spawnDelay = 0;
  target.x = 390;
  target.y = 300;
  coverGame.enemies = [target];
  coverGame.projectiles = [{
    id: 1,
    owner: 0,
    isEnemy: false,
    x: 200,
    y: 300,
    vx: 2000,
    vy: 0,
    radius: 6,
    damage: 3,
    life: 1,
    color: '#D84727',
  }];
  coverGame.updateProjectiles(0.08);
  assert.equal(coverGame.projectiles.length, 0);
  assert.equal(target.hp, target.maxHp);

  const bossGame = setup();
  bossGame.round = 3;
  bossGame.wave = 3;
  bossGame.startWave();
  const boss = bossGame.enemies.find((enemy) => enemy.type === 'chaser');
  boss.hp = Math.ceil(boss.maxHp * 0.5);
  const before = bossGame.enemies.length;
  bossGame.maybeSummonBossAdds(boss);
  assert.equal(bossGame.enemies.length, before + 2);
  assert.ok(bossGame.enemies.slice(-2).every((enemy) => enemy.spawnDelay > 0));
});

test('a living player can revive a teammate and all-dead ends the match', () => {
  const reviveGame = setup();
  reviveGame.wave = 3;
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

test('portals appear only after round-three waves and open a new-map armory', () => {
  const game = setup();
  game.enemies = [];
  step(game, 2.5);
  assert.equal(game.wave, 2);
  assert.equal(game.portal, null);

  game.enemies = [];
  step(game, 2.5);
  assert.equal(game.wave, 3);
  assert.equal(game.portal, null);
  assert.ok(game.enemies.length > 0);

  game.round = 1;
  game.wave = 3;
  game.enemies = [];
  step(game, 0.05);
  assert.ok(game.portal);
  assert.ok(game.portal.side >= 0 && game.portal.side <= 3);
  const onEdge = game.portal.side === 0 ? game.portal.y < game.arena.cy
    : game.portal.side === 1 ? game.portal.x > game.arena.cx
      : game.portal.side === 2 ? game.portal.y > game.arena.cy
        : game.portal.x < game.arena.cx;
  assert.equal(onEdge, true);

  for (const player of game.players.slice(0, 2)) {
    player.x = game.portal.x;
    player.y = game.portal.y;
  }
  step(game, 3.2);
  assert.equal(game.state, 'ROUND_PAUSE');
  assert.equal(game.nextRound, 2);
  assert.equal(game.mapTheme, 'reactor');
  assert.equal(game.createWorldPacket().theme, 'reactor');
  assert.equal(game.loadoutCrates.length, 4);
  assert.ok(game.players.slice(0, 2).every((player) => player.isAlive));
});

test('armory choices persist into the next round and final boss ends without a portal', () => {
  const game = setup();
  game.round = 1;
  game.wave = 3;
  game.enemies = [];
  step(game, 0.05);
  for (const player of game.players.slice(0, 2)) {
    player.x = game.portal.x;
    player.y = game.portal.y;
  }
  step(game, 3.2);

  const rifle = game.loadoutCrates.find((crate) => crate.kind === 'weapon' && crate.weaponId === 'RIFLE') || game.loadoutCrates.find((crate) => crate.kind === 'weapon');
  game.players[0].x = rifle.x;
  game.players[0].y = rifle.y;
  step(game, 0.1);
  assert.ok(game.players[0].weaponId);
  assert.notEqual(game.players[0].weaponId, 'SIDEARM');

  game.roundBreakTimer = 0;
  step(game, 0.1);
  assert.equal(game.state, 'PLAYING');
  assert.equal(game.round, 2);
  assert.equal(game.wave, 1);
  assert.equal(game.players[0].weaponId, rifle.weaponId);

  game.round = 3;
  game.wave = 3;
  game.startWave();
  assert.equal(game.isBossWave, true);
  assert.deepEqual(new Set(game.enemies.map((enemy) => enemy.type)), new Set(['chaser', 'shooter', 'tank', 'healer']));
  game.enemies = [];
  step(game, 0.1);
  assert.equal(game.state, 'MATCH_OVER');
  assert.equal(game.matchResult, 'win');
  assert.equal(game.portal, null);
});
