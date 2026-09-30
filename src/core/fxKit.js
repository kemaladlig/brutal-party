// FX olay sözleşmesinin tek sahibi (MOTION_PLAN Faz 1). Motorlar OLAY üretir
// (`emitFx`), partikül/ring/flash/hit-stop/haptik bütçeleri yalnız buradan geçer.
// Domainsizdir: host motoru, worldView ve testler aynı saf fonksiyonları kullanır.
//
// Bütçe kuralları (docs/MOTION_PLAN.md):
//  - Kapalı olay kümesi: FX_PROFILES dışı kind throw eder.
//  - Tüm uzamsal sayılar TASARIM px'idir; spawn anında `unit` ile çarpılır (I5/I6).
//  - Partikül kapları zorunludur; kap aşımında en eski atılır (host↔client packet
//    kapları worldCore/packParticles ile ayrıca sınırlıdır).
//  - `motionScale() === 0` (azaltılmış hareket) hit-stop/travma üretmez; partikül
//    bilgi taşır, üretilmeye devam eder.

import { UI_COLORS } from '../ui/tokens.js';
import { vibrate } from './haptics.js';

/** @typedef {'shot'|'hit'|'kill'|'pickup'|'score'|'blocked'|'spark'|'dust'|'zone'} FxKind */

export const FX_KIND = Object.freeze({
  SHOT: 'shot',
  HIT: 'hit',
  KILL: 'kill',
  PICKUP: 'pickup',
  SCORE: 'score',
  BLOCKED: 'blocked',
  SPARK: 'spark',
  DUST: 'dust',
  ZONE: 'zone',
});

/**
 * Olay → kanal bütçeleri. Sayılar tasarım birimindedir:
 *   burst.speed/size → tasarım px, tasarım px/s (spawn'da unit ile çarpılır)
 *   trauma           → BaseGame travma birimi (0..1, trauma² ile uygulanır)
 *   hitStopMs        → sunum yavaşlaması süresi (motionScale 0'da uygulanmaz)
 *   ring             → tasarım px; r0→r1 genişler (zone'da opts.ringRadius bazlı)
 *   flashSec         → tam ekran flaş süresi (yalnız en yüksek öncelik: KILL)
 * @type {Readonly<Record<FxKind, {
 *   burst?: { count: number, speed: number, speedVar: number, life: number, size: number, sizeVar?: number, inkMix?: number },
 *   ring?: { r0: number, r1: number, life: number, width: number },
 *   trauma?: number, hitStopMs?: number, flashSec?: number,
 * }>>}
 */
export const FX_PROFILES = Object.freeze({
  shot: Object.freeze({ trauma: 0.08 }),
  hit: Object.freeze({
    burst: Object.freeze({ count: 6, speed: 110, speedVar: 60, life: 0.22, size: 3, inkMix: 0.85 }),
    ring: Object.freeze({ r0: 4, r1: 26, life: 0.22, width: 2 }),
    trauma: 0.2,
    hitStopMs: 50,
  }),
  kill: Object.freeze({
    burst: Object.freeze({ count: 18, speed: 120, speedVar: 80, life: 0.65, size: 6, sizeVar: 4, inkMix: 0.4 }),
    ring: Object.freeze({ r0: 10, r1: 90, life: 0.32, width: 3.5 }),
    trauma: 0.4,
    hitStopMs: 100,
    flashSec: 0.06,
  }),
  pickup: Object.freeze({
    burst: Object.freeze({ count: 8, speed: 100, speedVar: 60, life: 0.35, size: 3.5, inkMix: 0.15 }),
  }),
  score: Object.freeze({
    ring: Object.freeze({ r0: 6, r1: 60, life: 0.3, width: 2.5 }),
    trauma: 0.05,
  }),
  blocked: Object.freeze({}),
  spark: Object.freeze({
    burst: Object.freeze({ count: 4, speed: 110, speedVar: 60, life: 0.22, size: 3, inkMix: 0.9 }),
  }),
  dust: Object.freeze({
    burst: Object.freeze({ count: 1, speed: 14, speedVar: 10, life: 0.25, size: 3 }),
  }),
  zone: Object.freeze({
    ring: Object.freeze({ r0: 24, r1: 72, life: 0.5, width: 3 }),
    trauma: 0.16,
  }),
});

/** Olay → haptik desen (haptics.js tercih kapısından geçer). */
export const FX_HAPTIC = Object.freeze({
  shot: 22,
  hit: 14,
  kill: Object.freeze([40, 50, 80]),
  pickup: 12,
  score: Object.freeze([15, 30, 15]),
  blocked: 8,
  zone: 20,
});

/** Partikül havuzu üst sınırı (düşük kademe çarpanı Faz 2'de perfMonitor'a bağlanır). */
export const FX_PARTICLE_CAP = 96;
/** Eşzamanlı halka sınırı (packet kapları view tarafında ayrıca daraltır). */
export const FX_RING_CAP = 12;
/** Ölüm pop'u (silinen varlığın büyüyen-sönen gölgesi) sınırı. */
export const FX_POP_CAP = 8;
/** Hit-stop sırasında zaman ölçeği (0 = tam donma değil: %6 yaşam korunur). */
export const FX_HITSTOP_SCALE = 0.06;
/** Kill flaşının tepe alfası — tam beyaz perde değil, sahneyi alan bir vurgu. */
export const FX_FLASH_ALPHA = 0.35;

/** Flaş alfası: lineer sönen süreden 0..FX_FLASH_ALPHA (host çizimi + packet aynı). */
export function fxFlashAlpha(flashSec, peakSec) {
  if (!(flashSec > 0) || !(peakSec > 0)) return 0;
  return FX_FLASH_ALPHA * Math.min(1, flashSec / peakSec);
}

/** @param {string} kind @returns {boolean} */
export function isFxKind(kind) {
  return Object.prototype.hasOwnProperty.call(FX_PROFILES, kind);
}

/**
 * @param {string} kind
 * @returns {Readonly<Record<string, any>>} profil (kapalı küme dışı throw)
 */
export function fxProfile(kind) {
  const profile = /** @type {any} */ (FX_PROFILES)[kind];
  if (!profile) throw new Error(`fxKit: bilinmeyen FX olayı '${kind}' (kapalı küme)`);
  return profile;
}

/** Olay → haptik desen (haptics.js tercih kapısından geçer). @param {string} kind */
export function fxHaptic(kind) {
  const pattern = /** @type {any} */ (FX_HAPTIC)[kind];
  if (!pattern) return false;
  return vibrate(pattern);
}

/**
 * Eski partikülleri düşürerek gelecek burst'e yer açar.
 * @param {any[]} list @param {number} incoming
 */
function fxTrim(list, incoming) {
  let over = list.length + incoming - FX_PARTICLE_CAP;
  for (; over > 0; over -= 1) list.shift();
}

/**
 * Profil patlamasını motorun partikül dizisine üretir (worldCore pack/draw
 * konvansiyonuyla aynı şekil: x,y,vx,vy,life,maxLife,size,color).
 * @param {any[] | null | undefined} list
 * @param {FxKind} kind
 * @param {{ x: number, y: number, color?: string, angle?: number | null, unit?: number, rng?: () => number }} opts
 * @returns {number} üretilen partikül sayısı
 */
export function fxSpawnBurst(list, kind, { x, y, color = UI_COLORS.inkDark, angle = null, unit = 1, rng = Math.random }) {
  const burst = /** @type {any} */ (fxProfile(kind)).burst;
  if (!burst || !Array.isArray(list)) return 0;
  fxTrim(list, burst.count);
  const u = Number.isFinite(unit) && unit > 0 ? unit : 1;
  const sizeVar = burst.sizeVar || 0;
  for (let i = 0; i < burst.count; i += 1) {
    const spread = angle == null ? 0 : (rng() * 2 - 1) * 1.25;
    const a = angle == null ? rng() * Math.PI * 2 : angle + spread;
    const speed = (burst.speed + (rng() * 2 - 1) * burst.speedVar) * u;
    list.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: burst.life,
      maxLife: burst.life,
      size: Math.max(1, (burst.size + (rng() * 2 - 1) * sizeVar) * u),
      color: (burst.inkMix && rng() < burst.inkMix) ? UI_COLORS.inkDark : color,
    });
  }
  return burst.count;
}

/**
 * @param {any[]} list @param {number} dt
 */
export function fxUpdateParticles(list, dt) {
  if (!Array.isArray(list)) return;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) list.splice(i, 1);
  }
}

/**
 * Şok dalgası halkası üretir. Halka durumu SAFLA paketlenir (x,y,r0,r1,life,
 * maxLife,width,color) — worldCore.drawFxRings yarıçapı life'tan türetir, böyle
 * host runtime'ı ile WORLD_FRAME snapshot'ı aynı şekli paylaşır.
 * opts.ringRadius verilirse halka o yarıçapta darbelenir (zone), yoksa r0→r1.
 * @param {any[] | null | undefined} rings
 * @param {FxKind} kind
 * @param {{ x: number, y: number, unit?: number, color?: string, ringRadius?: number | null }} opts
 */
export function fxSpawnRing(rings, kind, { x, y, unit = 1, color = UI_COLORS.inkDark, ringRadius = null }) {
  const ring = /** @type {any} */ (fxProfile(kind)).ring;
  if (!ring || !Array.isArray(rings)) return;
  if (rings.length >= FX_RING_CAP) rings.shift();
  const u = Number.isFinite(unit) && unit > 0 ? unit : 1;
  const r0 = ringRadius != null ? ringRadius * 0.92 : ring.r0 * u;
  const r1 = ringRadius != null ? ringRadius : ring.r1 * u;
  rings.push({
    x,
    y,
    r0,
    r1,
    life: ring.life,
    maxLife: ring.life,
    width: Math.max(1, ring.width * u),
    color,
  });
}

/** @param {any[]} rings @param {number} dt */
export function fxUpdateRings(rings, dt) {
  if (!Array.isArray(rings)) return;
  for (let i = rings.length - 1; i >= 0; i -= 1) {
    rings[i].life -= dt;
    if (rings[i].life <= 0) rings.splice(i, 1);
  }
}

/**
 * Ölüm pop'u: silinen varlığın yerinde büyüyen + sönen kare gölge. KILL
 * olayının "varlık bir anda yok olmadı" kanalı — spawn anındaki tasarım
 * boyutu unit ile çarpılır.
 * @param {any[] | null | undefined} pops
 * @param {{ x: number, y: number, size: number, angle?: number, color?: string, unit?: number }} opts
 */
export function fxSpawnPop(pops, { x, y, size, angle = 0, color = UI_COLORS.inkDark, unit = 1 }) {
  if (!Array.isArray(pops)) return;
  if (pops.length >= FX_POP_CAP) pops.shift();
  const u = Number.isFinite(unit) && unit > 0 ? unit : 1;
  pops.push({
    x,
    y,
    size: Math.max(2, size * u),
    angle,
    color,
    life: 0.35,
    maxLife: 0.35,
  });
}

/** @param {any[]} pops @param {number} dt */
export function fxUpdatePops(pops, dt) {
  if (!Array.isArray(pops)) return;
  for (let i = pops.length - 1; i >= 0; i -= 1) {
    pops[i].life -= dt;
    if (pops[i].life <= 0) pops.splice(i, 1);
  }
}

/**
 * Hit-stop zaman ölçeği (saf): donuk süre boyunca dt FX_HITSTOP_SCALE'e iner,
 * taşan gerçek zaman sonraki kareye iade edilir — toplam ilerleme dürüsttür.
 * @param {number} timer sn; donan kalan süre
 * @param {number} rawDt sn; ölçeklenmemiş kare dt'si
 * @returns {{ dt: number, timer: number }}
 */
export function advanceHitStop(timer, rawDt) {
  if (!(timer > 0) || !(rawDt > 0)) return { dt: rawDt, timer: Math.max(0, timer) };
  const active = Math.min(timer, rawDt);
  const rest = rawDt - active;
  return { dt: active * FX_HITSTOP_SCALE + rest, timer: timer - active };
}

/**
 * @param {number} dirX @param {number} dirY
 * @returns {{ x: number, y: number } | null} normalize yön; sıfır vektörde null
 */
export function fxNormalizedDir(dirX, dirY) {
  const mag = Math.hypot(dirX, dirY);
  if (!Number.isFinite(mag) || mag <= 0) return null;
  return { x: dirX / mag, y: dirY / mag };
}
