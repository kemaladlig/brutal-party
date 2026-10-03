// KAZANÇ NESNESİ (score target) — ARCHER entegrasyon sözleşmesi.
//
// Eklenen içerik: raunt ortasında sahaya giren, şerit boyunca dolaşan 3 puanlık
// hedef. Puan artık yalnız rakip vuruşundan (1-2) gelmiyor; bir HEDEF de var.
// Test edilen sözleşmeler:
//   1) FIRST_AT dolunca doğar, LIFE dolunca kendiliğinden gider.
//   2) Şerit ENGELSİZDİR (vurulamayan nesne puan vermez) ve hedef sınır aşmaz.
//   3) Vuran ok 3 puanı hem maç toplamına hem RAUNT puanına yazar, ok harcanır.
//   4) Raunt sıfırlanınca hedef listesi sızma yapmaz.
//   5) `world` paketi hedefi 6 sayılık satır taşır; validator'ı bunu kabul eder.
//   6) Bot da hedefi görür — insana bedava puan yolu kalmaz.

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
const STEP = 1000 / 60;

let server;
let ArcherGame;
let archerView;
let kit;
let physics;

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
  archerView = await server.ssrLoadModule('/src/games/archerView.js');
  kit = await server.ssrLoadModule('/src/core/scoreTargetKit.js');
  physics = await server.ssrLoadModule('/src/core/physics2d.js');
});

after(async () => {
  await server?.close();
});

function setup(slotTypes = ['human', 'human', 'empty', 'empty']) {
  const game = new ArcherGame(canvas);
  game.resize(800, 600);
  game.slotTypes = slotTypes;
  game.initPlayers();
  game.startNewMatch();
  game.lastTime = 1000;
  return game;
}

function run(game, seconds) {
  // `update(now)` kendi `lastTime`'ını yazır: saati İLERİDEN ver, yoksa dt=0.
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) game.update(game.lastTime + STEP);
}

/** Doğmuş hedefi nişangâh gibi sabitler (güncelleme hareketi yeniden kurmasın). */
function pinTarget(target, x, y) {
  target.baseX = x;
  target.baseY = y;
  target.amp = 0;
  target.x = x;
  target.y = y;
}

function spawnOne(game) {
  // Harita raunt başına rastgele: ilk deneme engelle boşa düşebilir ve
  // yerleşim RETRY (2sn) ile tekrarlanır. Belirli bir tarihe değil, en geç
  // birkaç denemeye kadar bekliyoruz.
  for (let i = 0; i < 8; i += 1) {
    if (game.scoreTargets[0]) return game.scoreTargets[0];
    run(game, 2);
  }
  return game.scoreTargets[0] || null;
}

test('hedef FIRST_AT dolunca doğar, LIFE dolunca kendiliğinden gider', () => {
  const game = setup();
  assert.equal(game.scoreTargets.length, 0, 'raunt başında hedef yok');

  run(game, kit.SCORE_TARGET_TUNING.FIRST_AT - 1);
  assert.equal(game.scoreTargets.length, 0, 'henüz erken');

  run(game, 8);
  assert.equal(game.scoreTargets.length, 1, 'eşiği geçince tek hedef doğmalı');

  run(game, kit.SCORE_TARGET_TUNING.LIFE + 2);
  assert.equal(game.scoreTargets.length, 0, 'ömür bitince hedef kalkar');
});

test('şerit engelsizdir ve hedef saha sınırını aşmaz', () => {
  const game = setup();
  const target = spawnOne(game);
  assert.ok(target, 'yerleşecek engelsiz şerit bulunmalı');

  for (const obstacle of game.obstacles) {
    const hit = target.axis === 'x'
      ? physics.segmentAabbIntersection(
        target.baseX - target.amp, target.baseY, target.baseX + target.amp, target.baseY, obstacle, 0,
      )
      : physics.segmentAabbIntersection(
        target.baseX, target.baseY - target.amp, target.baseX, target.baseY + target.amp, obstacle, 0,
      );
    assert.equal(hit, null, 'kazanç nesnesi duvarın içinden geçemez');
  }

  const arena = game.arena;
  for (let i = 0; i < 240; i += 1) {
    game.update(game.lastTime + STEP);
    const t = game.scoreTargets[0];
    if (!t) break;
    assert.ok(t.x - t.r >= arena.left - 1 && t.x + t.r <= arena.right + 1, 'yatay taşma');
    assert.ok(t.y - t.r >= arena.top - 1 && t.y + t.r <= arena.bottom + 1, 'dikey taşma');
  }
});

test('hedefi vuran ok 3 puanı maç ve raunt hanesine yazar, ok harcanır', () => {
  const game = setup();
  const target = spawnOne(game);
  assert.ok(target, 'hedef hazır olmalı');
  // Nişangâh determinizmi: harita raunt başına rastgele; düz uçuş hattını
  // temizleyip yalnız hedef-vuruşu sözleşmesini ölçüyoruz.
  game.obstacles = [];
  pinTarget(target, 500, 300);

  const beforeScore = game.scores[0];
  const beforeRound = game.roundScores[0];
  const beforeHits = game.roundHits[0];
  game.arrows.push({
    id: 999, owner: 0, x: 460, y: 300, vx: 600, vy: 0, life: 1.1, dist: 0, color: '#FFFFFF',
  });

  run(game, 0.2);

  const gained = game.scores[0] - beforeScore;
  assert.equal(gained, kit.SCORE_TARGET_TUNING.VALUE, 'hedef rakip vuruşundan (1-2) değerli olmalı');
  assert.equal(game.roundScores[0] - beforeRound, gained, 'raunt puanı da yazılmalı');
  assert.equal(game.roundHits[0], beforeHits + 1, 'isabet sayısına da işlenmeli');
  assert.equal(game.scoreTargets.length, 0, 'vurulan hedef kalkar');
  assert.equal(game.arrows.length, 0, 'ok hedefte harcanır');
});

test('engel arkasındaki hedef vurulamaz', () => {
  const game = setup();
  const target = spawnOne(game);
  assert.ok(target);
  pinTarget(target, 600, 300);
  // Rastgele haritayı temizle, tek duvarı kendimiz koy: ölçüm deterministik olsun.
  game.obstacles = [];
  // Ok yolunun üzerine duvar: swept test engeli önce bulmalı.
  game.obstacles.push({ x: 540, y: 250, w: 20, h: 100 });
  game.arrows.push({
    id: 998, owner: 0, x: 460, y: 300, vx: 600, vy: 0, life: 1.1, dist: 0, color: '#FFFFFF',
  });
  const beforeScore = game.scores[0];

  run(game, 0.5);

  assert.equal(game.scores[0], beforeScore, 'duvar arkasındaki hedef puan veremez');
  assert.equal(game.scoreTargets.length, 1, 'hedef yerinde durmalı');
});

test('raunt sıfırlanınca hedef listesi de sıfırlanır', () => {
  const game = setup();
  assert.ok(spawnOne(game));
  game.startRound();
  assert.equal(game.scoreTargets.length, 0, 'rauntlar arasında hedef sızıntısı yok');
  assert.equal(game.scoreTargetTimer, kit.SCORE_TARGET_TUNING.FIRST_AT, 'doğuş sayacı yeniden kurulur');
});

test('world paketi hedefi 6 sayılık satır olarak taşır ve validator tanır', () => {
  const game = setup();
  assert.ok(spawnOne(game));
  const frame = game.createWorldPacket();

  assert.ok(Array.isArray(frame.targets), 'targets kanalı pakette olmalı');
  assert.equal(frame.targets.length, 1);
  assert.equal(frame.targets[0].length, 6);
  assert.ok(frame.targets[0].every((v) => Number.isFinite(v)));
  assert.equal(frame.targets[0][4], kit.SCORE_TARGET_TUNING.VALUE);
  assert.ok(frame.targets[0][5] >= 0 && frame.targets[0][5] <= 1, 'ömür oranı 0..1');

  assert.ok(archerView.isValidArcherWorldFrame({ action: 'WORLD_FRAME', ...frame }));
  assert.equal(
    archerView.isValidArcherWorldFrame({ action: 'WORLD_FRAME', ...frame, targets: [[1, 2, 3, 4, 5, 9]] }),
    false,
    'ömür oranı bozuksa frame reddedilmeli',
  );
});

test('bot da kazanç nesnesini görür — insana bedava puan yolu kalmaz', () => {
  const game = setup(['human', 'bot_normal', 'empty', 'empty']);
  const target = spawnOne(game);
  assert.ok(target);

  // Nişangâh: engelsiz düz hat, hedef botun tam sağında, rakip çok uzakta.
  game.obstacles = [];
  pinTarget(target, game.arena.cx + 180, game.arena.cy);
  game.players[0].x = game.arena.left + 30;
  game.players[0].y = game.arena.top + 30;
  const bot = game.players[1];
  bot.x = game.arena.cx;
  bot.y = game.arena.cy;
  bot.angle = Math.PI;

  let aimed = false;
  for (let i = 0; i < 90; i += 1) {
    pinTarget(game.scoreTargets[0] || target, game.arena.cx + 180, game.arena.cy);
    game.update(game.lastTime + STEP);
    if (Math.abs(bot.angle) < 0.35) aimed = true;
  }
  assert.ok(aimed, `bot hedefe dönmeli (son açı: ${bot.angle})`);
});
