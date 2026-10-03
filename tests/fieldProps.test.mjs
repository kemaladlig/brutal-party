// Reaktif prop katmanı regresyon kalkanı (docs/ARENA_ELEVATION_PLAN.md Faz 5).
//
// Bu katmanın sözleşmesi GÖRSEL değil şudur:
//   1) `propImpactPower` SAF kapıdır: hız/gövde oranı ölçeksizdir — cihaz
//      farkı eşiği kaydıramaz, yürüyüş titretmez, dash/tackle titretir.
//   2) Üreticiler TEK geçittedir: gövde teması `physics2d.resolveAABB`,
//      mermi teması `fxRuntime.emit('spark')`. Başka motor kodu tepki üretmez.
//   3) Havuz SABİTTİR (8); aynı noktadaki darbe yenisini açmaz, mevcudu tazeler.
//   4) Boş havuz ctx'ye TEK bir çizim bile yapmaz (bake log eşitliği korunur).
//   5) Süresi dolan darbe kendini temizler — motorun `update` sırasına girilmez.
//   6) Gizmo katmanı TEMA opt-in'dir (`bumpers`/`gizmos`); kapalı temada tek op yok.
//   7) AĞ BÜTCESİ (§6): paket alanı yok, kare başına gradyan/nesne tahsisi yok.
//   8) DETERMİNİZM: aynı darbe iki kez → birebir aynı çizim (`Math.random` yok).

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROP_HIT_LIFE,
  PROP_IMPACT_CAP,
  PROP_IMPACT_MIN_RATE,
  clearFieldProps,
  drawPropCracks,
  drawPropGizmos,
  emitPropImpact,
  emitPropSpark,
  fieldPropsStats,
  propFlinchOffset,
  propHitFor,
  propImpactPower,
  setWallBounce,
} from '../src/core/fieldProps.js';
import { clampToArena, resolveAABB } from '../src/core/physics2d.js';
import { drawField, fieldTheme, releaseFieldLayers } from '../src/core/fieldKit.js';
import { drawObstacle } from '../src/core/arenaKit.js';

const ARENA = Object.freeze({ left: 40, top: 24, width: 800, height: 432, unit: 1 });
const PALETTE = fieldTheme('default');

// "normal" tier: gövde 36 tasarım px. Yürüme 190-256 px/s → 5.3-7.1 gövde/sn.
// Dash/tackle 340-480 px/s → 9.4-13.3 gövde/sn. Eşik 8.2 ikisinin arasındadır.
const R = 36;

let virtualNow = 10_000;
let reducedMotion = false;
beforeEach(() => {
  virtualNow = 10_000;
  reducedMotion = false;
  globalThis.performance.now = () => virtualNow;
  // motion.js `mq`'yu ilk çağrıda önbellekler; `matches` getter'ı canlı bayrağı
  // okur → reduced-motion testi modül önbelleğini kirlemeden bayrağı çevirir.
  globalThis.window = { matchMedia: () => ({ get matches() { return reducedMotion; } }) };
  clearFieldProps();
});
afterEach(() => {
  delete globalThis.performance.now;
  delete globalThis.window;
  clearFieldProps();
});

/** Çizim çağrılarını VE özellik yazımlarını string olarak sıraya yazan ctx. */
function recorder() {
  const log = [];
  const gradient = { addColorStop: () => {} };
  const target = {
    log,
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => { log.push(`${String(key)}(${args.map(fmt).join(',')})`); };
    },
    set(t, key, value) {
      log.push(`${String(key)}=${fmt(value)}`);
      t[key] = value;
      return true;
    },
  });
}

const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

// ---------------------------------------------------------------------------
// 1. Saf kapı: propImpactPower
// ---------------------------------------------------------------------------
test('propImpactPower: eşik altı 0, eşik üstü (0,1]', () => {
  assert.equal(propImpactPower(0, R), 0, 'durmak titretmez');
  assert.equal(propImpactPower(256, R), 0, 'yürüyüş (7.1 gövde/sn) titretmez');
  assert.ok(propImpactPower(340, R) > 0, 'tackle (9.4) titretir');
  assert.ok(propImpactPower(480, R) > 0, 'dash (13.3) titretir');
  // Ölçeksizlik: hız ve yarıçap aynı çarpanla büyürse güç AYNI kalır (1 ulp'lik
  // float yuvarlaması hariç — `r1` gibi kaba değil, epsilon'la karşılaştır).
  const design = propImpactPower(400, 36);
  const scaled = propImpactPower(400 * 0.6, 36 * 0.6);
  assert.ok(Math.abs(design - scaled) < 1e-9, 'ölçek eşiği kaydırmamalı');
});

test('propImpactPower: yoz girişler güvenli', () => {
  assert.equal(propImpactPower(NaN, R), 0);
  assert.equal(propImpactPower(400, 0), 0);
  assert.equal(propImpactPower(400, -3), 0);
  assert.equal(propImpactPower(400, NaN), 0);
  assert.equal(propImpactPower(Infinity, R), 0);
});

// ---------------------------------------------------------------------------
// 2. Üretici eşlemesi ve havuz disiplini
// ---------------------------------------------------------------------------
test('emitPropImpact: sıfır güç ve yoz giriş kayıt açmaz', () => {
  assert.equal(emitPropImpact({ x: 100, y: 100, nx: 1, ny: 0, power: 0 }), false);
  assert.equal(emitPropImpact({ x: NaN, y: 100, nx: 1, ny: 0, power: 1 }), false);
  assert.equal(emitPropImpact({ x: 100, y: 100, nx: NaN, ny: 0, power: 1 }), false);
  assert.equal(drawPropCracks(recorder(), propHitFor({ x: 0, y: 0, w: 10, h: 10 }), { x: 0, y: 0, w: 10, h: 10 }, 1, PALETTE), false);
});

test('emitPropSpark: yönlü ve yönsüz spark ikisi de kayıt açar', () => {
  assert.equal(emitPropSpark({ x: 200, y: 200, dirX: 1, dirY: 0 }), true);
  // Mermi `spark`ları çoğunlukla yÖNsüzdür (ARCHER/TANKS/HORDE) — o da açmalı.
  assert.equal(emitPropSpark({ x: 400, y: 200 }), true);
  // `spark` kadar geçersiz veri de gelmemeli.
  assert.equal(emitPropSpark(null), false);
  assert.equal(emitPropSpark({ x: 100, y: 100, dirX: 0, dirY: 0 }), true, 'sıfır yön yönsüz sayılır');
});

test('havuz sabittir: en eski geri dönüşür', () => {
  for (let i = 0; i < PROP_IMPACT_CAP + 5; i += 1) {
    emitPropImpact({ x: 100 + i * 40, y: 200, nx: 0, ny: -1, power: 1, span: 1 });
    virtualNow += 2;
  }
  // Havuz 8 canlıdır; hepsi de aynı büyük kutunun içinde görünür.
  propHitFor({ x: 60, y: 160, w: 660, h: 80 });
  assert.equal(fieldPropsStats.impacts, PROP_IMPACT_CAP);
});

test('aynı noktadaki darbe yenisini açmaz, mevcudu tazeler', () => {
  assert.equal(emitPropImpact({ x: 300, y: 200, nx: 0, ny: 1, power: 0.4, span: 12 }), true);
  assert.equal(emitPropImpact({ x: 302, y: 201, nx: 0, ny: 1, power: 0.9, span: 12 }), false, 'tazeleme');
  const hit = propHitFor({ x: 260, y: 160, w: 80, h: 80 });
  assert.ok(hit);
  assert.equal(hit.power, 0.9, 'güç en güçlüsünde kalır');
});


// ---------------------------------------------------------------------------
// 3. Tek üretici: resolveAABB (fizik değişmez + eşik)
// ---------------------------------------------------------------------------
test('resolveAABB: fizik sonucu değişmez, yavaş temas tepki üretmez', () => {
  const p = { x: 94, y: 200, vx: -200, vy: 0 };
  resolveAABB(p, [{ x: 100, y: 150, w: 60, h: 100 }], 30);
  assert.ok(p.x < 94, 'bloğun dışına itildi');
  assert.equal(propHitFor({ x: 100, y: 150, w: 60, h: 100 }), null,
    '200 px/s / r30 = 6.7 gövde/sn — titrememeli');
});

test('resolveAABB: hızlı temas bloğa darbe açar', () => {
  // Bloğun sol yüzüne sağa doğru (+x) çarpar: dış normal sola bakar (nx = -1).
  const p = { x: 80, y: 200, vx: 430, vy: 0 };
  resolveAABB(p, [{ x: 100, y: 150, w: 60, h: 100 }], 36);
  // Kayma yüzeyi hızı siler: 430 px/s'lik hız yansıması 0'a iner; konum
  // kapıdadır (motor otoritesi §2 — fazladan fizik yazılmadı).
  assert.equal(p.vx, 0, 'hız yansıması aynı');
  assert.equal(p.vy, 0);
  assert.ok(p.x < 80 && p.x >= 100 - 36, 'bloğun yüzeyine itildi');
  const hit = propHitFor({ x: 100, y: 150, w: 60, h: 100 });
  assert.ok(hit, '430 px/s / r36 = 11.9 — darbe açılmalı');
  assert.ok(hit.nx !== 0 || hit.ny !== 0, 'normal taşınmalı');
});

// ---------------------------------------------------------------------------
// 4. Boş havuz temsili + kendi kendine sona erme
// ---------------------------------------------------------------------------
test('süresi dolan darbe kendini temizler', () => {
  emitPropImpact({ x: 300, y: 200, nx: 0, ny: 1, power: 1 });
  const obs = { x: 260, y: 160, w: 80, h: 80 };
  assert.ok(propHitFor(obs), 'taze darbe eşleşir');
  virtualNow += (PROP_HIT_LIFE + 0.05) * 1000;
  assert.equal(propHitFor(obs), null, 'ömür dolunca eşleşme yok');
  assert.equal(propFlinchOffset({ stamp: virtualNow - 1000 }, 1), 0, 'bayat slot titremez');
});


// ---------------------------------------------------------------------------
// 5. drawObstacle zinciri: tepki yalnız canlı darbede op üretir
// ---------------------------------------------------------------------------
test('drawObstacle: boş havuzda log birebir aynı, darbede çatlak çizer', () => {
  const obs = { x: 120, y: 80, w: 96, h: 72 };
  const plain = recorder();
  drawObstacle(plain, obs, { variant: 'stone' });

  // Yönsüz mermi teması bloğun yüzeyinde → çatlak.
  emitPropSpark({ x: 168, y: 100 });
  const reacted = recorder();
  drawObstacle(reacted, obs, { variant: 'stone' });
  assert.ok(reacted.log.length > plain.log.length, 'darbe ek op çizdi');
  assert.ok(reacted.log.some((e) => e.startsWith('fillRect(')), 'kıymık çizilmeli');

  // Ömür dolunca log yine birebir aynı olmalı.
  virtualNow += (PROP_HIT_LIFE + 0.05) * 1000;
  const after = recorder();
  drawObstacle(after, obs, { variant: 'stone' });
  assert.deepEqual(after.log, plain.log, 'sönmüş tepki iz bırakmamalı');
});

// ---------------------------------------------------------------------------
// 6. Blok eşleşmesi: temas noktası bloğun DIŞINDAYSA tepki yok
// ---------------------------------------------------------------------------
test('propHitFor: uzak blok darbeyi sahiplenmez', () => {
  emitPropImpact({ x: 100, y: 100, nx: 1, ny: 0, power: 1 });
  assert.equal(propHitFor({ x: 500, y: 400, w: 60, h: 60 }), null);
  assert.equal(propHitFor(null), null);
  assert.doesNotThrow(() => drawPropGizmos(null, ARENA, PALETTE));
  assert.doesNotThrow(() => drawPropGizmos(recorder(), null, PALETTE));
});


// ---------------------------------------------------------------------------
// 7. Gizmo katmanı: opt-in ve determinizm
// ---------------------------------------------------------------------------
test('gizmo katmanı: kapalı temada op yok, açık temada kararlı', () => {
  const off = recorder();
  drawPropGizmos(off, ARENA, fieldTheme('ARCHER'));
  assert.equal(off.log.length, 0, 'ARCHER opt-in değil');

  virtualNow += 100;
  clearFieldProps();
  const first = recorder();
  drawPropGizmos(first, ARENA, fieldTheme('BOMB'));
  assert.ok(first.log.length > 0, 'BOMB (bumpers+vents) çizer');

  const second = recorder();
  drawPropGizmos(second, ARENA, fieldTheme('BOMB'));
  assert.deepEqual(second.log, first.log, 'aynı saat aynı çizim (determinizm)');
});

test('setWallBounce: yakın köşe tamponu ezilir, sönünce bırakır', () => {
  setWallBounce(ARENA.left + 4, ARENA.top + 6, 1);
  drawPropGizmos(recorder(), ARENA, fieldTheme('PONG'));
  assert.equal(fieldPropsStats.bounce, 1);
  virtualNow += 1000;
  drawPropGizmos(recorder(), ARENA, fieldTheme('PONG'));
  assert.equal(fieldPropsStats.bounce, 0, 'ezilme sönmeli');
});

// ---------------------------------------------------------------------------
// 8. Ağ + determinizm + motion disiplini
// ---------------------------------------------------------------------------
test('tepki katmanı paketlenmez ve kararlıdır', () => {
  const source = readFileSync(join(process.cwd(), 'src/core/fieldProps.js'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  for (const forbidden of ['Math.random', 'fetch', 'WebSocket', 'supabase', 'postMessage']) {
    assert.equal(source.includes(forbidden), false, `fieldProps ${forbidden} kullanmamalı`);
  }
});

test('aynı darbe iki kez birebir aynı çizimi üretir', () => {
  emitPropImpact({ x: 150, y: 120, nx: -1, ny: 0, power: 0.8 });
  const obs = { x: 120, y: 80, w: 96, h: 72 };
  const first = recorder();
  drawObstacle(first, obs, { variant: 'stone' });
  clearFieldProps();
  emitPropImpact({ x: 150, y: 120, nx: -1, ny: 0, power: 0.8 });
  const second = recorder();
  drawObstacle(second, obs, { variant: 'stone' });
  assert.deepEqual(second.log, first.log, 'aynı darbe aynı çatlağı üretmeli');
});

test('reduced-motion: tepki doğmaz, gizmo donar', () => {
  reducedMotion = true;
  assert.equal(emitPropImpact({ x: 150, y: 120, nx: 1, ny: 0, power: 1 }), false);
  const a = recorder();
  drawPropGizmos(a, ARENA, fieldTheme('BOMB'));
  virtualNow += 2000;
  const b = recorder();
  drawPropGizmos(b, ARENA, fieldTheme('BOMB'));
  assert.deepEqual(b.log, a.log, 'dönüş donmalı');
});

test('clearFieldProps her şeyi sıfırlar', () => {
  emitPropImpact({ x: 150, y: 120, nx: 1, ny: 0, power: 1 });
  setWallBounce(60, 40, 1);
  clearFieldProps();
  assert.deepEqual(fieldPropsStats, { impacts: 0, bounce: 0 });
  const r = recorder();
  drawPropGizmos(r, ARENA, fieldTheme('PONG'));
  assert.equal(fieldPropsStats.bounce, 0);
});

/** `document.createElement('canvas')` taklidi — `fieldKit` bake yolu için. */
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

