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
let ColossusGame;
let COLOSSUS_TUNING;
let createColossusWorldPacket;
let isValidColossusWorldFrame;
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

  ({ ColossusGame } = await server.ssrLoadModule('/src/games/colossus.js'));
  ({ COLOSSUS_TUNING } = await server.ssrLoadModule('/src/games/colossusConfig.js'));
  ({ createColossusWorldPacket, isValidColossusWorldFrame } = await server.ssrLoadModule('/src/games/colossusView.js'));
  ({ GAME_ORDER, CARTRIDGES } = await server.ssrLoadModule('/src/core/engineRegistry.js'));
});

after(async () => {
  await server?.close();
});

test('COLOSSUS is registered in engineRegistry with valid cartridge structure', () => {
  assert.ok(GAME_ORDER.includes('COLOSSUS'), 'COLOSSUS must be in GAME_ORDER');
  const cart = CARTRIDGES.COLOSSUS;
  assert.ok(cart, 'CARTRIDGES.COLOSSUS must exist');
  assert.equal(cart.id, 'COLOSSUS');
  assert.equal(cart.title, 'COLOSSUS');
  assert.equal(typeof cart.load, 'function');
  assert.equal(typeof cart.createEngine, 'function');
  assert.ok(cart.worldView, 'COLOSSUS must have worldView registered');
});

test('ColossusGame initializes in LOBBY and transitions to PLAYING on startNewMatch', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  assert.equal(game.state, 'LOBBY');

  game.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
  game.startNewMatch();

  assert.equal(game.state, 'PLAYING');
  assert.ok(game.boss, 'Boss must be spawned');
  assert.equal(game.boss.phase, 1);
  assert.ok(game.boss.hp > 0);
  assert.equal(game.pillars.length, 4, '4 stone pillars must be spawned');

  const activePlayers = game.players.filter((p) => p.isJoined);
  assert.equal(activePlayers.length, 2, '2 players joined');
  assert.equal(activePlayers[0].hp, COLOSSUS_TUNING.MAX_HP);
});

test('Shooting front armor inflicts reduced damage while rear core receives full damage', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const initialHp = game.boss.hp;

  // Boss baktığı yön: Math.PI / 2 (Aşağıya bakıyor)
  // 1. Önden vuruş (Aşağıdan, y > boss.y): Zırha çarpar
  game.boss.angle = Math.PI / 2;
  const frontHitX = game.boss.x;
  const frontHitY = game.boss.y + game.boss.radius;
  game.applyDamageToBoss(10, frontHitX, frontHitY, 4);

  const frontDmg = initialHp - game.boss.hp;
  const expectedFront = 10 * COLOSSUS_TUNING.ARMOR_DAMAGE_SCALE;
  assert.ok(
    Math.abs(frontDmg - expectedFront) < 0.1,
    `Front armor should absorb 85% damage. Got dmg: ${frontDmg}, expected: ${expectedFront}`,
  );

  // 2. Arkadan vuruş (Yukarıdan, y < boss.y): Zayıf çekirdeğe çarpar
  const hpBeforeRear = game.boss.hp;
  const rearHitX = game.boss.x;
  const rearHitY = game.boss.y - game.boss.radius;
  game.applyDamageToBoss(10, rearHitX, rearHitY, 4);

  const rearDmg = hpBeforeRear - game.boss.hp;
  assert.equal(rearDmg, 10, 'Rear core hit should receive 100% full damage');
  assert.ok(game.boss.critFlash > 0, 'Rear hit triggers critFlash');
});

test('Reaching 65% HP triggers Phase 2 shield and pylons, destroying pylons staggers boss', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  // Boss HP'sini %64'e düşür
  game.boss.hp = game.boss.maxHp * 0.64;
  game.updateBoss(0.016);

  assert.equal(game.boss.phase, 2, 'Should switch to Phase 2');
  assert.equal(game.boss.shielded, true, 'Boss must be shielded');
  assert.equal(game.pylons.length, 2, 'Two pylons must be active');

  // Kalkan aktifken mermi hasarı vuramaz
  const hpShielded = game.boss.hp;
  game.projectiles.push({
    x: game.boss.x,
    y: game.boss.y,
    vx: 0,
    vy: 0,
    damage: 10,
    life: 1,
  });
  game.updateProjectiles(0.016);
  assert.equal(game.boss.hp, hpShielded, 'Shielded boss must not take damage');

  // Pilonları yok et
  game.pylons[0].active = false;
  game.pylons[1].active = false;
  game.updatePylons(0.016);

  assert.equal(game.boss.shielded, false, 'Shield should drop when both pylons fall');
  assert.equal(game.boss.state, 'STAGGER', 'Boss must be staggered');
});

test('Reaching 30% HP triggers Phase 3 Overdrive with higher speed', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  game.boss.phase = 2;
  game.boss.hp = game.boss.maxHp * 0.28;
  game.updateBoss(0.016);

  assert.equal(game.boss.phase, 3, 'Should enter Phase 3 Overdrive');
  assert.equal(game.boss.shielded, false, 'Shield is deactivated in Phase 3');
});

test('Downed player can be revived by teammate within radius', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.startNewMatch();

  const p1 = game.players[0];
  const p2 = game.players[1];

  // P1 canını tüket
  game.damagePlayer(p1, 10);
  assert.equal(p1.isDowned, true, 'P1 must enter downed state');
  assert.equal(p1.hp, 0);

  // P2'yi P1'in yakınına getir
  p2.x = p1.x + 20;
  p2.y = p1.y;

  // 2.2 saniye simüle et
  for (let t = 0; t < 140; t++) {
    game.updatePlayers(0.016);
  }

  assert.equal(p1.isDowned, false, 'P1 should be revived');
  assert.ok(p1.hp >= 2, 'P1 HP should be restored');
});

test('Dash gives invulnerability against shockwaves', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const p1 = game.players[0];
  game.performPlayerDash(p1);
  assert.ok(p1.dashTimer > 0, 'Dash timer should be active');

  // Şok dalgası p1'e çarpsın
  game.shockwaves.push({
    x: p1.x,
    y: p1.y,
    radius: p1.radius,
    maxRadius: 300,
  });

  game.updateShockwaves(0.016);
  assert.equal(p1.hp, COLOSSUS_TUNING.MAX_HP, 'Invulnerable dash should prevent damage');
});

test('createColossusWorldPacket generates a valid frame for client worldView', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
  game.startNewMatch();

  const packet = game.createWorldPacket();
  assert.ok(packet, 'Packet must not be null');
  assert.equal(packet.mode, 'COLOSSUS');
  assert.equal(isValidColossusWorldFrame({ action: 'WORLD_FRAME', ...packet }), true, 'Frame must pass isValidColossusWorldFrame');
  assert.ok(packet.boss, 'Packet must contain boss state');
  assert.equal(packet.boss.hp, game.boss.hp);
});
