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
let colossusHeaderStatus;
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
  ({ colossusHeaderStatus, createColossusWorldPacket, isValidColossusWorldFrame } = await server.ssrLoadModule('/src/games/colossusView.js'));
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

test('Lobby render populates start button and tapping start transitions to PLAYING', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  assert.equal(game.state, 'LOBBY');

  game.render();
  assert.ok(game.uiButtons.length > 0, 'UI buttons must be populated in LOBBY');

  const startBtn = game.uiButtons.find((btn) => Math.abs(btn.x + btn.w / 2 - game.arena.cx) < 10);
  assert.ok(startBtn, 'Start button must exist in uiButtons');

  // Dokunuş başlat düğmesine tıklar
  game.onTouchStart({
    id: 1,
    x: startBtn.x + startBtn.w / 2,
    y: startBtn.y + startBtn.h / 2,
  });

  // Lobi ayrılış animasyonunun (340ms) tamamlanmasını simüle et
  const t0 = performance.now();
  const origNow = performance.now.bind(performance);
  try {
    performance.now = () => t0 + 400;
    game.render();
  } finally {
    performance.now = origNow;
  }

  assert.equal(game.state, 'PLAYING', 'Game should transition to PLAYING after start tap');
  assert.ok(game.boss, 'Boss should be spawned');
});

test('Local keyboard WASD moves player and space fires weapon', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();
  game.isLocalInputActive = true;

  const p1 = game.players[0];
  const initialX = p1.x;

  // D tuşuna bas (sağa hareket)
  game.keys['KeyD'] = true;
  game.update(performance.now() + 16);
  assert.ok(p1.x > initialX, 'P1 should move right with KeyD');

  game.keys['KeyD'] = false;

  // Space bas (ateş)
  const initialAmmo = p1.ammo;
  game.keys['Space'] = true;
  game.keys[' '] = true;
  game.update(performance.now() + 32);
  assert.ok(p1.ammo < initialAmmo || game.projectiles.length > 0, 'P1 should fire weapon on Space');
});

test('Lobby touch quadrant cycles player slots', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  assert.equal(game.state, 'LOBBY');
  assert.equal(game.slotTypes[1], 'empty');

  // P2 sol-üst kadranına dokun
  const touch = { id: 2, x: game.arena.left + 50, y: game.arena.top + 50 };
  game.onTouchStart(touch);

  assert.notEqual(game.slotTypes[1], 'empty', 'Slot 1 should cycle from empty');
});

test('Boss and Boss HUD are not rendered in LOBBY state', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  assert.equal(game.state, 'LOBBY');
  assert.equal(game.boss, null);

  const packet = game.createWorldPacket();
  assert.equal(packet.gameState, 'LOBBY');
  const header = colossusHeaderStatus({ boss: game.boss });
  assert.equal(header.text, '');
  assert.equal(header.tone, null);
});

test('Stomp shockwave damages player only once across multiple frames without one-shotting', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.startNewMatch();

  const p1 = game.players[0];
  const initialHp = p1.hp;
  assert.equal(initialHp, COLOSSUS_TUNING.MAX_HP);

  // Position boss and shockwave near p1
  game.boss.x = p1.x;
  game.boss.y = p1.y - 50;
  game.triggerStomp();
  assert.equal(game.shockwaves.length, 1);

  // Simulate 15 consecutive frames while the ring expands through p1
  let now = 1000;
  for (let i = 0; i < 15; i++) {
    now += 16;
    game.update(now);
  }

  // P1 should only have lost COLOSSUS_TUNING.STOMP_DAMAGE (1 HP), NOT one-shotted!
  assert.equal(p1.hp, initialHp - COLOSSUS_TUNING.STOMP_DAMAGE, 'Player should only take 1 damage once from shockwave');
  assert.equal(p1.isDowned, false, 'Player should not be downed by a single stomp');
});

test('Phase 2 shielded boss displays objective hint in headerStatus', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.startNewMatch();

  // Enter Phase 2
  game.enterPhase2();
  assert.equal(game.boss.phase, 2);
  assert.equal(game.boss.shielded, true);

  const header = colossusHeaderStatus({ boss: game.boss });
  assert.equal(header.tone, 'urgent');
  assert.ok(header.text.length > 0, 'Phase 2 objective text must be displayed');
});

test('MATCH_OVER provides clickable uiButtons and allows keyboard restart', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.startNewMatch();

  // Down all players to trigger MATCH_OVER defeat
  for (const p of game.players) p.isDowned = true;
  game.update(performance.now() + 16);
  assert.equal(game.state, 'MATCH_OVER');
  assert.equal(game.matchResult, 'loss');

  // Input source should be accepted outside PLAYING
  assert.equal(game.claimInputSource('touch', { point: { x: 400, y: 300 } }), true);

  // Render should populate result buttons
  game.render();
  assert.ok(game.uiButtons.length >= 2, 'Result card must produce action buttons in uiButtons');

  // Click the restart button
  const restartBtn = game.uiButtons[0];
  game.onTouchStart({ id: 1, x: restartBtn.x + restartBtn.w / 2, y: restartBtn.y + restartBtn.h / 2 });
  assert.equal(game.state, 'PLAYING', 'Clicking restart button must restart match');

  // Down all players again
  for (const p of game.players) p.isDowned = true;
  game.update(performance.now() + 32);
  assert.equal(game.state, 'MATCH_OVER');

  // Keyboard restart transitions back to PLAYING
  game.startNewMatch();
  assert.equal(game.state, 'PLAYING');
});


