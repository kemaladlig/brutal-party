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
let HORDE_TUNING;
let GAME_ORDER;
let CARTRIDGES;
let HORDE_VIEW_LIMITS;

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
  ({ HordeGame, HORDE_TUNING } = await server.ssrLoadModule('/src/games/horde.js'));
  ({ HORDE_VIEW_LIMITS } = await server.ssrLoadModule('/src/games/hordeView.js'));
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
  assert.equal(GAME_ORDER.length, 14);
  assert.equal(GAME_ORDER.filter((mode) => mode === 'HORDE').length, 1);
  assert.ok(GAME_ORDER.indexOf('HORDE') < GAME_ORDER.indexOf('CROWN'));
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

test('a wave holds nothing that can stall its own clear', () => {
  // Dalga bitişi `enemies.length === 0` üzerinden ilerler (bkz. `updatePortal`).
  // Sahnede ölü/ateşsiz bir eşya kalmamalı: eski patlayıcı variller tam olarak
  // bunu yapıyordu — vurulmazsa tur 90sn'lik `WAVE_LIMIT` zaman aşımına
  // kadar kilitleniyordu. Aynı sebeple dizi world-view paket limitini de
  // taşırıyordu.
  const game = setup();
  game.slotTypes = ['human', 'human', 'human', 'human'];
  game.initPlayers();
  game.startNewMatch();

  for (let round = 1; round <= 3; round++) {
    for (let wave = 1; wave <= 3; wave++) {
      game.round = round;
      game.wave = wave;
      game.startWave();
      assert.ok(game.enemies.length > 0, `tur ${round} dalga ${wave} boş doğdu`);
      assert.ok(
        game.enemies.every((enemy) => enemy.type !== 'barrel'),
        `tur ${round} dalga ${wave} inert bir eşya içeriyor`,
      );
      assert.ok(
        game.enemies.length <= HORDE_VIEW_LIMITS.enemies,
        `tur ${round} dalga ${wave} paket limitini aştı (${game.enemies.length})`,
      );
    }
  }
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

test('quick tap fires one auto-aimed shot at the nearest zombie', () => {
  const game = setup();
  const player = game.players[0];
  player.weaponId = 'RIFLE';
  player.ammo = 50;
  player.attackCooldown = 0;
  player.reloadTimer = 0;
  player.x = 400;
  player.y = 300;
  player.angle = 0;
  player.targetAngle = 0;
  const before = game.projectiles.length;
  game.enemies.push({
    id: 'tap-target', type: 'chaser', x: 400, y: 100, radius: 14,
    hp: 50, maxHp: 50, spawnDelay: 0, vx: 0, vy: 0, angle: 0,
  });
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: true, seq: 1 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, seq: 2, tap: true });
  assert.ok(game.projectiles.length > before, 'tap should fire once');
  const shot = game.projectiles.at(-1);
  assert.ok(shot.vy < 0 && Math.abs(shot.vx) < Math.abs(shot.vy), 'shot should chase the enemy above');

  game.projectiles.length = before;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: true, seq: 3 });
  game.handleRemoteInput(0, { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, seq: 4 });
  assert.equal(game.projectiles.length, before, 'release without tap must not fire');
});

test('plain Horde aim hold auto-fires; manual direction stays under its own rules', () => {
  const game = setup();
  const player = game.players[0];
  game.enemies = [];
  player.attackCooldown = 0;
  player.ammo = 5;
  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0 });
  game.update(1016);
  assert.equal(game.projectiles.length, 1, 'yönsüz basılı tutma (basılı tap) otomatik ateşler');
  assert.equal(player.aimHoldFired, true);

  game.handleRemoteInput(0, { action: 'AIM_MOVE', dx: 1, dy: 0, angle: 0, force: 1, aimHeld: true });
  game.update(1032);
  assert.equal(player.ammo, 4); // cooldown penceresi: üst üste karede yeni atış yok
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

test('boss bomb is a ground telegraph: no body, dodge out or dash through', () => {
  // Ölçülen hata: bomba `enemies` dizisinde tam bir NPC gibi duruyordu —
  // `separateEnemies`/`separatePlayersFromEnemies` onu katı cisim sayıyor,
  // mermi/blade `damageEnemy`'e takılıyor, auto-aim hedefi seçiyordu. Yani
  // "dodge atılacak şey" değil, "yürürken takılan kapı" gibi davranıyordu.
  // Sözleşme: bomb YALNIZ zemin hasarıdır — çarpışma yok, vurulmaz, ateş
  // hedefi olmaz, tek çıkış = daireden çıkmak (dash dokunulmazlık verir).
  const game = setup();
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.enemies = [];
  const player = game.players[0];
  player.spawnProt = 0;
  player.invulnTimer = 0;
  player.dashTimer = 0;
  player.x = 400;
  player.y = 300;

  const bomb = {
    id: 900, type: 'bomb', isBoss: false, elite: false,
    x: 400, y: 300, vx: 0, vy: 0, radius: 60, speed: 0,
    hp: 9999, maxHp: 9999, damage: 0, attackEvery: Infinity,
    attackTimer: HORDE_TUNING.BOMB_FUSE, fuseTotal: HORDE_TUNING.BOMB_FUSE, lastTick: 0,
    healTimer: Infinity, angle: 0, hitTimer: 0, spawnDelay: 0,
    lungeTimer: 0, lungeCooldown: 0, summonThresholds: [], summonIndex: 0,
  };
  game.enemies.push(bomb);

  // 1) Mermi bombayı yutmaz.
  game.projectiles = [{
    id: 1, owner: 0, isEnemy: false, x: 340, y: 300, vx: 400, vy: 0,
    radius: 6, damage: 3, life: 1, color: '#D84727',
  }];
  game.updateProjectiles(0.16);
  assert.equal(bomb.hp, 9999, 'mermi bombayı vuramaz');

  // 2) Blade de vuramaz (aynı `damageEnemy` kapısı).
  game.damageEnemy(bomb, 5, 0, 0, 1, 0);
  assert.equal(bomb.hp, 9999, 'blade bombayı vuramaz');

  // 3) Ayrışma bombayı itmez: oyuncu doğduğu yerde kalır.
  player.x = 400;
  player.y = 300;
  game.separateEnemies();
  game.separatePlayersFromEnemies();
  assert.equal(Math.hypot(player.x - 400, player.y - 300), 0, 'bomba oyuncuyu itmemeli');

  // 4) Auto-aim bombayı hedeflemez.
  player.targetAngle = Math.PI;
  player.angle = Math.PI;
  assert.equal(game.snapAimToNearestEnemy(player), null, 'bomba hedef olmamalı');

  // 5) Alan hasarı yalnız dairede: içeride 2, dışarıda 0.
  player.hp = 5;
  game.enemies[0].attackTimer = 0.001;
  game.updateEnemies(0.016, game.alivePlayers);
  assert.equal(player.hp, 3, 'daire içindeki oyuncu 2 hasar almalı');
  assert.equal(game.enemies.length, 0, 'fuse bitince bomba sahneden kalkmalı');

  const outside = setup();
  outside.enemies = [];
  const safe = outside.players[0];
  safe.spawnProt = 0;
  safe.invulnTimer = 0;
  safe.dashTimer = 0;
  safe.hp = 5;
  outside.enemies.push({ ...bomb, id: 902, x: 400, y: 300, attackTimer: 0.001 });
  safe.x = 400 + 60 + safe.radius + 6;
  safe.y = 300;
  outside.updateEnemies(0.016, outside.alivePlayers);
  assert.equal(safe.hp, 5, 'daire dışındaki oyuncu hasar almamalı');

  // 6) Dash dokunulmazlığı patlamayı geçersiz kılar (dodge kuralı).
  const dashGame = setup();
  dashGame.enemies = [];
  const dasher = dashGame.players[0];
  dasher.spawnProt = 0;
  dasher.invulnTimer = 0;
  dasher.dashTimer = 0.2;
  dasher.x = 400;
  dasher.y = 300;
  dashGame.enemies.push({ ...bomb, id: 901, attackTimer: 0.001, fuseTotal: HORDE_TUNING.BOMB_FUSE });
  const beforeHp = dasher.hp;
  dashGame.updateEnemies(0.016, dashGame.alivePlayers);
  assert.equal(dasher.hp, beforeHp, 'dash sırasında patlama hasar vermemeli');
});

test('bots flee a bomb telegraph instead of walking into the blast', () => {
  // Botlar eskiden bombayı hiç görmüyordu: `nearestEnemy` içinde tip filtresi
  // yoktu ama `separatePlayersFromEnemies` onları ittiği için bot telegrafın
  // içinde sıkışıp 2 hasar alıyordu. Kaçış kuralı: bot da oyuncuyla aynı tek
  // kurallı — daireden çık, gerekirse dash.
  const game = setup();
  game.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.enemies = [];
  const bot = game.players[1];
  bot.dashCooldown = 99; // kaçış yönünü ölçelim, dash'i değil
  bot.x = 400;
  bot.y = 300;
  game.enemies.push({
    id: 910, type: 'bomb', isBoss: false, elite: false,
    x: 400, y: 300, vx: 0, vy: 0, radius: 60, speed: 0,
    hp: 9999, maxHp: 9999, damage: 0, attackEvery: Infinity,
    attackTimer: HORDE_TUNING.BOMB_FUSE, fuseTotal: HORDE_TUNING.BOMB_FUSE, lastTick: 0,
    healTimer: Infinity, angle: 0, hitTimer: 0, spawnDelay: 0,
    lungeTimer: 0, lungeCooldown: 0, summonThresholds: [], summonIndex: 0,
  });
  game.update(1016);
  const awayX = bot.steerX;
  const awayY = bot.steerY;
  assert.ok(Math.hypot(awayX, awayY) > 0.1, 'bomba içindeki bot durmamalı');
  // Merkezde yön tanımsız; deterministik bir eksen seçilir (sıkışmamak için).
  assert.ok(Number.isFinite(awayX) && Number.isFinite(awayY));

  // Daire dışında tepki YOK: bot normal hedef davranışına döner.
  const free = setup();
  free.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
  free.initPlayers();
  free.startNewMatch();
  const freeBot = free.players[1];
  freeBot.x = 400;
  freeBot.y = 300;
  free.enemies = [{
    id: 911, type: 'bomb', isBoss: false, elite: false,
    x: 400, y: 300, vx: 0, vy: 0, radius: 60, speed: 0,
    hp: 9999, maxHp: 9999, damage: 0, attackEvery: Infinity,
    attackTimer: HORDE_TUNING.BOMB_FUSE, fuseTotal: HORDE_TUNING.BOMB_FUSE, lastTick: 0,
    healTimer: Infinity, angle: 0, hitTimer: 0, spawnDelay: 0,
    lungeTimer: 0, lungeCooldown: 0, summonThresholds: [], summonIndex: 0,
  }];
  freeBot.x = 400 + 60 + freeBot.radius + 40;
  freeBot.y = 300;
  free.update(1016);
  assert.equal(Math.hypot(freeBot.steerX, freeBot.steerY) < 0.05, false,
    'daire dışındaki bot yalnız merkeze yürümeli (telegraf korkusu yok)');
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

test('round-start crates never stack, on narrow and wide fields', () => {
  for (const [w, h] of [[800, 600], [1280, 600]]) {
    for (const round of [1, 2, 3]) {
      const game = setup();
      game.resize(w, h);
      game.round = round;
      game.buildMap(round);
      game.generateLoadoutCrates();
      const crates = game.loadoutCrates;
      assert.equal(crates.length, 4);
      for (let i = 0; i < crates.length; i++) {
        for (let j = i + 1; j < crates.length; j++) {
          const d = Math.hypot(crates[i].x - crates[j].x, crates[i].y - crates[j].y);
          assert.ok(d >= crates[i].radius * 2, `crates overlap on ${w}x${h} round ${round}: ${Math.round(d)}px`);
        }
      }
    }
  }
});

test('wave-advance bonus pickups use the standard pickup size', () => {
  const game = setup();
  game.pickups = [];
  game.advanceWave();
  const bonus = game.pickups[0];
  assert.ok(bonus, 'expected a bonus pickup after a wave advance');
  assert.equal(bonus.size, game.bodyPx(HORDE_TUNING.PICKUP_SIZE));
});

test('horde trash hits keep the sim clock running (presentation-only hit-stop)', () => {
  const game = setup();
  game.slotTypes = ['human', 'bot_normal', 'bot_normal', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  game.fx.clear();
  game.trauma = 0;

  // Botun normal vuruşu: zaman dondurma yok, sarsıntı yok; his burst/halkada kalır.
  const botTarget = game.createEnemy('chaser', false, 3, false);
  botTarget.spawnDelay = 0;
  botTarget.x = game.players[1].x + 40;
  botTarget.y = game.players[1].y;
  game.enemies.push(botTarget);
  game.damageEnemy(botTarget, 1, 1, 0, 1, 0);
  assert.equal(game.fx.hitStop, 0, 'bot hit must not freeze the shared clock');
  assert.equal(game.trauma, 0, 'bot hit must not shake the shared camera');
  assert.ok(botTarget.hp > 0 || !game.enemies.includes(botTarget), 'hit applied');
  assert.ok(game.fx.particles.length > 0 || game.fx.rings.length > 0, 'hit keeps its visual pop');

  // İnsanın normal vuruşu: zaman dondurma yok, sarsıntı kısık.
  game.fx.clear();
  game.trauma = 0;
  const humanTarget = game.createEnemy('chaser', false, 3, false);
  humanTarget.spawnDelay = 0;
  humanTarget.x = game.players[0].x + 40;
  humanTarget.y = game.players[0].y;
  game.enemies.push(humanTarget);
  game.damageEnemy(humanTarget, 1, 0, 0, 1, 0);
  assert.equal(game.fx.hitStop, 0, 'human trash hit must not freeze the sim');
  assert.ok(game.trauma > 0 && game.trauma < 0.2, `human hit trauma throttled, got ${game.trauma}`);

  // Sıradan ölüm de saati dondurmaz; elit ölüm özel an olarak kısa duraklamayı korur.
  game.fx.clear();
  const trash = game.createEnemy('chaser', false, 1, false);
  trash.spawnDelay = 0;
  trash.hp = 1;
  trash.maxHp = 1;
  game.enemies.push(trash);
  game.damageEnemy(trash, 1, 0, 0, 1, 0);
  assert.equal(game.fx.hitStop, 0, 'trash slay must not freeze the sim');
  assert.ok(game.fx.pops.length > 0, 'trash slay keeps its death pop');

  game.fx.clear();
  const elite = game.createEnemy('chaser', false, 1, true);
  elite.spawnDelay = 0;
  elite.hp = 1;
  elite.maxHp = 1;
  game.enemies.push(elite);
  game.damageEnemy(elite, 1, 0, 0, 1, 0);
  assert.ok(game.fx.hitStop > 0, 'elite kill keeps its short presentation stop');

  // Sim saati hit-stop sırasında bile ham dt ile akar (mermi/yürüyüş yavaşlamaz).
  game.enemies = [game.createEnemy('chaser', false, 1, false)];
  game.enemies[0].spawnDelay = 0;
  game.portal = null;
  game.fx.hitStop = 0.1;
  const beforeWave = game.waveTimer;
  game.lastTime = 2000;
  game.update(2016);
  const spent = beforeWave - game.waveTimer;
  assert.ok(spent > 0.01, `sim must spend rawDt during hit-stop, spent ${spent}`);
});
