// Dinamik ışık havuzları regresyon kalkanı (docs/ARENA_ELEVATION_PLAN.md Faz 3).
//
// Bu katmanın sözleşmesi görsel değil şudur:
//   1) Slot'lar her kare view tarafından tazelenir; tazelenmezse slot ölür
//      (SLOT_MAX_AGE) ve spot kaybolur — bayat ışık yok.
//   2) `tracerAt`/`flashAt` havuzları SABİT (8/6), en eski ezilir.
//   3) Parıltı yalnız çatışma olaylarından doğar (`FxRuntime.emit` →
//      `emitFxLight`); `shot`/`pickup`/`score` zemini aydınlatmaz.
//   4) Boş slot'larda sahnede yalnız tepe projektörü vardır; slot ölse
//      stats sıfırlanır.
//   5) `motionScale()===0`'da parıltı ve nabız üretilmez.
//   6) AĞ BÜTCESİ (§6): paket alanı yok, kare başına tahsis yok.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIGHT_TRACER_CAP,
  LIGHT_FLASH_CAP,
  clearFieldLights,
  drawFieldLights,
  emitFxLight,
  fieldLightStats,
  flashAt,
  setDangerSpot,
  setRoyaltySpot,
  tracerAt,
} from '../src/core/fieldLights.js';
import { drawField, releaseFieldLayers } from '../src/core/fieldKit.js';
import { createFxRuntime } from '../src/core/fxRuntime.js';

const ARENA = Object.freeze({ left: 40, top: 24, width: 800, height: 432, unit: 1 });
const BOX = Object.freeze({ left: 40, top: 24, width: 800, height: 432, unit: 1 });

let virtualNow = 10_000;
beforeEach(() => {
  virtualNow = 10_000;
  globalThis.performance.now = () => virtualNow;
  clearFieldLights();
});
afterEach(() => {
  delete globalThis.performance.now;
  clearFieldLights();
});

/** Çizim çağrılarını loglayan minimal ctx (node'da sprite üretimi yok → yalnız komut logu). */
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
      return (...args) => { log.push(`${String(key)}(${args.map(String).join(',')})`); };
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
}

test('setDangerSpot → stats 1; bayat slot ölür', () => {
  setDangerSpot(200, 200, 0.5, 36);
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.danger, 1);
  virtualNow += 1000; // SLOT_MAX_AGE üstünde
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.danger, 0);
});

test('setRoyaltySpot → stats 1; tazelenirse canlı kalır', () => {
  setRoyaltySpot(300, 240, 36);
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.royalty, 1);
  virtualNow += 60;
  setRoyaltySpot(300, 240, 36); // taze karede view yeniden beyan eder
  virtualNow += 60;
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.royalty, 1);
});

test('tracerAt havuzu sabit ve en-eski-ezim', () => {
  for (let i = 0; i < LIGHT_TRACER_CAP + 6; i += 1) tracerAt(100 + i, 150);
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.tracers, LIGHT_TRACER_CAP);
  virtualNow += 1000;
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.tracers, 0);
});

test('flashAt havuzu sabit; ömrü dolar', () => {
  for (let i = 0; i < LIGHT_FLASH_CAP + 4; i += 1) flashAt(120 + i * 10, 220, { r: 30 });
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.flashes, LIGHT_FLASH_CAP);
  virtualNow += 1000;
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.flashes, 0);
});

test('emitFxLight yalnız çatışma olaylarında parıltı açar', () => {
  assert.equal(emitFxLight('shot', { x: 5, y: 5 }), false);
  assert.equal(emitFxLight('pickup', { x: 5, y: 5 }), false);
  assert.equal(emitFxLight('score', { x: 5, y: 5 }), false);
  assert.equal(emitFxLight('kill', { x: 100, y: 100, size: 34 }), true);
  assert.equal(emitFxLight('hit', { x: 120, y: 100, size: 20 }), true);
  assert.equal(emitFxLight('slay', { x: 140, y: 100, size: 20 }), true);
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.flashes, 3);
});

test('FxRuntime.emit kill/hit olayını zemine parıltı olarak işler', () => {
  const fx = createFxRuntime({ arenaProvider: () => ARENA });
  fx.emit('kill', { x: 200, y: 200, color: '#D84727', size: 34 });
  fx.emit('hit', { x: 260, y: 200, color: '#1D5D8A', size: 20 });
  fx.emit('shot', { x: 300, y: 200 });
  drawFieldLights(recorder(), BOX);
  assert.equal(fieldLightStats.flashes, 2);
});

test('drawField zinciri slot/parıltı varken de patlamaz (node, sprite yok)', () => {
  setDangerSpot(200, 200, 0.8, 40);
  setRoyaltySpot(260, 220, 36);
  tracerAt(320, 200);
  flashAt(360, 200, { r: 30 });
  drawField(recorder(), ARENA, { mode: 'FIELD', seed: 7 });
  assert.equal(fieldLightStats.danger, 1);
  releaseFieldLayers();
});

test('clearFieldLights slot/havuzu sıfırlar', () => {
  setDangerSpot(200, 200, 0.5);
  setRoyaltySpot(200, 200);
  tracerAt(200, 200);
  flashAt(200, 200, {});
  clearFieldLights();
  drawFieldLights(recorder(), BOX);
  assert.deepEqual(fieldLightStats, { danger: 0, royalty: 0, tracers: 0, flashes: 0 });
});
