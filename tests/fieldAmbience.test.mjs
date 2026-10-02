// Ambiyans katmanı regresyon kalkanı (docs/ARENA_ELEVATION_PLAN.md Faz 4).
//
// Bu katmanın sözleşmesi görsel değil şudur:
//   1) Climaks slot'u her kare renderHUD'dan tazelenir; tazelenmezse
//      CLIMAX_SLOT_MAX_AGE içinde ölür — bayat nabız yok.
//   2) `heartPulse` saf ve periyodiktir; dinlenik nabzın çift vuruşu (lub-dub).
//   3) `climaxLevel` motor dalı YOKTUR: yalnız jenerik alanlar okunur
//      (suddenDeath / roundLimit − roundTimer|roundPlayTimer / son 2 hayatta
//      kalan); sakin durumlarda (lobi/sayaç/sonuç) asla ateşlenmez.
//   4) Kutlama TEK patlama / maç sonu: aktifken ve bittikten sonra yeniden
//      açılmaz; çağrı zinciri koptuğunda (yeni maç oynandı) yeniden kurulur.
//   5) Boş durumda ctx'ye TEK op verilmez (bake log eşitliği korunur).
//   6) reduced-motion'da konfeti uçuşmaz.
//   7) DETERMİNİZM: Math.random yok; aynı sanal saatte aynı patlama aynı
//      çizim sırasını üretir.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CLIMAX_SLOT_MAX_AGE,
  CONFETTI_CAP,
  celebrate,
  clearFieldAmbience,
  drawCelebration,
  drawClimaxVignette,
  fieldAmbienceStats,
  heartPulse,
  setClimax,
} from '../src/core/fieldAmbience.js';
import { CLIMAX_WINDOW, climaxLevel } from '../src/core/roundLifecycle.js';
import { UI_COLORS } from '../src/ui/tokens.js';

const BOX = Object.freeze({ left: 40, top: 24, width: 800, height: 432, unit: 1 });
const PALETTE = [UI_COLORS.crownRed, UI_COLORS.crownGold];

let virtualNow = 10_000;
let reducedMotion = false;

beforeEach(() => {
  virtualNow = 10_000;
  reducedMotion = false;
  globalThis.performance.now = () => virtualNow;
  // motion.js `mq`'yu ilk çağrıda önbellekler; `matches` getter'ı canlı bayrağı
  // okur → reduced-motion testi modül önbelleğini kirlemeden bayrağı çevirir.
  globalThis.window = { matchMedia: () => ({ get matches() { return reducedMotion; } }) };
  clearFieldAmbience();
});
afterEach(() => {
  delete globalThis.performance.now;
  delete globalThis.window;
  clearFieldAmbience();
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

function fakeGame(over = {}) {
  return {
    state: 'PLAYING',
    suddenDeath: false,
    roundLimit: 0,
    roundTimer: 0,
    getEntitiesList: () => [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Kalp atışı zarfı
// ---------------------------------------------------------------------------
test('heartPulse saf, sınırlı, periyodik ve çift vuruşlu', () => {
  for (let i = 0; i < 200; i += 1) {
    const v = heartPulse(i / 200);
    assert.ok(v >= 0 && v < 1.2, `zarf 0..1.2 aralığında kalmalı: ${v}`);
  }
  const lub = heartPulse(0.1);
  const dub = heartPulse(0.34);
  const trough = heartPulse(0.62);
  assert.ok(lub > 1.0 && lub < 1.1, `ana vuruş tepesi ~1: ${lub}`);
  assert.ok(dub > 0.5 && dub < 0.62, `ikinci vuruş daha yumuşak: ${dub}`);
  assert.ok(trough < 0.01, `iki vuruş arası dinlenik: ${trough}`);
  assert.equal(heartPulse(0), heartPulse(1), 'periyodik');
  assert.ok(Math.abs(heartPulse(0.2) - heartPulse(1.2)) < 1e-9, 'faz sarılıyor (float payı)');
});

// ---------------------------------------------------------------------------
// 2. climaxLevel — motor dalsız, jenerik alanlardan türer
// ---------------------------------------------------------------------------
test('climaxLevel: suddenDeath ateşler', () => {
  assert.equal(climaxLevel(fakeGame({ suddenDeath: true })), 1);
});

test('climaxLevel: son 5 saniye penceresi (sınır dahil)', () => {
  assert.equal(CLIMAX_WINDOW, 5);
  assert.equal(climaxLevel(fakeGame({ roundLimit: 30, roundTimer: 26 })), 1, '4 sn kala');
  assert.equal(climaxLevel(fakeGame({ roundLimit: 30, roundTimer: 25 })), 1, 'tam sınır: 5 sn kala');
  assert.equal(climaxLevel(fakeGame({ roundLimit: 30, roundTimer: 24.5 })), 0, '5.5 sn kala: sessiz');
  assert.equal(climaxLevel(fakeGame({ roundLimit: 30, roundTimer: 40 })), 0, 'sayaç limiti aşmışsa pencere sayılmaz');
  // PONG `roundPlayTimer` adını taşır — yedek alan pencereyi besler.
  assert.equal(climaxLevel(fakeGame({ roundLimit: 120, roundTimer: undefined, roundPlayTimer: 116 })), 1);
});

test('climaxLevel: son 2 hayatta kalan (en az biri ölmüş olmalı)', () => {
  const seats = (flags) => ({ getEntitiesList: () => flags.map((isAlive) => ({ isAlive })) });
  assert.equal(climaxLevel(fakeGame(seats([true, true, true, true]))), 0, 'kimse ölmemiş: sessiz');
  assert.equal(climaxLevel(fakeGame(seats([true, true, false, true]))), 0, '3 hayatta: sessiz');
  assert.equal(climaxLevel(fakeGame(seats([true, true, false, false]))), 1, 'final düellosu');
  assert.equal(climaxLevel(fakeGame(seats([true, true]))), 0, '2 kişilik oyun baştan sona 2 kişidir: nabız atmaz');
  // `isAlive` bayrağı taşımayan varlıklar canlı sayılır (skor oyunlarının dili).
  assert.equal(climaxLevel(fakeGame({ getEntitiesList: () => [{}, {}] })), 0);
});

test('climaxLevel: sakin durumlar ve boş girişler asla ateşlemez', () => {
  for (const state of ['LOBBY', 'STAGING', 'COUNTDOWN', 'MATCH_OVER', 'ROUND_PAUSE']) {
    assert.equal(climaxLevel(fakeGame({ state, suddenDeath: true })), 0, state);
  }
  assert.equal(climaxLevel(null), 0);
  assert.equal(climaxLevel(undefined), 0);
});

// ---------------------------------------------------------------------------
// 3. Climaks slot ömrü
// ---------------------------------------------------------------------------
test('climax slot tazelenmezse ölür; bayat vinyet tek op çizmez', () => {
  setClimax(1);
  assert.equal(fieldAmbienceStats.climax, 1);
  drawClimaxVignette(recorder(), BOX, 1);
  assert.equal(fieldAmbienceStats.climax, 1, 'taze slot canlı');

  virtualNow += (CLIMAX_SLOT_MAX_AGE + 0.05) * 1000;
  const stale = recorder();
  drawClimaxVignette(stale, BOX, 1);
  assert.equal(fieldAmbienceStats.climax, 0, 'bayat slot ölür');
  assert.equal(stale.log.length, 0, 'bayat vinyet ctx\'ye dokunmaz');
});

test('setClimax(0) slotu söndürür', () => {
  setClimax(1);
  setClimax(0);
  const r = recorder();
  drawClimaxVignette(r, BOX, 1);
  assert.equal(fieldAmbienceStats.climax, 0);
  assert.equal(r.log.length, 0);
});

// ---------------------------------------------------------------------------
// 4. Kutlama ömrü — TEK patlama / maç sonu
// ---------------------------------------------------------------------------
test('kutlama: açılır, aktifken no-op\'tur, biter ve kilitlenir', () => {
  assert.equal(celebrate(PALETTE, BOX), true, 'ilk çağrı patlamayı açar');
  assert.equal(celebrate(PALETTE, BOX), false, 'aynı patlamada ikinci çağrı no-op');

  let sawFlash = false;
  // BURST_LIFE ≈ 7.79 s; 520 kare × 16 ms = 8.32 s patlamayı kapatır.
  for (let f = 0; f < 520; f += 1) {
    virtualNow += 16; // kart her kare celebrate + draw çağırır
    const opened = celebrate(PALETTE, BOX);
    drawCelebration(recorder(), BOX);
    assert.equal(opened, false, 'patlama bittikten sonra da aynı ekran yeniden açılmamalı');
    if (fieldAmbienceStats.flashes > 0) sawFlash = true;
    if (f === 60) {
      assert.ok(fieldAmbienceStats.confetti > 0, 'konfetiler kademeli doğar');
      assert.ok(fieldAmbienceStats.confetti <= CONFETTI_CAP, 'havuz üst sınırı');
    }
    if (f >= 505) {
      assert.equal(fieldAmbienceStats.confetti, 0, 'patlama kendini söndürür');
      assert.equal(fieldAmbienceStats.flashes, 0);
    }
  }
  assert.ok(sawFlash, 'kamera flaşları patlama içinde doğmalı');
  assert.equal(celebrate(PALETTE, BOX), false, 'kilit: aynı maç-sonu ekranı tekrar patlamaz');

  virtualNow += 3000; // çağrı zinciri koptu → yeni maç oynandı
  assert.equal(celebrate(PALETTE, BOX), true, 'yeni maç sonunda yeniden kurulur');
});

test('kutlama: kumanda kutusu (cx/cy, left/top yok) çökmez', () => {
  const padBox = { cx: 400, cy: 200, width: 800, height: 400 };
  assert.equal(celebrate(PALETTE, padBox), true);
  virtualNow += 400;
  const r = recorder();
  assert.doesNotThrow(() => drawCelebration(r, padBox));
  assert.ok(fieldAmbienceStats.confetti > 0);
});

// ---------------------------------------------------------------------------
// 5. Determinizm
// ---------------------------------------------------------------------------
test('aynı sanal saatte aynı patlama aynı çizim sırasını üretir', () => {
  clearFieldAmbience();
  virtualNow = 50_000;
  celebrate(PALETTE, BOX);
  virtualNow += 300;
  const first = recorder();
  drawCelebration(first, BOX);
  assert.ok(first.log.length > 0, 'çizim yapılmış olmalı');

  clearFieldAmbience();
  virtualNow = 50_000;
  celebrate(PALETTE, BOX);
  virtualNow += 300;
  const second = recorder();
  drawCelebration(second, BOX);
  assert.deepEqual(second.log, first.log);
});

// ---------------------------------------------------------------------------
// 6. Sıfırlama ve reduced-motion
// ---------------------------------------------------------------------------
test('clearFieldAmbience her şeyi sıfırlar ve kilidi açar', () => {
  setClimax(1);
  celebrate(PALETTE, BOX);
  clearFieldAmbience();
  assert.deepEqual(fieldAmbienceStats, { climax: 0, confetti: 0, flashes: 0 });
  const r = recorder();
  drawClimaxVignette(r, BOX, 1);
  drawCelebration(r, BOX);
  assert.equal(r.log.length, 0, 'boş havuz tek op çizmez');
  assert.equal(celebrate(PALETTE, BOX), true, 'kilit temizlenir');
});

test('reduced-motion: konfeti doğmaz', () => {
  reducedMotion = true;
  assert.equal(celebrate(PALETTE, BOX), false);
  const r = recorder();
  drawCelebration(r, BOX);
  assert.equal(r.log.length, 0);
});

// ---------------------------------------------------------------------------
// 7. Kaynak korumaları
// ---------------------------------------------------------------------------
test('fieldAmbience kaynak taraması: determinizm ve saat disiplini', () => {
  const source = readFileSync(join(process.cwd(), 'src/core/fieldAmbience.js'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  assert.equal(source.includes('Math.random'), false, 'fieldAmbience Math.random kullanmamalı');
  assert.equal(source.includes('new Date'), false, 'fieldAmbience new Date kullanmamalı');
  // 2: clock() korumasında typeof denetimi + çağrı.
  assert.equal(source.split('performance.now').length - 1, 2, 'performance.now yalnız clock() içinde');
  assert.equal(source.split('Date.now').length - 1, 1, 'Date.now yalnız clock() yedeğinde');
});
