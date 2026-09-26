// fieldKit regresyon kalkanı — saha katmanı görsel zenginlik katmanıdır, bu yüzden
// testler görseli değil KONTRACT'INI korur:
//   1) Dekor deterministiktir (host ↔ client aynı seed ⇒ aynı katman).
//   2) Statik katman bir kez pişirilir, sonraki frame'ler blit eder.
//   3) Geçersizleştirme doğru anahtarlarda olur (seed, arena, dpr, variant).
//   4) Katman AĞA ALAN EKLEMEZ — pilot oyunların paket anahtarları sabittir.
//   5) DOM'suz ortamda (test/SSR) doğrudan çizime düşer, çökmez.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FIELD_THEMES,
  drawField,
  fieldLayerStats,
  fieldTheme,
  hashFieldSeed,
  paintFieldLayer,
  releaseFieldLayers,
} from '../src/core/fieldKit.js';
import { computePlayfield } from '../src/core/playfield.js';
import { pongGoalPatches, pongGoalVariant } from '../src/games/pongView.js';
import { createBombWorldPacket } from '../src/games/bombView.js';
import { createPongWorldPacket } from '../src/games/pongView.js';
import { createHordeWorldPacket } from '../src/games/hordeView.js';

const TABLET = [1180, 820];
const PHONE = [852, 393];

// ---------------------------------------------------------------------------
// Kaydeden ctx — her çizim çağrısını string olarak sıraya yazar. Piksellere
// bakmadan "aynı seed ⇒ aynı katman" sözleşmesini ölçmemizi sağlar.
// ---------------------------------------------------------------------------
function recorder() {
  const log = [];
  const gradient = { addColorStop: () => {} };
  const target = {
    log,
    measureText: () => ({ width: 0 }),
    createLinearGradient: (...a) => { log.push(`linGrad(${a.map((v) => Math.round(v * 100) / 100)})`); return gradient; },
    createRadialGradient: (...a) => { log.push(`radGrad(${a.map((v) => Math.round(v * 100) / 100)})`); return gradient; },
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => { log.push(`${String(key)}(${args.map(fmt).join(',')})`); };
    },
    set(t, key, value) { t[key] = value; return true; },
  });
}

function fmt(value) {
  return typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value);
}

function paint(arena, palette, opts) {
  const ctx = recorder();
  paintFieldLayer(ctx, arena, palette, opts);
  return ctx.log;
}

function resetStats() {
  releaseFieldLayers();
  delete globalThis.document;
  fieldLayerStats.bakes = 0;
  fieldLayerStats.blits = 0;
  fieldLayerStats.fallbacks = 0;
}

// Testler birbirinden bağımsız olmalı: bir test çökerse istatistik ve canvas
// taklidi sonraki testi kirletmesin.
beforeEach(resetStats);

/** `document.createElement('canvas')` taklid eden offscreen üretici. */
function installCanvasStub() {
  const created = [];
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => {
          const ctx = recorder();
          canvas.ctx = ctx;
          return ctx;
        },
      };
      created.push(canvas);
      return canvas;
    },
  };
  return created;
}

// ---------------------------------------------------------------------------
// 1. Deterministik seed
// ---------------------------------------------------------------------------
test('hashFieldSeed is pure, stable and round-sensitive', () => {
  const a = hashFieldSeed('BOMB', 3);
  assert.equal(a, hashFieldSeed('BOMB', 3));
  assert.ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff);
  assert.notEqual(a, hashFieldSeed('BOMB', 4), 'roundId decoru değiştirmeli');
  assert.notEqual(a, hashFieldSeed('PONG', 3), 'mode decoru değiştirmeli');
  // Negatif/NaN girişler çökmez ve 0'a yakınlanır.
  assert.equal(hashFieldSeed('BOMB', -5), hashFieldSeed('BOMB', 0));
  assert.equal(hashFieldSeed('BOMB', Number.NaN), hashFieldSeed('BOMB', 0));
  assert.equal(hashFieldSeed(undefined, undefined), hashFieldSeed('FIELD', 0));
});

test('identical seed produces an identical field layer on any device', () => {
  const arena = computePlayfield(...TABLET, 'standard');
  const palette = fieldTheme('PONG');
  const seed = hashFieldSeed('PONG', 7);

  const first = paint(arena, palette, { seed });
  const second = paint(arena, palette, { seed });
  assert.deepEqual(second, first, 'aynı seed ⇒ birebir aynı çizim sırası');

  const otherRound = paint(arena, palette, { seed: hashFieldSeed('PONG', 8) });
  assert.notDeepEqual(otherRound, first, 'farklı raunt ⇒ farklı dekor');
});

test('field layer geometry stays inside the arena and scales with unit', () => {
  const tv = computePlayfield(1920, 1080, 'standard');
  const phone = computePlayfield(...PHONE, 'standard');

  for (const arena of [tv, phone]) {
    const log = paint(arena, fieldTheme('BOMB'), { seed: 11 });
    const rects = log
      .filter((entry) => entry.startsWith('strokeRect('))
      .map((entry) => entry.slice('strokeRect('.length, -1).split(',').map(Number));
    const wall = rects.at(-1);
    assert.equal(rects.length >= 2, true, 'iç çerçeve + duvar konturu çizilmeli');
    assert.equal(wall.length, 4, `duvar 4 argümanlı olmalı: ${wall}`);
    // Duvar dikdörtgeni katman sınırları içinde kalmalı (yarım çizgi içeri alınır).
    assert.ok(wall[0] >= 0 && wall[1] >= 0, `duvar sol/üstten taşmamalı: ${wall}`);
    assert.ok(wall[0] + wall[2] <= arena.width + 0.01, 'duvar sağdan taşmamalı');
    assert.ok(wall[1] + wall[3] <= arena.height + 0.01, 'duvar alttan taşmamalı');
  }

  // Küçük saha (telefon) daha az dekor üretmeli: ince çizgi alias olmasın.
  const decalsOn = (arena) => {
    const log = paint(arena, fieldTheme('BOMB'), { seed: 11 });
    return log.filter((e) => e.startsWith('ellipse(') || e.startsWith('arc(')).length;
  };
  assert.ok(decalsOn(phone) <= decalsOn(tv), 'kompakt saha daha az dekor almalı');
});

// ---------------------------------------------------------------------------
// 2-3. Bake + cache
// ---------------------------------------------------------------------------
test('drawField bakes once and blits afterwards', () => {
  const created = installCanvasStub();
  const arena = computePlayfield(...TABLET, 'standard');
  const ctx = recorder();
  const opts = { mode: 'BOMB', seed: hashFieldSeed('BOMB', 2) };

  drawField(ctx, arena, opts);
  assert.equal(fieldLayerStats.bakes, 1);
  assert.equal(fieldLayerStats.blits, 0);
  assert.equal(created.length, 1);
  assert.equal(created[0].width, Math.round(arena.width * 1), 'dpr yoksa 1x backing store');

  drawField(ctx, arena, opts);
  drawField(ctx, arena, opts);
  assert.equal(fieldLayerStats.bakes, 1, 'geçerli katman yeniden pişirilmemeli');
  assert.equal(fieldLayerStats.blits, 2);
});

test('layer cache re-bakes on seed, arena, variant and dpr change', () => {
  installCanvasStub();
  const arena = computePlayfield(...TABLET, 'standard');
  const ctx = recorder();

  drawField(ctx, arena, { mode: 'BOMB', seed: 1 });
  drawField(ctx, arena, { mode: 'BOMB', seed: 2 });
  assert.equal(fieldLayerStats.bakes, 2, 'yeni seed yeni katman');

  drawField(ctx, { ...arena, width: arena.width + 40 }, { mode: 'BOMB', seed: 1 });
  assert.equal(fieldLayerStats.bakes, 3, 'yeni arena ölçüsü yeni katman');

  drawField(ctx, arena, { mode: 'BOMB', seed: 1, variant: 'goals-a' });
  assert.equal(fieldLayerStats.bakes, 4, 'oyuna özgü katman varyantı anahtarlanır');

  // DPR değişimi (TV'ye taşınma / world-view fit ölçeği) ayrı katman ister.
  const hidpi = recorder();
  hidpi.getTransform = () => ({ a: 2, d: 1 });
  drawField(hidpi, arena, { mode: 'BOMB', seed: 1 });
  assert.equal(fieldLayerStats.bakes, 5, 'ölçek değişimi yeni katman');
});

test('layer cache is bounded and releases evicted backing stores', () => {
  const created = installCanvasStub();
  const arena = computePlayfield(...TABLET, 'standard');
  const ctx = recorder();

  for (let round = 0; round < 5; round += 1) {
    drawField(ctx, arena, { mode: 'BOMB', seed: hashFieldSeed('BOMB', round) });
  }
  // Beş ayrı katman pişirildi ama yalnız ikisi tutuluyor; LRU kalan üçünün
  // backing store'u sıfırlanmalı (mobil bellek).
  assert.equal(fieldLayerStats.bakes, 5);
  const evicted = created.filter((canvas) => canvas.width === 0);
  assert.equal(evicted.length, 3, `3 katman serbest bırakılmalı, ${evicted.length} bırakıldı`);
  assert.ok(created[3].width > 0 && created[4].width > 0, 'en son iki katman tutulmalı');
});

test('drawField falls back to direct painting when no canvas can be created', () => {
  delete globalThis.document;
  const arena = computePlayfield(...TABLET, 'standard');
  const ctx = recorder();
  assert.doesNotThrow(() => drawField(ctx, arena, { mode: 'BOMB', seed: 5 }));
  assert.equal(fieldLayerStats.fallbacks, 1);
  assert.equal(fieldLayerStats.bakes, 0);
  // Doğrudan yol da tam katmanı çizmeli (translate ile arena köşesine kaydırılır).
  assert.ok(ctx.log.some((entry) => entry.startsWith('linGrad(')), 'zemin gradyanı çizilmeli');
  assert.ok(ctx.log.some((entry) => entry.startsWith('radGrad(')), 'vignette çizilmeli');
});

test('degenerate arenas never throw', () => {
  const ctx = recorder();
  const zero = { left: 0, top: 0, width: 0, height: 0, unit: 0 };
  assert.doesNotThrow(() => drawField(ctx, zero, { mode: 'BOMB' }));
  assert.equal(ctx.log.length, 0, 'çizilecek alan yoksa çizim de yapılmaz');

  const tiny = recorder();
  assert.doesNotThrow(() => paintFieldLayer(tiny, { width: 1, height: 1 }, fieldTheme('BOMB'), {}));
  assert.doesNotThrow(() => paintFieldLayer(tiny, { width: 120, height: 40, unit: 0.2 }, fieldTheme('BOMB'), { seed: 3 }));
});

// ---------------------------------------------------------------------------
// 4. Ağ bütçesi: paket alanı eklenmedi
// ---------------------------------------------------------------------------
test('field visuals add no packet fields (BOMB/PONG/HORDE)', () => {
  const arena = computePlayfield(...TABLET, 'standard');
  const packets = {
    BOMB: createBombWorldPacket({
      arena, pillars: [], pickups: [], inkPuddles: [], players: [], particles: [],
      bombCarrierIndex: -1, bombTimer: 10, bombMaxTime: 20, scores: [0, 0, 0, 0],
    }),
    PONG: createPongWorldPacket({
      arena, paddles: [], scores: [0, 0, 0, 0], setScores: [0, 0, 0, 0], roundId: 2,
      roundLimit: 120, roundPlayTimer: 30,
      ball: { x: 1, y: 1, radius: 12, spin: 0, rallyCount: 0, isSmash: false, isDead: false, trail: [], shockwaves: [] },
      getGoalBounds: () => ({ goalMin: 100, goalMax: 300 }),
    }),
    HORDE: createHordeWorldPacket({
      arena, theme: 'foundry', round: 1, nextRound: 2, wave: 1, totalRounds: 3, totalWaves: 3,
      players: [], enemies: [], bullets: [], tombs: [], portal: null, obstacles: [], pickups: [],
      loadoutCrates: [], texts: [], particles: [], scores: [0, 0, 0, 0], roundBreakTotal: 15,
      waveTime: 0, waveBreakTime: 0, roundBreakTime: 0, enemiesLeft: 0, waveTimedOut: false,
      isBossWave: false, matchResult: null,
    }),
  };

  // Saha görseli seed'i `(mode, roundId)`'den türetir; pakette YENİ alan yoktur.
  // Tek istisna `blast`: saha görseli değil, BOMB'un patlama katmanı (4 sayı,
  // aynı anda tek patlama) — bkz. worldCore.packBlast.
  assert.deepEqual(Object.keys(packets.BOMB).sort(), [
    'arena', 'blast', 'bombMaxTime', 'bombTimer', 'carrier', 'gameState', 'ink', 'matchDraw',
    'matchWinner', 'mode', 'particles', 'pickups', 'pillars', 'players', 'roundId',
    'roundWinner', 'scores', 'seq', 'version',
  ]);
  assert.deepEqual(Object.keys(packets.PONG).sort(), [
    'arena', 'ball', 'gameState', 'goals', 'matchWinner', 'mode', 'particles', 'players',
    'roundId', 'roundWinner', 'scores', 'seq', 'timeLeft', 'version',
  ]);
  assert.deepEqual(Object.keys(packets.HORDE).sort(), [
    'arena', 'bullets', 'enemies', 'enemiesLeft', 'gameState', 'isBossWave', 'loadoutCrates',
    'matchResult', 'matchWinner', 'mode', 'nextRound', 'obstacles', 'particles', 'phase',
    'pickups', 'players', 'portal', 'round', 'roundBreakTime', 'roundBreakTotal', 'roundId',
    'roundWinner', 'scores', 'seq', 'texts', 'theme', 'tombs', 'totalRounds', 'totalWaves',
    'version', 'wave', 'waveBreakTime', 'waveTime', 'waveTimedOut',
  ]);
});

// ---------------------------------------------------------------------------
// 5. PONG kapı boşlukları
// ---------------------------------------------------------------------------
test('pong goal patches open the wall on all four sides', () => {
  const arena = computePlayfield(...TABLET, 'standard');
  const goals = {
    top: [300, 500], bottom: [300, 500], left: [200, 400], right: [200, 400],
  };
  const patches = pongGoalPatches(arena, goals);
  assert.equal(patches.length, 4);
  for (const patch of patches) {
    assert.ok(patch.x >= arena.left - 0.01 && patch.x + patch.w <= arena.right + 0.01);
    assert.ok(patch.y >= arena.top - 0.01 && patch.y + patch.h <= arena.bottom + 0.01);
    const onEdge = [patch.x, patch.y, patch.x + patch.w, patch.y + patch.h]
      .some((v, i) => Math.abs(v - [arena.left, arena.top, arena.right, arena.bottom][i]) < 0.01);
    assert.ok(onEdge, 'yama sahanın bir kenarına yaslanmalı');
  }

  assert.deepEqual(pongGoalPatches(arena, null), []);
  assert.deepEqual(pongGoalPatches(arena, { top: [500, 300] }), [], 'ters aralık yama üretmez');
  assert.deepEqual(pongGoalPatches(arena, { top: [10, 10] }), [], 'sıfır genişlik yama üretmez');

  assert.notEqual(pongGoalVariant(goals), pongGoalVariant({ ...goals, top: [320, 520] }));
  assert.equal(pongGoalVariant(goals), pongGoalVariant({ ...goals }));
  assert.notEqual(pongGoalVariant(null), pongGoalVariant(goals));
});

// ---------------------------------------------------------------------------
// 6. Kaynak korumaları
// ---------------------------------------------------------------------------
test('fieldKit never reads wall-clock or global randomness', () => {
  const source = readFileSync(join(process.cwd(), 'src/core/fieldKit.js'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  for (const forbidden of ['Math.random', 'Date.now', 'performance.now', 'new Date']) {
    assert.equal(source.includes(forbidden), false, `fieldKit ${forbidden} kullanmamalı`);
  }
});

test('every theme is complete and the HORDE maps read from the registry', () => {
  for (const [id, palette] of Object.entries(FIELD_THEMES)) {
    for (const key of ['floor', 'floorEdge', 'grid', 'frame', 'accent', 'wall', 'wallShade', 'decal', 'motif', 'corners']) {
      assert.equal(typeof palette[key], 'string', `${id}.${key} eksik`);
    }
  }
  assert.equal(fieldTheme('foundry').accent, '#D84727');
  assert.equal(fieldTheme('FOUNDRY').motif, 'foundry', 'tema kimliği büyük/küçük harften bağımsız');
  assert.equal(fieldTheme('YOK').motif, FIELD_THEMES.default.motif, 'bilinmeyen oyun ortak sahaya düşer');
  assert.equal(fieldTheme({ floor: '#123456' }).floor, '#123456', 'nesne tema olarak kabul edilir');
});
