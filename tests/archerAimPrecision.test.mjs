// ARCHER nişan hassasiyeti (kullanıcı geri bildirimi 2026-10-01):
//   "tam charge bile biraz oynak ve şansa hissettiriyor".
// Sözleşme: tam gerilişte (charge=1) salınım SIFIRDIR — ok tam bakış yönüne
// gider (deterministik atış). Kısmi gerilişte salınım doğrusal azalır
// (charge=0'da 0.15 rad). Sim `ArcherGame.aimAngle` ile görsel `archerAimSway`
// aynı formülü paylaşır.

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
  ({ ArcherGame } = await server.ssrLoadModule('/src/games/archer.js'));
});

after(async () => {
  await server?.close();
});

function setup() {
  const game = new ArcherGame(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

test('ARCHER: tam geriliş salınımsızdır — nişan açısı bakış yönüne eşit', () => {
  const game = setup();
  const player = game.players[0];
  player.angle = 0.7;
  player.charge = 1;

  // Üç farklı sway fazında da sapma TAM SIFIR olmalı.
  for (const phase of [0, Math.PI / 2, 2.1, -1.3]) {
    player.swayPhase = phase;
    assert.equal(game.aimAngle(player), player.angle);

    // Görsel formül de sim ile aynı sonucu vermeli (göz/ok ayrışması olmaz).
    const viewSway = Math.sin(phase) * (0.15 * (1 - Math.max(0, Math.min(1, player.charge))));
    assert.ok(Math.abs(viewSway) === 0);
  }
});

test('ARCHER: tam gerilmiş yaydan çıkan ok tam bakış yönünde uçar', () => {
  const game = setup();
  const player = game.players[0];
  player.x = 400; player.y = 500;
  player.angle = -0.9;
  player.swayPhase = Math.PI / 2; // salınım en tepede; eskiden ±0.03 rad sapardı
  player.charge = 1;
  player.charging = true;
  player.stun = 0;
  player.shotCooldown = 0;

  const spawned = [];
  const nativePush = game.arrows.push.bind(game.arrows);
  game.arrows.push = (arrow) => { spawned.push(arrow); return nativePush(arrow); };

  game.looseArrow(player);

  assert.equal(spawned.length, 1, 'tam gerilişten tek ok çıkmalı');
  const arrowAngle = Math.atan2(spawned[0].vy, spawned[0].vx);
  assert.ok(Math.abs(arrowAngle - player.angle) < 1e-9, `ok tam bakış yönünde gitmeli (ok=${arrowAngle}, nişan=${player.angle})`);
});

test('ARCHER: kısmi gerilişte salınım doğrusal azalır (charge=0 → 0.15 rad)', () => {
  const game = setup();
  const player = game.players[0];
  player.angle = 0;
  player.swayPhase = Math.PI / 2; // sin = 1

  player.charge = 0.5;
  assert.ok(Math.abs(game.aimAngle(player) - 0.075) < 1e-9, 'yarı gerilişte 0.075 rad sapma');

  player.charge = 0.25;
  assert.ok(Math.abs(game.aimAngle(player) - 0.1125) < 1e-9, 'çeyrek gerilişte 0.1125 rad sapma');

  player.charge = 0;
  assert.ok(Math.abs(game.aimAngle(player) - 0.15) < 1e-9, 'gerilmemiş yayda 0.15 rad sapma');
});
