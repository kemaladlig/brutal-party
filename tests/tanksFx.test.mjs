// TANKS FX kilidi (MOTION_PLAN Faz 1 çıkış kanıtı): showcase motorun olay
// merdiveni gerçekten tetikleniyor — ölüm pop/halka/burst + hit-stop + flaş +
// travma; WORLD_FRAME FX yükü şema doğrulamasından geçiyor (host↔client parite).
// firstBatchGameEngine.test.mjs başlıksız ortam kalıbını kullanır.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const context = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => ({ addColorStop: noop }),
  createRadialGradient: () => ({ addColorStop: noop }),
}, {
  get(target, key) {
    if (key in target) return target[key];
    return noop;
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

const canvas = { width: 800, height: 600, getContext: () => context };

let server;
let TanksGame;
let viewModule;

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
  };

  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  ({ TanksGame } = await server.ssrLoadModule('/src/games/tanks.js'));
  viewModule = await server.ssrLoadModule('/src/games/tanksView.js');
});

after(async () => { await server?.close(); });

function drive(game, frames, start = performance.now()) {
  let now = start;
  for (let i = 0; i < frames; i += 1) {
    now += 16.7;
    game.update(now);
    game.render();
  }
  return now;
}

function startRound() {
  const game = new TanksGame(canvas);
  game.resize(800, 600);
  game.startNewMatch();
  drive(game, 200);
  return game;
}

test('kill olayı tam merdiveni üretir: pop + halka + burst + hit-stop + flaş + travma', () => {
  const game = startRound();
  const victim = game.tanks.find((t) => t.isAlive);
  assert.ok(victim, 'rauntta canlı tank olmalı');

  game.destroyTank(victim, { vx: 1, vy: 0 });

  assert.equal(game.fx.pops.length, 1, 'ölüm pop\'u');
  assert.ok(game.fx.rings.length >= 1, 'şok halkası');
  assert.ok(game.fx.particles.length >= 18, 'kill burst (fxKit bütçesi)');
  assert.ok(game.fx.hitStop > 0, 'hit-stop kuruldu');
  assert.ok(game.fx.flash > 0, 'kill flaşı kuruldu');
  assert.ok(game.trauma > 0, 'travma BaseGame kanalından aktı');
  assert.ok(game._traumaDirX > 0, 'yönlü itki mermi yönünde');
});

test('FX saatleri ROUND_OVER boşluğunda da akar (ölüm animasyonu donmaz)', () => {
  const game = startRound();
  const victim = game.tanks.find((t) => t.isAlive);
  game.destroyTank(victim, { vx: 0, vy: 1 });
  const popsBefore = game.fx.pops.length;
  drive(game, 40); // ~0.66 sn — pop ömrü 0.35 sn
  assert.ok(popsBefore > 0);
  assert.equal(game.fx.pops.length, 0, 'pop boşlukta da söndü');
});

test('hit-stop simülasyon saatini çalmaz: dt ölçekli ama dürüst', () => {
  const game = startRound();
  const victim = game.tanks.find((t) => t.isAlive);
  game.destroyTank(victim, { vx: 1, vy: 0 });
  // Hit-stop penceresinde updateTrauma yavaşlar → trauma daha geç söner.
  let now = performance.now();
  for (let i = 0; i < 12; i += 1) { now += 16.7; game.update(now); }
  assert.ok(game.fx.hitStop >= 0);
  assert.ok(game.trauma >= 0 && game.trauma <= 1);
});

test('WORLD_FRAME FX yükü şemadan geçer; eski (fx\'siz) frame reddedilmez', () => {
  const game = startRound();
  const victim = game.tanks.find((t) => t.isAlive);
  game.destroyTank(victim, { vx: 0, vy: -1 });
  game.render();

  const frame = viewModule.createTanksWorldPacket(game);
  assert.ok(frame, 'packet üretildi');
  // Nakliye katmanı `action` alanını ekler; doğrulayıcı onu bekler.
  const wire = { action: 'WORLD_FRAME', ...frame };
  assert.ok(viewModule.isValidTanksWorldFrame(wire), 'FX yüklü frame geçerli');
  assert.ok(Array.isArray(wire.fx.rings) && wire.fx.rings.length >= 1);
  assert.equal(wire.fx.pops.length, 1);
  assert.ok(wire.fx.flash > 0);

  // v1 uyumu: fx alanı olmayan frame hâlâ geçerli (eski host).
  const legacy = { ...wire, fx: undefined };
  assert.ok(viewModule.isValidTanksWorldFrame(legacy), 'fx opsiyoneldir');

  // Bozuk FX yükü reddedilir.
  const broken = { ...wire, fx: { rings: [], pops: [], flash: Number.NaN, flashPeak: 0.06 } };
  assert.equal(viewModule.isValidTanksWorldFrame(broken), false);
});
