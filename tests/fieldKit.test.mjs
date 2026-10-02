// fieldKit regresyon kalkanı — saha katmanı görsel zenginlik katmanıdır, bu yüzden
// testler görseli değil KONTRACT'INI korur:
//   1) Dekor deterministiktir (host ↔ client aynı seed ⇒ aynı katman).
//   2) Statik katman bir kez pişirilir, sonraki frame'ler blit eder.
//   3) Geçersizleştirme doğru anahtarlarda olur (seed, arena, dpr, variant).
//   4) Katman AĞA ALAN EKLEMEZ — pilot oyunların paket anahtarları sabittir.
//   5) DOM'suz ortamda (test/SSR) doğrudan çizime düşer, çökmez.
//   6) OKUNABİLİRLİK BÜTÇESİ: zemin L* aralığı oyuncu renkleriyle çarpışamaz
//      (bkz. §8 — bu kapı olmadan "daha güzel zemin" isteği kaçınılmaz olarak
//      P3 sarısını zemine gömer).
//   7) Parity: `unit` taşımayan world-view arenasının çizimi, kırpılmış `unit`'li
//      host çizgisiyle BİREBİR aynıdır.
//   8) Bake maliyeti ve yasaklı API'lar (shadowBlur / getImageData / pattern
//      setTransform) kaynak taramasıyla kilitlidir.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FIELD_THEMES,
  THEME_FIELDS,
  drawField,
  fieldLayerStats,
  fieldTheme,
  hashFieldSeed,
  paintFieldLayer,
  releaseFieldLayers,
} from '../src/core/fieldKit.js';
import { computePlayfield, FIELD_DESIGN } from '../src/core/playfield.js';
import { UI_COLORS } from '../src/ui/tokens.js';
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

/**
 * Alan yalnız SAHA KATMANLARINI döndürür. `fieldKit` artık birden fazla canvas
 * sınıfı üretiyor ('layer' saha, 'tile' doku, 'backdrop' saha dışı); dizi
 * konumuna göre assertion yapmak ilk eklenenle kayıyor — rol etiketi tek kararlı anahtar.
 */
function layersOf(created) {
  return created.filter((canvas) => canvas.__fieldRole === 'layer');
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
    // Çerçeve çizgileri iki biçimde gelebilir: `strokeRect` (iç çerçeve) ve
    // `roundRect` + `stroke` (yuvarlak köşeli duvar). KONUMUNA göre değil,
    // EN GENİŞ olanına göre denetlenir — bir şey sonradan eklendiğinde
    // pozisyon-bazlı assertion yanlış hedefe geçip yine geçer.
    const frames = log
      .filter((e) => e.startsWith('strokeRect(') || e.startsWith('roundRect('))
      // `roundRect` 5. argüman olarak yarıçap taşır; kutu yine ilk dördüdür.
      .map((e) => e.slice(e.indexOf('(') + 1, -1).split(',').slice(0, 4).map(Number));
    assert.ok(frames.length >= 3, `iç çerçeve + duvar bandı + dış kontur çizilmeli (${frames.length})`);
    const wall = frames.reduce((a, b) => (b[2] * b[3] > a[2] * a[3] ? b : a));
    assert.equal(wall.length, 4, `duvar 4 argümanlı olmalı: ${wall}`);
    assert.ok(wall[0] >= 0 && wall[1] >= 0, `duvar sol/üstten taşmamalı: ${wall}`);
    assert.ok(wall[0] + wall[2] <= arena.width + 0.01, 'duvar sağdan taşmamalı');
    assert.ok(wall[1] + wall[3] <= arena.height + 0.01, 'duvar alttan taşmamalı');
    // Yuvarlatılmış köşe: dış kontur bir `roundRect` olmalı (köşeli çerçeve
    // "ekrana yapıştırılmış kutu" okutuyordu — kullanıcı raporu).
    const lastFrame = log.filter((e) => e.startsWith('roundRect('));
    assert.ok(lastFrame.length >= 2, 'duvar bandı yuvarlak köşeli olmalı');
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
  const layers = layersOf(created);
  assert.equal(layers.length, 1, 'tek saha katmanı pişirilmeli');
  assert.equal(layers[0].width, Math.round(arena.width * 1), 'dpr yoksa 1x backing store');

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
  // backing store'u sıfırlanmalı (mobil bellek). Doku tile'ları serbest
  // bırakılmaz — onlar raunttan bağımsız, oturum başına yeniden kullanılır.
  assert.equal(fieldLayerStats.bakes, 5);
  const layers = layersOf(created);
  assert.equal(layers.length, 5, 'beş saha katmanı pişirilmeli');
  const evicted = layers.filter((canvas) => canvas.width === 0);
  assert.equal(evicted.length, 3, `3 katman serbest bırakılmalı, ${evicted.length} bırakıldı`);
  assert.ok(layers[3].width > 0 && layers[4].width > 0, 'en son iki katman tutulmalı');
  assert.equal(created.filter((c) => c.__fieldRole === 'tile').length, 1,
    'doku deseni anahtarsız yeniden kullanılır, beş bake üretmez');
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
  // aynı anda tek patlama) — bkz. worldCore.packBlast. `selfPredict` de saha
  // görseli değil: client self-avatar prediction opt-in bayrağı (core/selfPrediction).
  // `mapIndex`: 2.5D saha teması haritaya bağlıdır (BOMB); client aynı temayı
  // paketten türetir (bombView.bombThemeForMap). İstemci tarafı çizim tercihi
  // değil, host↔client sahne eşleşmesi için gereken simülasyon alanıdır.
  // `fx`: host FX runtime anlık görüntüsü (rings/pops/flash — tanks deseni,
  // Faz 2'de portlanan motorlara eklendi: BOMB/PONG; v1 yedeği, playback
  // canlıyken yok sayılır). HORDE artık `fx` TAŞIMAZ: FX anlık güvenilir
  // kanaldan gelir (MOTION_PLAN "kaldırma kararı Parça 4"), bu yüzden anahtar
  // listesinde `fx` yoktur; `particles` şema uyumu için boş kalır.
  assert.deepEqual(Object.keys(packets.BOMB).sort(), [
    'arena', 'blast', 'bombMaxTime', 'bombTimer', 'carrier', 'fx', 'gameState', 'ink', 'mapIndex',
    'matchDraw', 'matchWinner', 'mode', 'particles', 'pickups', 'pillars', 'players', 'roundId',
    'roundWinner', 'scores', 'selfPredict', 'seq', 'version',
  ]);
  assert.deepEqual(Object.keys(packets.PONG).sort(), [
    'arena', 'ball', 'fx', 'gameState', 'goals', 'matchWinner', 'mode', 'particles', 'players',
    'roundId', 'roundWinner', 'scores', 'seq', 'timeLeft', 'version',
  ]);
  assert.deepEqual(Object.keys(packets.HORDE).sort(), [
    'arena', 'bullets', 'enemies', 'enemiesLeft', 'gameState', 'isBossWave', 'loadoutCrates',
    'matchResult', 'matchWinner', 'mode', 'nextRound', 'obstacles', 'particles', 'phase',
    'pickups', 'players', 'portal', 'round', 'roundBreakTime', 'roundBreakTotal', 'roundId',
    'roundWinner', 'scores', 'selfPredict', 'seq', 'texts', 'theme', 'tombs', 'totalRounds', 'totalWaves',
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

test('theme ids resolve case-insensitively and unknown games share one field', () => {
  // Alan bütünlüğü bir sonraki testte THEME_FIELDS'tan TÜRETİLİR olarak denetlenir;
  // burada elle anahtar listesi yazmak, sözleşme her değiştiğinde yalan söyleyen
  // bir ikinci kaynak olurdu (ilk hali tam olarak bunu yaptı).
  assert.equal(fieldTheme('foundry').accent, '#D84727');
  assert.equal(fieldTheme('FOUNDRY').motif, 'foundry', 'tema kimliği büyük/küçük harften bağımsız');
  assert.equal(fieldTheme('YOK').motif, FIELD_THEMES.default.motif, 'bilinmeyen oyun ortak sahaya düşer');
  assert.equal(fieldTheme({ floor: '#123456' }).floor, '#123456', 'nesne tema olarak kabul edilir');
  // HORDE haritaları registry'den yayılır — oradan gelen tema kimliği çözülmeli.
  for (const id of ['foundry', 'reactor', 'core']) {
    assert.ok(FIELD_THEMES[id], `HORDE harita teması ${id} registry'de olmalı`);
    assert.equal(fieldTheme(id), FIELD_THEMES[id]);
  }
});

// ---------------------------------------------------------------------------
// 7. Tema sözleşmesi — liste elle yazılmaz, THEME_FIELDS'tan TÜRETİLİR
// ---------------------------------------------------------------------------
test('themes carry every contract field, with primitive types only', () => {
  const base = fieldTheme('default');
  for (const [id, palette] of Object.entries(FIELD_THEMES)) {
    for (const key of THEME_FIELDS) {
      assert.ok(key in palette, `${id}.${key} eksik`);
      assert.equal(typeof palette[key], typeof base[key], `${id}.${key} tipi THEME_BASE ile uyuşmalı`);
    }
  }
  // Sığ yayılım tuzağı: HORDE haritaları temaları `{...FIELD_THEMES.foundry}`
  // şeklinde türetir. Nested bir nesne üç haritada AYNI referansı taşır ve
  // Object.freeze alt nesneyi dondurmaz. Bu yüzden sözleşme primitif ister.
  for (const [id, palette] of Object.entries(FIELD_THEMES)) {
    for (const key of THEME_FIELDS) {
      assert.notEqual(typeof palette[key], 'object', `${id}.${key} nested olamaz (sığ yayılım)`);
    }
  }
  // Yazım hatası sessizce varsayılanı ezmesin.
  assert.equal(fieldTheme({ floorHighh: '#000000' }).floorHigh, base.floorHigh);
});

// ---------------------------------------------------------------------------
// 8. OKUNABİLİRLİK BÜTÇESİ — renkli sahalar, kontur-korumalı okunurluk.
//
//    KARAR (2026-09-30, MOTION_PLAN §Zemin-L* Kısıtı Gevşetme): zemin-L*
//    alt sınırı 92.5 → 75'e indirildi. Orijinal sınır P3 sarısı (#FFD24A,
//    L*=85.9) ile zemin çakışmasını önlemek için vardı. Yeni tasarım kararı:
//    oyuncu okunurluğu zemin parlaklığından değil avatarın `#1A1A1A` koyu
//    konturu ile sağlanır. L*≥75 zemini L*~40-60 oyuncu renklerinden >14
//    puan parlak — konturla yeterli ayrışma garantilidir.
//    ΔL* ≤ 14 (eski 6): renkli rampalara alan açar.
// ---------------------------------------------------------------------------
const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** Yalnız CIE L* yeterli: ayrışma ışık şiddetiyle satın alınıyor/yitiriliyor. */
function lstar(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  const Y = 0.2126 * srgbToLinear((v >> 16) & 255)
    + 0.7152 * srgbToLinear((v >> 8) & 255)
    + 0.0722 * srgbToLinear(v & 255);
  return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y;
}

test('floor stays inside the legibility budget against every player color', () => {
  const FLOOR_KEYS = ['floor', 'floorHigh', 'floorEdge', 'floorLow'];
  // Kontur-korumalı bütçe: zemin L* ≥ 75 (MOTION_PLAN §Zemin-L* Kısıtı Gevşetme).
  // Oyuncu konturları #1A1A1A (L*≈10) ile zeminden ayrışır; L* farkı 14+ puan.
  const SHADING_ALLOWANCE = 1.5;
  const players = UI_COLORS.players.map((hex) => ({ hex, L: lstar(hex) }));
  const darkestPlayer = Math.min(...players.map((p) => p.L));

  for (const [id, palette] of Object.entries(FIELD_THEMES)) {
    const ramp = FLOOR_KEYS.map((key) => ({ key, L: lstar(palette[key]) }));
    for (const { key, L } of ramp) {
      assert.ok(L <= 97.5, `${id}.${key} L*=${L.toFixed(1)}: üst sınır 97.5 — beyaza patlıyor`);
      assert.ok(L >= 75, `${id}.${key} L*=${L.toFixed(1)}: alt sınır 75 — oyuncu konturu L*~10, fark >14 gerekli`);
    }
    const span = Math.max(...ramp.map((r) => r.L)) - Math.min(...ramp.map((r) => r.L));
    assert.ok(span <= 14, `${id}: zemin L* aralığı ${span.toFixed(1)} > 14`);
    const floorMin = Math.min(...ramp.map((r) => r.L));
    assert.ok(floorMin - SHADING_ALLOWANCE > darkestPlayer,
      `${id}: en koyu zemin (${floorMin.toFixed(1)}) en koyu oyuncu renginden (${darkestPlayer.toFixed(1)}) yukarıda kalmalı`);
  }
});

test('the brightest floor never blows out to white', () => {
  for (const [id, palette] of Object.entries(FIELD_THEMES)) {
    assert.ok(lstar(palette.floorHigh) < 97.5, `${id}.floorHigh beyaza patlıyor`);
    assert.ok(lstar(palette.floorHigh) >= 75, `${id}.floorHigh çok koyu — oyuncu okunurluk bütçesi`);
  }
});

// ---------------------------------------------------------------------------
// 9. Parity ve maliyet kapıları
// ---------------------------------------------------------------------------
test('a bare arena (no `unit` field) paints exactly like the clamped playfield', () => {
  // World-view arenaları `unit` TAŞIMAZ (ör. ui/tanksWorldView.js kutu üretir).
  // `arenaUnit` yedeği kırpılmazsa aynı cache anahtarı host'ta ve telefonda
  // FARKLI geometri çizerdi.
  for (const [w, h] of [PHONE, TABLET, [2340, 1080], [420, 900]]) {
    const full = computePlayfield(w, h, 'standard');
    const bare = { ...full };
    delete bare.unit;
    const seed = hashFieldSeed('BOMB', 4);
    assert.deepEqual(paint(bare, fieldTheme('BOMB'), { seed }), paint(full, fieldTheme('BOMB'), { seed }),
      `${w}x${h}: unit'suz arena farklı çizemez`);
    // Kırpma gerçekten devrede: eşik altı bir kutu `minUnit`e oturmalı.
    assert.ok(full.unit >= FIELD_DESIGN.minUnit && full.unit <= FIELD_DESIGN.maxUnit);
  }
});

test('sub-pixel arena drift never re-bakes (2px key quantization)', () => {
  installCanvasStub();
  const arena = computePlayfield(...TABLET, 'standard');
  const ctx = recorder();
  drawField(ctx, arena, { mode: 'BOMB', seed: 9 });
  drawField(ctx, { ...arena, left: arena.left + 0.6, top: arena.top + 1.1, width: arena.width + 0.8 }, { mode: 'BOMB', seed: 9 });
  assert.equal(fieldLayerStats.bakes, 1, 'alt-piksel sürüklenme yeniden pişirmemeli');
  assert.equal(fieldLayerStats.blits, 1);
  // 2 px'ten büyük kayma AYNI katmanı yeniden kullanamaz (ölçek değişti).
  drawField(ctx, { ...arena, width: arena.width + 40 }, { mode: 'BOMB', seed: 9 });
  assert.equal(fieldLayerStats.bakes, 2);
});

test('the texture cache never changes the painted layer log', () => {
  // Tile kendi canvas'ına kurulur; katman ctx'i yalnız `createPattern` + bir
  // dolgu görür. Desen katman ctx'ine kurulsa idi, ikinci çağrıda cache isabeti
  // logu kısaltır ve "aynı seed ⇒ aynı katman" assertion'ı bunu YAKALAMAZDI.
  const created = installCanvasStub();
  const arena = computePlayfield(...TABLET, 'standard');
  const ctx = recorder();
  drawField(ctx, arena, { mode: 'BOMB', seed: 21 });
  const firstLayerLog = [...layersOf(created)[0].ctx.log];
  releaseFieldLayers();
  drawField(ctx, arena, { mode: 'BOMB', seed: 21 });
  assert.deepEqual(layersOf(created)[0].ctx.log, firstLayerLog, 'desen önbelleği katman logunu değiştirmemeli');
});

test('bake cost stays bounded on a full-HD field', () => {
  // Katman başına bedava ama SINIRSIZ bake = ilk karede 40 ms tekleme ve
  // resize fırtınası. Sayı literal: bake op'ları artırılsa önce bu tavan konuşur.
  const arena = computePlayfield(1920, 1080, 'standard');
  const log = paint(arena, fieldTheme('default'), { seed: 12345 });
  assert.ok(log.length < 900, `bake op sayısı ${log.length} — tavan 900`);
});

test('the bake path never touches the known perf and determinism cliffs', () => {
  const source = readFileSync(join(process.cwd(), 'src/core/fieldKit.js'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  for (const forbidden of [
    'Math.random', 'Date.now', 'performance.now', 'new Date',
    'shadowBlur',           // 2D canvas'ta GPU hızlı yolunu kapatır
    'ctx.filter',           // tam ekran konvolüsyon
    'createImageData', 'getImageData', // test recorder'ında .data undefined
  ]) {
    assert.equal(source.includes(forbidden), false, `fieldKit ${forbidden} kullanmamalı`);
  }
  // `setTransform` YALNIZ bake kurulumundaki satırlara aittir (`lctx` ölçek
  // dönüşümü). Desen YOLUNA ya da bir CanvasPattern'a taşınırsa çizim bozulur:
  // recorder'da TypeError, gerçek ctx'te hizasız dikiş. Üç bake kurulumu var:
  // 2D saha katmanı + backdrop + 2.5D zemin katmanı.
  const setTransforms = source.match(/setTransform\(/g) || [];
  const layerSetTransforms = source.match(/lctx\.setTransform\(/g) || [];
  assert.equal(setTransforms.length, layerSetTransforms.length,
    'setTransform yalnız lctx (bake kurulumu) üzerinde kullanılmalı');
  assert.equal(layerSetTransforms.length, 3, 'üç bake kurulumu: saha katmanı + backdrop + 2.5D zemin');
});
