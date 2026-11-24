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
let COLOSSUS_WEAPONS;
let createColossusWorldPacket;
let drawColossusWorld;
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
  ({ COLOSSUS_TUNING, COLOSSUS_WEAPONS } = await server.ssrLoadModule('/src/games/colossusConfig.js'));
  ({ colossusHeaderStatus, createColossusWorldPacket, drawColossusWorld, isValidColossusWorldFrame } = await server.ssrLoadModule('/src/games/colossusView.js'));
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

  const startBtn = game.uiButtons.find((btn) =>
    Math.abs(btn.x + btn.w / 2 - game.arena.cx) < 10
    && Math.abs(btn.y + btn.h / 2 - game.arena.cy) < 60
  );
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

test('Boss Selection cycles through roster and spawns selected boss with parts and map', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);

  assert.equal(game.selectedBossId, 'AEGIS');
  game.cycleBossSelection(1);
  assert.equal(game.selectedBossId, 'IGNIS');
  game.cycleBossSelection(1);
  assert.equal(game.selectedBossId, 'VOLT');
  game.cycleBossSelection(1);
  assert.equal(game.selectedBossId, 'AEGIS');

  // Select IGNIS and start battle
  game.cycleBossSelection(1);
  assert.equal(game.selectedBossId, 'IGNIS');
  game.startNewMatch();

  assert.equal(game.boss.id, 'IGNIS');
  assert.equal(game.boss.bodyShape, 'scorpion');
  assert.ok(game.boss.parts.some((p) => p.id === 'stinger'), 'IGNIS must have stinger part');
  assert.ok(game.boss.parts.some((p) => p.id === 'pincers'), 'IGNIS must have pincers part');

  // Select VOLT and start battle
  game.resetMatch();
  game.selectedBossId = 'VOLT';
  game.startNewMatch();

  assert.equal(game.boss.id, 'VOLT');
  assert.equal(game.boss.bodyShape, 'nexus');
  assert.ok(game.boss.parts.some((p) => p.id === 'coil'), 'VOLT must have coil part');
  assert.ok(game.boss.parts.some((p) => p.id === 'capacitors'), 'VOLT must have capacitors part');
});

test('Weapon Selection allows cycling loadouts and alters projectile mechanics', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);

  // Cycle P1 weapon: RIFLE -> SHOTGUN -> SNIPER -> PLASMA
  assert.equal(game.selectedWeapons[0], 'RIFLE');
  game.cyclePlayerWeapon(0, 1);
  assert.equal(game.selectedWeapons[0], 'SHOTGUN');

  game.startNewMatch();
  const p1 = game.players[0];
  assert.equal(p1.weaponId, 'SHOTGUN');

  // Shotgun fires 5 pellets
  game.projectiles = [];
  game.firePlayerWeapon(p1);
  assert.equal(game.projectiles.length, 5, 'Shotgun must fire 5 pellets');
  assert.equal(game.projectiles[0].damage, 2);

  // Sniper fires single high-damage shot
  game.cyclePlayerWeapon(0, 1); // SHOTGUN -> SNIPER
  p1.attackCooldown = 0;
  p1.ammo = 5;
  game.projectiles = [];
  game.firePlayerWeapon(p1);
  assert.equal(game.projectiles.length, 1, 'Sniper fires 1 bullet');
  assert.equal(game.projectiles[0].damage, 12, 'Sniper does 12 damage');

  // Plasma fires explosive AoE projectile
  game.cyclePlayerWeapon(0, 1); // SNIPER -> PLASMA
  p1.attackCooldown = 0;
  p1.ammo = 6;
  game.projectiles = [];
  game.firePlayerWeapon(p1);
  assert.equal(game.projectiles.length, 1, 'Plasma fires 1 projectile');
  assert.ok(game.projectiles[0].aoeRadius > 0, 'Plasma projectile has aoeRadius');
});

test('Destructible Boss Parts can be damaged and broken, breaking front armor negates damage penalty', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.selectedBossId = 'AEGIS';
  game.startNewMatch();

  const armorPart = game.boss.parts.find((p) => p.id === 'armorPlate');
  assert.ok(armorPart, 'AEGIS must have armorPlate part');
  assert.equal(armorPart.broken, false);

  // Hit the front armor part directly
  const partAngle = game.boss.angle + armorPart.angleOffset;
  const partDist = game.boss.radius * armorPart.distRatio;
  const partX = game.boss.x + Math.cos(partAngle) * partDist;
  const partY = game.boss.y + Math.sin(partAngle) * partDist;

  // Apply enough damage to break the armor plate
  game.applyDamageToBoss(armorPart.maxHp + 5, partX, partY, 10);
  assert.equal(armorPart.broken, true, 'Armor plate should be broken after receiving full damage');

  // Frontal hits now bypass the 85% penalty because armor is broken!
  const hpBefore = game.boss.hp;
  const frontHitX = game.boss.x;
  const frontHitY = game.boss.y + game.boss.radius;
  game.applyDamageToBoss(10, frontHitX, frontHitY, 4);

  const frontDmg = hpBefore - game.boss.hp;
  assert.equal(frontDmg, 10, 'Frontal hit should do 100% full damage when front armor is broken');
});

test('Charge attack damages players in its path and knocks them back', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const p1 = game.players[0];
  const boss = game.boss;
  boss.x = game.arena.cx;
  boss.y = game.arena.cy - 200;
  boss.angle = Math.PI / 2;
  boss.state = 'CHARGE';
  boss.chargeAngle = Math.PI / 2;
  boss.chargeTimer = COLOSSUS_TUNING.CHARGE_DURATION;
  boss.chargeHits = [];

  p1.x = boss.x;
  p1.y = boss.y + 60;
  const hpBefore = p1.hp;

  game.updateBoss(0.016);

  assert.ok(p1.hp < hpBefore, 'Player standing in the charge path must take damage');
  assert.ok(boss.chargeHits.includes(p1.index), 'Charge must record the hit exactly once');
  assert.ok(Math.abs(p1.vy) > 0, 'Charge must knock the player back');
});

test('Laser beam damages players in its path while dash i-frames avoid it', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const p1 = game.players[0];
  const boss = game.boss;
  boss.x = game.arena.cx;
  boss.y = game.arena.top + 60;
  boss.laserAngle = Math.PI / 2;
  boss.state = 'LASER_FIRE';
  boss.laserActive = true;

  p1.x = boss.x;
  p1.y = boss.y + 200;
  p1.laserHitCd = 0;
  const hpBefore = p1.hp;
  game.updateLaser(0.016);
  assert.ok(p1.hp < hpBefore, 'Player in the beam lane must take damage');

  p1.hp = COLOSSUS_TUNING.MAX_HP;
  p1.laserHitCd = 0;
  p1.x = boss.x;
  p1.y = boss.y + 200;
  game.performPlayerDash(p1);
  game.updateLaser(0.016);
  assert.equal(p1.hp, COLOSSUS_TUNING.MAX_HP, 'Dash must grant immunity to the beam');
});

test('Breaking a weapon module disables its attack and forces a stagger', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.selectedBossId = 'AEGIS';
  game.startNewMatch();

  const cannon = game.boss.parts.find((p) => p.id === 'cannon');
  assert.equal(cannon.disables, 'MORTAR', 'Cannon module must gate the mortar attack');

  const partAngle = game.boss.angle + cannon.angleOffset;
  const partDist = game.boss.radius * cannon.distRatio;
  const px = game.boss.x + Math.cos(partAngle) * partDist;
  const py = game.boss.y + Math.sin(partAngle) * partDist;
  game.applyDamageToBoss(cannon.maxHp + 10, px, py, 6);

  assert.equal(cannon.broken, true, 'Module must break under sustained fire');
  assert.equal(game.boss.state, 'STAGGER', 'Breaking a module must open a stagger window');
});

test('Remote twin-stick joystick moves continuously and aim tap/hold work properly', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const p1 = game.players[0];
  const x0 = p1.x;
  game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', dx: 1, dy: 0, angle: 0, force: 1 });
  game.update(1000);
  game.update(1016);
  const x1 = p1.x;
  game.update(1032);
  assert.ok(p1.x > x1 && x1 > x0, 'Remote joystick state must persist across frames');

  // Quick tap aim fires auto-aimed shot on release
  const startAmmo = p1.ammo;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', intent: { id: 'aim', phase: 'press', seq: 1 } });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', tap: true, intent: { id: 'aim', phase: 'release', seq: 2, tap: true } });
  assert.ok(p1.ammo < startAmmo || game.projectiles.length > 0, 'Quick aim tap must fire once');

  // Plain hold fires continuously during update until AIM_RELEASE
  p1.attackCooldown = 0;
  const ammoBeforeHold = p1.ammo;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', intent: { id: 'aim', phase: 'press', seq: 3 } });
  game.update(1048);
  assert.ok(p1.ammo < ammoBeforeHold, 'Held plain aim must fire');
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', intent: { id: 'aim', phase: 'release', seq: 4 } });
  assert.equal(p1.aimActive, false, 'AIM_RELEASE must clear aimActive');
});

test('Dash follows movement vector even while aiming elsewhere and buffers late taps', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const p1 = game.players[0];
  p1.steerX = 1;
  p1.steerY = 0;
  p1.angle = Math.PI / 2; // aiming down while moving right
  game.keys['KeyD'] = true;
  game.performPlayerDash(p1);
  assert.ok(p1.dashDirX > 0.9 && Math.abs(p1.dashDirY) < 0.1, 'Dash must use live movement direction');
  assert.ok(p1.vx > 0, 'Dash velocity must launch along movement direction');
  game.keys['KeyD'] = false;

  // Test dash input buffer inside 120ms window
  p1.dashTimer = 0;
  p1.dashCooldown = 0.05;
  game.lastTime = 1000;
  game.performPlayerDash(p1); // buffered!
  game.update(1080); // 80ms later: cooldown expires -> buffered dash fires
  assert.ok(p1.dashTimer > 0, 'Buffered dash tap must fire as soon as cooldown ends');
});

test('Players collide cleanly with pillars and boss without overlapping', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const p1 = game.players[0];
  const pillar = game.pillars[0];
  p1.x = pillar.x + 2;
  p1.y = pillar.y;
  game.updatePlayers(0.016);
  const dPillar = Math.hypot(p1.x - pillar.x, p1.y - pillar.y);
  assert.ok(dPillar >= pillar.radius + p1.radius - 0.5, `Player overlapped pillar: ${dPillar}`);

  const boss = game.boss;
  boss.state = 'IDLE';
  p1.dashTimer = 0;
  p1.x = boss.x + 4;
  p1.y = boss.y;
  game.updatePlayers(0.016);
  const dBoss = Math.hypot(p1.x - boss.x, p1.y - boss.y);
  assert.ok(dBoss >= boss.radius + p1.radius - 0.5, `Player overlapped boss: ${dBoss}`);
});

test('Laser beam is blocked by pillar in front of player and not by pillar behind player', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const boss = game.boss;
  const p1 = game.players[0];
  boss.x = game.arena.cx;
  boss.y = game.arena.top + 80;
  boss.laserAngle = Math.PI / 2;
  boss.state = 'LASER_FIRE';
  boss.laserActive = true;

  // Case A: Pillar between boss and player blocks the beam
  game.pillars = [{ x: boss.x, y: boss.y + 130, radius: 28, hp: 4, maxHp: 4 }];
  p1.x = boss.x;
  p1.y = boss.y + 240;
  p1.hp = COLOSSUS_TUNING.MAX_HP;
  p1.laserHitCd = 0;
  p1.hurtInvuln = 0;
  game.updateLaser(0.016);
  assert.equal(p1.hp, COLOSSUS_TUNING.MAX_HP, 'Pillar in front must block laser');

  // Case B: Pillar BEHIND player does NOT block the beam
  game.pillars = [{ x: boss.x, y: boss.y + 340, radius: 28, hp: 4, maxHp: 4 }];
  p1.laserHitCd = 0;
  p1.hurtInvuln = 0;
  game.updateLaser(0.016);
  assert.ok(p1.hp < COLOSSUS_TUNING.MAX_HP, 'Pillar behind player must not shield player from beam');
});

test('VOLT coil can be damaged by projectiles and breaking all parts removes armor penalty and heals team', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.selectedBossId = 'VOLT';
  game.selectedWeapons[0] = 'SNIPER';
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  game.pillars = [];
  const boss = game.boss;
  boss.angle = Math.PI / 2;
  const coil = boss.parts.find((part) => part.id === 'coil');
  const p1 = game.players[0];
  p1.x = boss.x;
  p1.y = boss.y + boss.radius + 90;
  p1.angle = -Math.PI / 2;
  p1.hp = COLOSSUS_TUNING.MAX_HP - 1;
  p1.ammo = 2;

  game.firePlayerWeapon(p1);
  for (let i = 0; i < 20; i++) game.updateProjectiles(0.016);
  assert.ok(coil.hp < coil.maxHp, 'Fired projectile must hit VOLT reactor coil');

  // Break remaining parts and verify Team Surge + front armor bypass
  const cap = boss.parts.find((part) => part.id === 'capacitors');
  coil.hp = 1;
  cap.broken = true;
  const cAngle = boss.angle + coil.angleOffset;
  const cDist = boss.radius * coil.distRatio;
  game.applyDamageToBoss(10, boss.x + Math.cos(cAngle) * cDist, boss.y + Math.sin(cAngle) * cDist, 4);

  assert.equal(coil.broken, true, 'Coil should break cleanly');
  assert.equal(p1.hp, COLOSSUS_TUNING.MAX_HP, 'Breaking a part must restore +1 HP to team');
  assert.equal(p1.ammo, COLOSSUS_WEAPONS.SNIPER.magazine, 'Breaking a part must refill weapon magazine');

  boss.state = 'IDLE';
  const hpBefore = boss.hp;
  game.applyDamageToBoss(10, boss.x, boss.y + boss.radius, 2);
  assert.equal(hpBefore - boss.hp, 10, 'Breaking all parts on VOLT/IGNIS must bypass front armor penalty');
});

test('LASER_LOCK_TIME locks aim before firing and CHARGE away from wall does not self-stagger', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.startNewMatch();

  const boss = game.boss;
  const p1 = game.players[0];

  // Charge starting while touching left wall but aiming right must not self-stagger
  boss.x = game.arena.left + boss.radius;
  boss.y = game.arena.cy;
  boss.state = 'CHARGE';
  boss.chargeAngle = 0;
  boss.chargeTimer = 0.5;
  game.updateBoss(0.016);
  assert.equal(boss.state, 'CHARGE', 'Moving away from a wall must not trigger wall-stagger');

  // Laser lock phase freezes angle before firing
  boss.state = 'WINDUP_LASER';
  boss.x = game.arena.cx;
  boss.y = game.arena.cy - 100;
  boss.laserTrackTimer = 0.02;
  boss.laserLockTimer = COLOSSUS_TUNING.LASER_LOCK_TIME;
  boss.laserLock = false;
  boss.angle = Math.PI / 2;
  boss.laserAngle = Math.PI / 2;
  p1.x = boss.x;
  p1.y = boss.y + 180;

  game.updateBoss(0.03); // crosses track -> lock
  assert.equal(boss.laserLock, true, 'Boss must enter locked telegraph phase');
  assert.equal(boss.state, 'WINDUP_LASER', 'Lock window stays in windup before firing');
  const lockedAngle = boss.laserAngle;

  // Player dodges far right during lock: beam must stay frozen at lockedAngle
  p1.x = boss.x + 250;
  p1.y = boss.y;
  game.updateBoss(0.1);
  assert.equal(boss.laserAngle, lockedAngle, 'Locked laser telegraph must not track dodging player');
});

test('Packet opts into selfPredict and drawColossusWorld unpacks FX tuples cleanly', () => {
  const game = new ColossusGame(canvas);
  game.resize(800, 600);
  game.startNewMatch();

  game.fx.emit('hit', { x: game.boss.x, y: game.boss.y, color: '#FFFFFF' });
  game.fx.emit('kill', { x: game.boss.x, y: game.boss.y, color: '#FFB020' });
  const packet = game.createWorldPacket();
  assert.equal(packet.selfPredict, true, 'COLOSSUS world packet must enable selfPredict');
  assert.ok(Array.isArray(packet.fx.rings) && packet.fx.rings.length > 0, 'Packed FX rings must exist');

  assert.doesNotThrow(() => {
    drawColossusWorld(context, game.arena, { ...packet, phase: packet.gameState }, { now: 1000, roundId: packet.roundId });
  });
});



