// Dinamik ışık havuzları (docs/ARENA_ELEVATION_PLAN.md Faz 3) — sahanın
// ışık dili: bomba taşıyıcısı altında tehlike nabzı, taç/külçe sahibinin
// altında altın spot, mermi altında sıcak iz, raunt zemini için tepe
// projektörü ve çatışma anında kısa infilak parıltısı. Statik bake'in
// ÜSTÜNDE, varlıkların ALTINDA çizilir (`fieldKit.drawField` blit'in hemen
// ardından, `drawFieldReactive`'in sonrasında).
//
// Üretici de tüketici de merkezde: BOMB/CROWN/HEIST view'ları canlı state'i
// slot setter'larıyla BEYAN EDER (paket alanı yok), TANKS/ARCHER her mermi
// için `tracerAt` damgası basar, çatışma parıltısı yine tek geçitten —
// `FxRuntime.emit` — beslenir (`emitFxLight`). Motor kodu sıfır.
//
// AĞ BÜTCESİ (§6): SIFIR alan. Slot'lar her kare tazelendiği için kumanda
// view'u aynı setter'ları kendi frame'iyle besler; dünya koordinatı host
// uzayıdır ve world-view çizimi `fitWorld` içinde olduğundan telefon kendine
// oturur (Faz 2 deseni — bu yüzden Faz 1'in "kumanda göremez" asimetrisi
// burada yok).
//
// BELLEK (§1 madde 4): sabit havuzlar (8 iz / 6 parıltı) + önceden ayrılmış
// slot'lar. Kare başına `createRadialGradient` YASAK — spotlar renk başına
// bir kez 64×64 sprite'a pişirilir, karede yalnız `drawImage`; süpürme
// `now - stamp` farkıyla yapılır. Boş slot'larda yalnız tepe projektörü
// (tek sabit sprite) çizilir.

import { motionScale } from '../ui/motion.js';
import { UI_COLORS } from '../ui/tokens.js';

/** Eşzamanlı mermi izi üst sınırı (taşarsa en eski düşer). */
export const LIGHT_TRACER_CAP = 8;
/** Eşzamanlı infilak parıltısı üst sınırı. */
export const LIGHT_FLASH_CAP = 6;

/** Canlı slot'un tazeliği (sn): host ve kumanda setter'ı aynı hızda tazeler. */
const SLOT_MAX_AGE = 0.14;
/** Mermi izi solma süresi. */
const TRACER_LIFE = 0.12;
/** Parıltı ömrü (sn). */
const FLASH_LIFE = 0.34;

/** Tepe projektörü tepe opaklıkları (sıcak merkez, loş köşe). */
const OVERHEAD_CENTER_ALPHA = 0.07;
const OVERHEAD_EDGE_ALPHA = 0.11;

const TAU = Math.PI * 2;

const clock = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/**
 * Sıcak beyaz merkezi — beyazın krem zeminde (L* 92-97) uçup gitmemesi için
 * renk hafif buğday tonu; lokallik kuruşluk α ile verilir.
 */
const OVERHEAD_WARM = '255, 241, 214';

// --- sprite önbelleği --------------------------------------------------------
/**
 * Renk+α kovası → 64×64 radyal sprite. Kare başına `createRadialGradient`
 * YASAK: gradyan bir kez sprite'a pişirilir, karede yalnız `drawImage` ile
 * damgalanır (§1 madde 4 — "sprite damgaları üzerinden çizilir").
 */
const spriteCache = new Map();
/** Renk başına tek sprite: merkez tam opak renk, dışa α=0. Güç `globalAlpha`'dadır. */
function spotSprite(color) {
  let sprite = spriteCache.get(color);
  if (sprite !== undefined) return sprite || null;
  sprite = null;
  if (typeof document !== 'undefined' && document?.createElement) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const sctx = c.getContext('2d');
    if (sctx) {
      const g = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, rgba(color, 1));
      g.addColorStop(1, rgba(color, 0));
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 64, 64);
      sprite = c;
    }
  }
  spriteCache.set(color, sprite ?? false);
  return sprite;
}

/** `#RRGGBB` → 'rgba(r,g,b,a)'; anahtar başına bir kez kurulur. */
const rgbaCache = new Map();
function rgba(hex, a) {
  const key = `${hex}|${a}`;
  let out = rgbaCache.get(key);
  if (out === undefined) {
    const n = /^#[0-9a-fA-F]{6}$/.test(String(hex)) ? parseInt(String(hex).slice(1), 16) : NaN;
    if (Number.isNaN(n)) {
      out = rgba(UI_COLORS.crownGold, a); // hex dışı renk → güvenli altın krem düşer
    } else {
      out = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    rgbaCache.set(key, out);
  }
  return out;
}

/** Tepe projektörü — tek sabit sprite, kutuya ölçeklenir. */
let overheadSprite = null;
function overhead() {
  if (overheadSprite) return overheadSprite;
  if (typeof document === 'undefined' || !document?.createElement) return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const octx = c.getContext('2d');
  if (!octx) return null;
  const g = octx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, `rgba(${OVERHEAD_WARM}, ${OVERHEAD_CENTER_ALPHA})`);
  g.addColorStop(0.55, `rgba(${OVERHEAD_WARM}, 0.02)`);
  g.addColorStop(1, rgba(UI_COLORS.inkDark, OVERHEAD_EDGE_ALPHA));
  octx.fillStyle = g;
  octx.fillRect(0, 0, 256, 256);
  overheadSprite = c;
  return c;
}

// --- durum (bir kez tahsis, alan yazımı) --------------------------------------
const danger = { x: 0, y: 0, urgency: 0, radius: 36, unit: 1, stamp: -Infinity };
const royalty = { x: 0, y: 0, radius: 36, unit: 1, stamp: -Infinity };
/** @type {{x:number,y:number,unit:number,stamp:number,alive:boolean}[]} */
const tracers = [];
for (let i = 0; i < LIGHT_TRACER_CAP; i += 1) tracers.push({ x: 0, y: 0, unit: 1, stamp: -Infinity, alive: false });
/** @type {{x:number,y:number,r:number,unit:number,color:string,stamp:number,maxLife:number,alive:boolean}[]} */
const flashes = [];
for (let i = 0; i < LIGHT_FLASH_CAP; i += 1) flashes.push({ x: 0, y: 0, r: 10, unit: 1, color: UI_COLORS.crownGold, stamp: -Infinity, maxLife: FLASH_LIFE, alive: false });

/** Tanılama: canlı slot/iz/parıltı sayıları (testler ve perf ölçümü). */
export const fieldLightStats = { danger: 0, royalty: 0, tracers: 0, flashes: 0 };

/** BOMB taşıyıcısının altındaki tehlike nabzı. Her kare view tarafından tazelenir. */
export function setDangerSpot(x, y, urgency, radius = 36) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  danger.x = x; danger.y = y;
  danger.urgency = Math.max(0, Math.min(1, Number(urgency) || 0));
  danger.radius = Number.isFinite(radius) && radius > 0 ? radius : 36;
  danger.stamp = clock();
}

/** CROWN tacı / HEIST en zengin külçesi taşıyanın altındaki altın spot. */
export function setRoyaltySpot(x, y, radius = 36) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  royalty.x = x; royalty.y = y;
  royalty.radius = Number.isFinite(radius) && radius > 0 ? radius : 36;
  royalty.stamp = clock();
}

/** Tek merminin altında bu karelik sıcak iz damgası (TANKS/ARCHER). */
export function tracerAt(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  let slot = tracers[0];
  let oldest = Infinity;
  for (let i = 0; i < tracers.length; i += 1) {
    if (!tracers[i].alive) { slot = tracers[i]; oldest = -1; break; }
    if (tracers[i].stamp < oldest) { oldest = tracers[i].stamp; slot = tracers[i]; }
  }
  slot.x = x;
  slot.y = y;
  slot.stamp = clock();
  slot.alive = true;
}

/** Kısa infilak/vuruş parıltısı — doğrudan ya da `FxRuntime.emit` üzerinden. */
export function flashAt(x, y, { color = UI_COLORS.crownGold, r = 40, life = FLASH_LIFE } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  let slot = flashes[0];
  let oldest = Infinity;
  for (let i = 0; i < flashes.length; i += 1) {
    if (!flashes[i].alive) { slot = flashes[i]; oldest = -1; break; }
    if (flashes[i].stamp < oldest) { oldest = flashes[i].stamp; slot = flashes[i]; }
  }
  slot.x = x;
  slot.y = y;
  slot.r = Number.isFinite(r) && r > 0 ? r : 40;
  slot.color = typeof color === 'string' && color ? color : UI_COLORS.crownGold;
  slot.maxLife = Number.isFinite(life) && life > 0 ? life : FLASH_LIFE;
  slot.stamp = clock();
  slot.alive = true;
}

/**
 * FX olayı → zemin parıltısı eşlemesi. Yalnız `fxKit`'in KAPALI kind
 * kümesindeki çatışma olayları parlar; `shot`/`pickup`/`score` zemini
 * aydınlatmaz (iz üretimiyle aynı disiplin — Faz 2 `SCAR_FOR_FX` deseni).
 *
 * - `kill` → infilak: büyük, kurbanın renginde.
 * - `hit`  → vuruş: küçük, vurulanın renginde.
 * - `slay` → sıradan ölüm: küçük, kurbanın renginde.
 */
const FLASH_FOR_FX = Object.freeze({
  kill: { scale: 1.6, life: 0.34 },
  hit: { scale: 0.9, life: 0.24 },
  slay: { scale: 0.8, life: 0.22 },
});

/**
 * @param {string} fxKind
 * @param {{x?:number, y?:number, color?:string, size?:number}} event
 * @param {number} [unit]
 */
export function emitFxLight(fxKind, event, unit = 1) {
  const spec = FLASH_FOR_FX[fxKind];
  if (!spec) return false;
  const x = Number(event?.x);
  const y = Number(event?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (motionScale() <= 0) return false;
  const raw = Number(event?.size);
  const size = Number.isFinite(raw) && raw > 0 ? raw : 34;
  flashAt(x, y, {
    color: typeof event?.color === 'string' && event.color ? event.color : UI_COLORS.crownGold,
    r: Math.max(14, size * spec.scale),
    life: spec.life,
  });
  return true;
}

/** Havuzları/slot'ları boşaltır — oyun değişimi / katman serbest bırakma. */
export function clearFieldLights() {
  danger.stamp = -Infinity;
  royalty.stamp = -Infinity;
  for (let i = 0; i < tracers.length; i += 1) tracers[i].alive = false;
  for (let i = 0; i < flashes.length; i += 1) flashes[i].alive = false;
  fieldLightStats.danger = 0;
  fieldLightStats.royalty = 0;
  fieldLightStats.tracers = 0;
  fieldLightStats.flashes = 0;
}

/** Renkli spot damgası: önbellekli sprite, karede tek `drawImage`. */
function paintSpot(ctx, x, y, r, color, alpha) {
  if (!(r > 0) || !(alpha > 0)) return;
  const sprite = spotSprite(color);
  if (!sprite) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

/**
 * Işık katmanını arena uzayında çizer: `drawField` statik blit'inin,
 * `drawFieldDecals` + `drawFieldReactive`'in ardından, varlıkların ÖNCESİNDE.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} box arena kutusu (cihaz px)
 */
export function drawFieldLights(ctx, box) {
  if (!ctx || !box) return;
  const now = clock();
  const left = Number(box.left) || 0;
  const top = Number(box.top) || 0;
  const width = Number(box.width) || 0;
  const height = Number(box.height) || 0;
  if (width <= 0 || height <= 0) return;
  // Ölçek TEK kaynaktan: slot'lar view'da, çizim drawField'de — koordinarllar
  // aynı uzayda ama unit'i her yüzeyin KENDİ kutusundan türetmek host/client
  // sapmasını (world-view'ın unit'siz arena reconstruct'i) imkânsız kılar.
  const unit = Number(box.unit) > 0 ? Number(box.unit) : 1;

  let liveTracers = 0;
  for (let i = 0; i < tracers.length; i += 1) {
    const t = tracers[i];
    if (!t.alive) continue;
    if ((now - t.stamp) / 1000 >= TRACER_LIFE) { t.alive = false; continue; }
    liveTracers += 1;
  }
  let liveFlashes = 0;
  for (let i = 0; i < flashes.length; i += 1) {
    const f = flashes[i];
    if (!f.alive) continue;
    if ((now - f.stamp) / 1000 >= f.maxLife) { f.alive = false; continue; }
    liveFlashes += 1;
  }
  const dangerAge = (now - danger.stamp) / 1000;
  const royaltyAge = (now - royalty.stamp) / 1000;
  const dangerLive = dangerAge >= 0 && dangerAge < SLOT_MAX_AGE;
  const royaltyLive = royaltyAge >= 0 && royaltyAge < SLOT_MAX_AGE;
  fieldLightStats.danger = dangerLive ? 1 : 0;
  fieldLightStats.royalty = royaltyLive ? 1 : 0;
  fieldLightStats.tracers = liveTracers;
  fieldLightStats.flashes = liveFlashes;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  // 1) Tepe projektörü — her kare, sabit düşük α'li tiyatro ışığı.
  const ov = overhead();
  if (ov) ctx.drawImage(ov, left, top, width, height);

  const frozen = motionScale() <= 0;

  // 2) Tehlike nabzı — urgency yükseldikçe büyür, kızarır, hızlanır.
  if (dangerLive) {
    const urge = danger.urgency;
    const baseR = (danger.radius + 14 + urge * 26) * unit;
    const pulse = frozen ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.001 * (2 + urge * 7) * TAU);
    const alpha = 0.10 + urge * 0.16 + pulse * (0.05 + urge * 0.08);
    paintSpot(ctx, danger.x, danger.y, baseR * (0.92 + pulse * 0.16), UI_COLORS.crownRed, alpha);
    paintSpot(ctx, danger.x, danger.y, baseR * 0.45, UI_COLORS.crownAmber, alpha * 0.8);
  }

  // 3) Asalet spotu — yumuşak altın nefes.
  if (royaltyLive) {
    const breathe = frozen ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.0012 * TAU);
    const r = (royalty.radius + 22) * unit * (0.95 + breathe * 0.1);
    paintSpot(ctx, royalty.x, royalty.y, r, UI_COLORS.crownGold, 0.14 + breathe * 0.05);
  }

  // 4) Mermi izi — sıcak kısa huzme.
  for (let i = 0; i < tracers.length; i += 1) {
    const t = tracers[i];
    if (!t.alive) continue;
    const k = (now - t.stamp) / 1000 / TRACER_LIFE;
    paintSpot(ctx, t.x, t.y, 16 * unit, UI_COLORS.crownAmber, 0.18 * (1 - k));
  }

  // 5) İnfilak parıltısı — kısa, merkezden dışa sönen sıcak leke.
  for (let i = 0; i < flashes.length; i += 1) {
    const f = flashes[i];
    if (!f.alive) continue;
    const k = (now - f.stamp) / 1000 / f.maxLife;
    paintSpot(ctx, f.x, f.y, f.r * unit * (0.65 + 0.5 * k), f.color, 0.24 * (1 - k));
  }

  ctx.restore();
}
