// Basılı tap (plain aim hold): aim alanı SÜRÜKLEMEDEN basılı tutulduğunda host
// bu tutmayı tap'ın tutulan hâli olarak okur — HORDE tam otomatik auto-aim,
// LASER/ARCHER cooldown ritminde ateş. Sürükleme karışırsa (hasDirection)
// jöre bozulur; tutma sırasında ateş edildiyse tap aynı press'te tekrar sıkmaz.

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
let LaserGame;
let ArcherGame;

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
  ({ LaserGame } = await server.ssrLoadModule('/src/games/laser.js'));
  ({ ArcherGame } = await server.ssrLoadModule('/src/games/archer.js'));
});

after(async () => {
  await server?.close();
});

function step(game, seconds) {
  const frames = Math.ceil(seconds / 0.016);
  const start = game.lastTime;
  for (let i = 0; i < frames; i++) {
    game.update(start + (i + 1) * 16);
  }
}

// Telefon kumandasının yönsüz girdisi: press force 0, keepalive AIM_MOVE
// aimHeld:true — TwinStickAimController'ın sürüklemesiz ürettiği paketler.
function press(game, slot) {
  game.handleRemoteInput(slot, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: true });
}
function keepalive(game, slot) {
  game.handleRemoteInput(slot, { action: 'AIM_MOVE', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: true });
}
function release(game, slot, tap = false, direction = null) {
  game.handleRemoteInput(slot, {
    action: 'AIM_RELEASE',
    ...(direction ?? { dx: 0, dy: 0, angle: 0, force: 0 }),
    aimHeld: false,
    ...(tap ? { tap: true } : {}),
  });
}

function setupHorde() {
  const game = new HordeGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'empty', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  const player = game.players[0];
  player.invulnTimer = 60;
  player.attackCooldown = 0;
  return game;
}

function setupDuel(GameClass) {
  const game = new GameClass(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  const shooter = game.players[0];
  const rival = game.players[1];
  shooter.x = 400; shooter.y = 500;
  rival.x = 400; rival.y = 200;
  shooter.shotCooldown = 0;
  rival.invulnTimer = 0;
  rival.spawnProt = 0;
  return game;
}

test('HORDE: yönsüz basılı tutma tam otomatik auto-aim ateşi üretir', () => {
  const game = setupHorde();
  const shots = () => game._nextProjectileId;
  const player = game.players[0];

  press(game, 0);
  step(game, 0.05);
  assert.ok(shots() > 1, 'sürüklemeden basılı tutma ilk karede ateş etmeli');
  const afterFirst = shots();
  step(game, 0.62); // SIDEARM fireInterval 0.28 → en az bir atış daha
  assert.ok(shots() - afterFirst >= 1, 'tutma sürerken seri atış gelmeye devam etmeli');
  assert.equal(player.aimHoldFired, true);
  assert.equal(player.aimHoldAuto, true);

  // Keepalive koparsa bile held kalır; bırakınca ateş durur.
  release(game, 0);
  step(game, 0.6);
  const afterRelease = shots();
  step(game, 0.5);
  assert.equal(shots(), afterRelease, 'bırakınca otomatik ateş durmalı');
  assert.equal(player.aimHoldAuto, false);
});

test('HORDE: tutma ateş ettiyse tap tekrar sıkmaz, sade tap tek atışa devam eder', () => {
  const game = setupHorde();
  const shots = () => game._nextProjectileId;

  press(game, 0);
  step(game, 0.05); // otomatik ilk atış çıktı
  const duringHold = shots();
  release(game, 0, true); // tap olarak bırak — ikinci atış YASAK
  assert.equal(shots(), duringHold, 'aimHoldFired sonrası tap çift atış üretemez');

  step(game, 0.35); // cooldown + yeni press için aimHoldFired sıfırlanır
  const beforeTap = shots();
  press(game, 0);
  release(game, 0, true); // kare arası olmadan klasik tap
  assert.equal(shots(), beforeTap + 1, 'yön sürüklememiş sade tap yine tek atış üretir');
});

test('LASER: basılı tutma cooldown ritminde (0.22sn) otomatik ateşler', () => {
  const game = setupDuel(LaserGame);
  const shooter = game.players[0];
  shooter.ammo = 2;
  shooter.reloadTimer = 0;
  shooter.shotCooldown = 0;
  const shots = () => game.nextLaserId;
  const before = shots();

  press(game, 0);
  step(game, 0.5); // ~2 atış: t=0 ve t≥0.22 (MAX_AMMO 2 → 3. atış mermi biter)
  assert.equal(shots() - before, 2, 'mermi bitene dek cooldown ritminde ateş');
  assert.equal(shooter.aimHoldFired, true);
  const afterHold = shots();
  release(game, 0, true); // tap bastırılmalı
  step(game, 0.1);
  assert.equal(shots(), afterHold, 'tutma ateş ettikten sonra tap sıkmaz');
});

test('LASER: yönlü (sürüklemeli) nişan basılı tutma otomatik ateşlemez', () => {
  const game = setupDuel(LaserGame);
  const shooter = game.players[0];
  shooter.ammo = 2;
  shooter.reloadTimer = 0;
  shooter.shotCooldown = 0;
  const shots = () => game.nextLaserId;
  const before = shots();

  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1, aimHeld: true });
  step(game, 0.5);
  assert.equal(shots(), before, 'RELEASE_TO_FIRE manuel nişanda tutma ateş üretmez');
  assert.equal(shooter.aimHoldAuto, false);
  release(game, 0, false, { dx: 1, dy: 0, angle: 0, force: 1 });
  assert.equal(shots(), before + 1, 'manuel nişan bırakınca (yönlü) ateş eder');
});

test('ARCHER: basılı tutma tap gücünde (0.5) 0.8sn ritimle ok bırakır', () => {
  const game = setupDuel(ArcherGame);
  const shots = () => game.nextArrowId;
  // Oklar engellere çarpıp kaybolabiliyor: güç değerini doğum anında yakala.
  const spawned = [];
  const nativePush = game.arrows.push.bind(game.arrows);
  game.arrows.push = (arrow) => { spawned.push(arrow); return nativePush(arrow); };
  const before = shots();

  press(game, 0);
  keepalive(game, 0);
  step(game, 0.05);
  assert.equal(shots() - before, 1, 'tutma ilk hazır karede ok bırakmalı');
  assert.equal(spawned.length, 1);
  assert.ok(Math.abs(spawned[0].power - 0.5) < 0.05, 'ok tap gücünde (0.5) olmalı');

  keepalive(game, 0);
  step(game, 0.9); // cooldown 0.8 sn → ikinci atış
  assert.equal(shots() - before, 2, 'tutma sürerken cooldown ritmi devam eder');

  const afterHold = shots();
  release(game, 0, true); // tap bastırılmalı
  step(game, 0.1);
  assert.equal(shots(), afterHold, 'tutma ateş ettikten sonra tap tekrar sıkmaz');
});

test('ARCHER: sürüklemeli manuel nişan jöreyi bozar, bırakınca tek atış eder', () => {
  const game = setupDuel(ArcherGame);
  const shots = () => game.nextArrowId;

  game.handleRemoteInput(0, { action: 'AIM_PRESS', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: true });
  game.handleRemoteInput(0, { action: 'AIM_MOVE', dx: 0, dy: -1, angle: -Math.PI / 2, force: 1, aimHeld: true });
  const before = shots();
  step(game, 1.2); // tam şarj + cooldown penceresi: otomatik atış YOK
  assert.equal(shots(), before, 'yön alan press auto-hold yapmaz');
  release(game, 0, false, { dx: 0, dy: -1, angle: -Math.PI / 2, force: 1 });
  assert.equal(shots(), before + 1, 'manuel nişan bırakınca tam şarjla tek atış');
});
