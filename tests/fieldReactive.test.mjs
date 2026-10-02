// Reaktif saha kenarı regresyon kalkanı (docs/ARENA_ELEVATION_PLAN.md Faz 1).
//
// Bu katmanın sözleşmesi GÖRÜNTÜ değil şudur:
//   1) Fizik değişmez — `clampToArena` darbe üretse de konum/hız sonucu eski
//      yazımla BİREBİR aynıdır (motor otoritesi, AGENTS §2).
//   2) Yalnız hızlı temas üretir; duvara yaslanıp yürümek kenarı titreştirmez.
//   3) Havuzlar SABİT boyutludur; aynı noktaya arka arkaya darbe havuzu
//      şişirmez.
//   4) Boş havuz ctx'ye TEK bir çizim bile yapmaz (bake log eşitliği korunur).
//   5) Çizim arenanın DIŞINA taşmaz.
//   6) Süresi dolan kayıt kendini temizler — motorun update sırasına girmek
//      gerekmez.
//   7) AĞ BÜTCESİ: hiçbir paket alanı yok (bkz. fieldKit.test.mjs §4).

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clearFieldReactive,
  drawFieldReactive,
  emitWallImpact,
  fieldReactiveStats,
  WALL_DEBRIS_CAP,
  WALL_IMPACT_CAP,
  WALL_IMPACT_MIN_SPEED,
} from '../src/core/fieldReactive.js';
import { clampToArena } from '../src/core/physics2d.js';
import { fieldTheme } from '../src/core/fieldKit.js';

const ARENA = Object.freeze({ left: 40, top: 24, right: 840, bottom: 456, width: 800, height: 432, unit: 1 });
const PALETTE = fieldTheme('default');

// Sanal saat: `fieldReactive` saati çağrı anında `performance.now` okur, bu
// yüzden test zamanı kendisi belirleyebilir (beklemeden ömür testi).
let virtualNow = 10_000;
beforeEach(() => {
  virtualNow = 10_000;
  globalThis.performance.now = () => virtualNow;
  clearFieldReactive();
});
afterEach(() => {
  delete globalThis.performance.now;
  clearFieldReactive();
});

/** Çizim çağrılarını string olarak sıraya yazan ctx. */
function recorder() {
  const log = [];
  const gradient = { addColorStop: () => {} };
  const target = {
    log,
    measureText: () => ({ width: 0 }),
    createLinearGradient: (...a) => { log.push(`lin(${a.map(fmt).join(',')})`); return gradient; },
    createRadialGradient: (...a) => { log.push(`rad(${a.map(fmt).join(',')})`); return gradient; },
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => { log.push(`${String(key)}(${args.map(fmt).join(',')})`); };
    },
    set(t, key, value) { t[key] = value; return true; },
  });
}

const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v));

function draw(arena = ARENA) {
  const ctx = recorder();
  drawFieldReactive(ctx, arena, PALETTE);
  return ctx.log;
}

// ---------------------------------------------------------------------------
// 1. Fizik değişmez
// ---------------------------------------------------------------------------
test('clampToArena keeps its old physics result on all four walls', () => {
  const cases = [
    { p: { x: 10, y: 200, vx: -50, vy: 0 }, r: 20, expect: { x: 60, y: 200 } },
    { p: { x: 900, y: 200, vx: 50, vy: 0 }, r: 20, expect: { x: 820, y: 200 } },
    { p: { x: 400, y: 5, vx: 0, vy: -50 }, r: 20, expect: { x: 400, y: 44 } },
    { p: { x: 400, y: 500, vx: 0, vy: 50 }, r: 20, expect: { x: 400, y: 436 } },
  ];
  for (const { p, r, expect } of cases) {
    const out = { ...p };
    clampToArena(out, r, ARENA, { zeroVelocity: true });
    assert.equal(out.x, expect.x);
    assert.equal(out.y, expect.y);
    assert.equal(out.vx, 0, 'zeroVelocity hâlâ sıfırlıyor');
    assert.equal(out.vy, 0, 'zeroVelocity hâlâ sıfırlıyor');
  }
});

// ---------------------------------------------------------------------------
// 2. Yalnız hızlı temas üretir
// ---------------------------------------------------------------------------
test('a dash into the wall opens one impact; walking into it does not', () => {
  const walk = { x: 50, y: 200, vx: -220, vy: 0 };
  clampToArena(walk, 20, ARENA);
  draw();
  assert.equal(fieldReactiveStats.impacts, 0, 'yürüyüş hızı eşiği geçmemeli');

  const dash = { x: 50, y: 200, vx: -900, vy: 0 };
  clampToArena(dash, 20, ARENA);
  assert.equal(dash.x, 60, 'konum yine de kırpıldı');
  const ctx = recorder();
  drawFieldReactive(ctx, ARENA, PALETTE);
  assert.equal(fieldReactiveStats.impacts, 1);
  assert.ok(ctx.log.length > 0, 'canlı darbe ctx\'ye çizmelidir');
});

test('the gate scales with `unit` and is skipped by zeroVelocity clamping', () => {
  const small = { ...ARENA, unit: 0.4 };
  const fast = { x: 0, y: 200, vx: -400, vy: 0 };
  clampToArena(fast, 20, small, { zeroVelocity: true });
  assert.equal(fast.x, 60, 'kırpma değişmez');
  draw(small);
  assert.equal(fieldReactiveStats.impacts, 1, 'darbe, hız sıfırlansa da kaydedilir (sunum, fizik değil)');
});

test('the arena normal points inward on every wall', () => {
  // Sol duvar → +x (içeri), sağ → −x, üst → +y, alt → −y.
  const walls = [
    { x: 50, y: 200, vx: -900, vy: 0 },
    { x: 900, y: 200, vx: 900, vy: 0 },
    { x: 400, y: 5, vx: 0, vy: -900 },
    { x: 400, y: 500, vx: 0, vy: 900 },
  ];
  for (const p of walls) clampToArena(p, 20, ARENA);
  const log = draw();
  assert.equal(fieldReactiveStats.impacts, 4);
  // Her duvar kendi kenarına çizer: dört farklı kenar, dört çizim grubu.
  assert.ok(log.filter((entry) => entry.startsWith('stroke(')).length >= 4,
    'dört duvarın tepkisi kenara çizilmeli');
});

test('a zero axis component never becomes a wall on the wrong side', () => {
  // REGRESYON: normal `nx >= 0 ? 1 : -1` ile normalize edilirse alt duvar
  // (0,−1) darbesi (−1 olması gereken yerde +1 alıp) SOL duvar gibi
  // çiziliyor ve arenanın dışına, saha dışı zemine taşıyordu.
  const below = { x: 400, y: 900, vx: 0, vy: 1200 };
  clampToArena(below, 20, ARENA);
  virtualNow += 45;
  const log = draw();
  assert.equal(fieldReactiveStats.impacts, 1);

  const points = log
    .map((entry) => entry.match(/^(?:moveTo|lineTo)\(([-\d.]+),([-\d.]+)/))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2])]);
  // Alt duvarın tepkisi yatay bir katlamadır: hiçbir nokta duvarın ALTINDA
  // değil (yanlış eksende çizilseydi `edge + yarı uzunluk` kadar aşağı
  // inerdi) ve katlama omurgası yatay (iki nokta aynı y'de).
  for (const [, y] of points) {
    assert.ok(y <= ARENA.bottom + 0.001, `alt duvar tepkisi ${y} y'sinde — arenanın altına taştı`);
  }
  const ys = points.map(([, y]) => y);
  assert.ok(ys.some((y, i) => ys.indexOf(y) !== i), 'katlama omurgası yatay olmalı (eş y değerleri)');
});

// ---------------------------------------------------------------------------
// 3. Havuzlar sabit boyutlu
// ---------------------------------------------------------------------------
test('repeated impacts on one spot refresh instead of growing the pool', () => {
  for (let i = 0; i < 40; i += 1) {
    emitWallImpact({ x: ARENA.left, y: 200, nx: 1, ny: 0, speed: 900, unit: 1 });
    virtualNow += 8;
  }
  draw();
  assert.equal(fieldReactiveStats.impacts, 1, 'aynı noktadaki darbeler tek kayıtta birleşir');
  assert.ok(fieldReactiveStats.debris > 0, 'her tazeleme tozu yeniler');
  assert.ok(fieldReactiveStats.debris <= WALL_DEBRIS_CAP);
});

test('the impact and debris pools never exceed their caps', () => {
  for (let i = 0; i < 500; i += 1) {
    emitWallImpact({
      x: ARENA.left,
      y: 30 + i * 0.9,
      nx: 1,
      ny: 0,
      speed: 900,
      unit: 1,
    });
    virtualNow += 200;
  }
  draw();
  assert.ok(fieldReactiveStats.impacts <= WALL_IMPACT_CAP, `impact havuzu ${fieldReactiveStats.impacts}`);
  assert.ok(fieldReactiveStats.debris <= WALL_DEBRIS_CAP, `debris havuzu ${fieldReactiveStats.debris}`);
});

test('below-gate speeds never allocate', () => {
  assert.equal(emitWallImpact({ x: 0, y: 0, nx: 1, ny: 0, speed: WALL_IMPACT_MIN_SPEED - 1, unit: 1 }), false);
  assert.equal(emitWallImpact({ x: 0, y: 0, nx: 1, ny: 0, speed: Number.NaN, unit: 1 }), false);
  assert.equal(emitWallImpact({ x: Number.NaN, y: 0, nx: 1, ny: 0, speed: 900, unit: 1 }), false);
  assert.equal(draw().length, 0);
});

// ---------------------------------------------------------------------------
// 4-6. Çizim sözleşmesi
// ---------------------------------------------------------------------------
test('an empty pool draws nothing at all', () => {
  assert.deepEqual(draw(), [], 'temsil yok: statik katman logu bozulmamalı');
});

test('expired impacts retire themselves without an update tick', () => {
  emitWallImpact({ x: ARENA.left, y: 200, nx: 1, ny: 0, speed: 900, unit: 1 });
  assert.ok(draw().length > 0);
  virtualNow += 400; // IMPACT_LIFE (0.34 sn) üstü
  assert.deepEqual(draw(), [], 'süresi dolan kayıt kendini kapatır');
  assert.equal(fieldReactiveStats.impacts, 0);
  assert.equal(fieldReactiveStats.debris, 0);
});

test('the reaction is clipped to the arena box, so nothing leaks into the surround', () => {
  for (let i = 0; i < 24; i += 1) {
    emitWallImpact({
      x: i % 2 ? ARENA.right : ARENA.left,
      y: ARENA.top + 4 + i * 17,
      nx: i % 2 ? -1 : 1,
      ny: 0,
      speed: 1200,
      unit: 1,
    });
  }
  virtualNow += 45;
  const log = draw();
  assert.ok(log.length > 0);

  // Kırpma, arena kutusuna birebir oturuyor ve ilk çizimden ÖNCE kuruluyor.
  // Tepki katmanının tek "dışarı taşma" güvencesi budur: katlama kenar boyunca
  // uzanır (köşeye yakın darbede komşu duvarı geçebilir) ve toz teğet yönde
  // yürür — ikisi de burada kesiliyor.
  const rectAt = log.indexOf(`rect(${ARENA.left},${ARENA.top},${ARENA.width},${ARENA.height})`);
  assert.ok(rectAt >= 0, `arena kutusu kırpılmıyor: ${log.join(' | ')}`);
  assert.equal(log[rectAt + 1], 'clip()', 'rect hemen clip() izlemeli');
  assert.equal(log.at(-1), 'restore()', 'kırpma kapanmalı (save/restore dengesi)');
});

test('a wall reaction only ever pushes inward, never through the wall', () => {
  // Her duvar için: tepkinin DİKEY (içe bakan) koordinatı arenanın dışına
  // geçemez. Kenar boyunca uzama (teğet) serbest — köşeye yakın darbede
  // komşu duvarı aşar, onu kırpma tutar.
  const walls = [
    { hit: { x: ARENA.left, y: 200, nx: 1, ny: 0 }, axis: 0, min: ARENA.left, max: ARENA.right },
    { hit: { x: ARENA.right, y: 200, nx: -1, ny: 0 }, axis: 0, min: ARENA.left, max: ARENA.right },
    { hit: { x: 400, y: ARENA.top, nx: 0, ny: 1 }, axis: 1, min: ARENA.top, max: ARENA.bottom },
    { hit: { x: 400, y: ARENA.bottom, nx: 0, ny: -1 }, axis: 1, min: ARENA.top, max: ARENA.bottom },
  ];
  for (const { hit, axis, min, max } of walls) {
    clearFieldReactive();
    emitWallImpact({ ...hit, speed: 1200, unit: 1 });
    virtualNow += 45;
    const log = draw();
    const coords = log
      .map((entry) => entry.match(/^(?:moveTo|lineTo)\(([-\d.]+),([-\d.]+)/))
      .filter(Boolean)
      .map((m) => [Number(m[1]), Number(m[2])]);
    assert.ok(coords.length > 0, `(${hit.nx},${hit.ny}) tepkisi çizilmedi`);
    for (const point of coords) {
      const v = point[axis];
      assert.ok(v >= min - 0.5 && v <= max + 0.5, `(${hit.nx},${hit.ny}) tepkisi ${axis ? 'y' : 'x'}=${v} — duvarın ötesine geçti`);
    }
  }
});

test('degenerate arenas and null contexts never throw', () => {
  emitWallImpact({ x: ARENA.left, y: 200, nx: 1, ny: 0, speed: 900, unit: 1 });
  const ctx = recorder();
  assert.doesNotThrow(() => drawFieldReactive(ctx, null, PALETTE));
  assert.doesNotThrow(() => drawFieldReactive(null, ARENA, PALETTE));
  assert.doesNotThrow(() => drawFieldReactive(ctx, { left: 0, top: 0, width: 0, height: 0 }, PALETTE));
});

// ---------------------------------------------------------------------------
// 7. Ağ bütçesi ve determinizm
// ---------------------------------------------------------------------------
test('the reactive layer is not networked and stays deterministic', () => {
  const source = readFileSync(join(process.cwd(), 'src/core/fieldReactive.js'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  for (const forbidden of ['Math.random', 'fetch', 'WebSocket', 'supabase', 'postMessage']) {
    assert.equal(source.includes(forbidden), false, `fieldReactive ${forbidden} kullanmamalı`);
  }
  // Aynı darbe iki kez → birebir aynı çizim (toz/kıvılcım yönleri hash'ten).
  emitWallImpact({ x: ARENA.left, y: 200, nx: 1, ny: 0, speed: 900, unit: 1 });
  const first = draw();
  clearFieldReactive();
  emitWallImpact({ x: ARENA.left, y: 200, nx: 1, ny: 0, speed: 900, unit: 1 });
  assert.deepEqual(draw(), first, 'aynı darbe aynı kıymıkları üretmeli');
});