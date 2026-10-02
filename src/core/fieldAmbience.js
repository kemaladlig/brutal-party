// Saha dışı derinlik & dramatik ambiyans (docs/ARENA_ELEVATION_PLAN.md Faz 4).
// İki katman taşır:
//   1) CLIMAKS NABZI — maçın son 5 saniyesi / ani ölüm / son 2 hayatta kalan
//      durumunda saha DIŞINDAKİ koyu vinyet, kalp atışı temposunda (çift vuruşlu
//      lub-dub zarfı) kırmızı/altın parılar. `paintBackdrop` blit'inin ÜSTÜNE,
//      saha katmanının ALTINA çizilir: ışık yalnız masaya düşer, zemin L*
//      bütçesine (fieldKit §8) tek piksel dokunmaz.
//   2) ŞAMPİYONLUK KUTLAMASI — MATCH_OVER kartı açıldığında saha dışından
//      içeri süzülen 2.5D konfeti ve deterministik kamera flaşları.
//
// SİNYAL (motor kodu SIFIR — §3/§9): climaks seviyesi `roundLifecycle.climaxLevel`
// jenerik alanlardan türer (`suddenDeath` / `roundLimit − roundTimer` / hayatta
// kalan sayısı); ÜRETİCİ TEK geçittir: `tabletopRenderer.renderStandardScoreboard`
// — 12 motorun tamamı her kare renderHUD'dan oraya geçer. Kutlamanın üreticisi
// TEK geçittir: `hud.renderMatchOver` — host canvas'ı ile kumanda world-view'ı
// (`worldViewKit.drawWorldMatchOver`) AYNI fonksiyonu çağırdığı için kutlama iki
// yüzeyde de aynı kuralla doğar, aktarılan byte sıfırdır.
//
// AĞ BÜTÇESİ (§6): SIFIR alan. Climaks host oyun durumundan, kutlama MATCH_OVER
// durumundan türer; ikisi de zaten iki tarafta olan bilgidir, pakete giremez.
// Vinyet kumandada doğmaz (telefon world-view'ının saha DIŞI yoktur — Faz 1'in
// bilinçli asimetrisi); kutlama kumandada da doğar çünkü kart iki yüzeyde ortak.
//
// BELLEK (§1 madde 4): sabit havuzlar; kare başına nesne/gradyan tahsisi YOK —
// vinyet gradyanları bir kez 256×256 sprite'a pişer, karede yalnız `drawImage`;
// konfeti/flaşlar önceden tahsisli slot'larda alan yazımıyla yaşar. Boş durumda
// ctx'ye TEK op verilmez (bake log eşitliği ve boş-havuz temsili korunur).
//
// DETERMİNİZM: konfeti dağılımı ve flaş konumları `hash01`'den türer;
// `Math.random` yok. Kutlama tohumu patlama damgasından türediği için aynı
// sanal saatte aynı patlama aynı görünür (test edilebilir).

import { motionScale } from '../ui/motion.js';
import { UI_COLORS } from '../ui/tokens.js';

/** Eşzamanlı konfeti üst sınırı (havuz taşarsa en genç gecikme kazanır — gecikmeli doğuş). */
export const CONFETTI_CAP = 64;
/** Eşzamanlı kamera flaşı üst sınırı. */
export const FLASH_CAP = 4;
/** Bir kutlamada doğacak en fazla flaş. */
export const FLASH_MAX_PER_BURST = 12;

/** Climaks slotu bu kadar tazelenmezse ölür (üretici her kare renderHUD). */
export const CLIMAX_SLOT_MAX_AGE = 0.25;

// --- kutlama zaman bütçesi (sn) ---
const SPAWN_WINDOW = 2.2;      // konfetilerin kademeli doğuş aralığı
const CONFETTI_LIFE = 4.6;     // tek pulun uçuş süresi
const FLASH_LIFE = 0.26;       // tek flaşın ömrü
// En uzun yaşayan pul: life = CONFETTI_LIFE × 1.15 (celebrate'te dağılım).
// BURST_LIFE onu ve kuyruğunu kapsamalı — aksi halde son pullar havada kesilir.
const BURST_LIFE = SPAWN_WINDOW + CONFETTI_LIFE * 1.15 + 0.3;
/**
 * Kutlama tekrar kilidi aralığı (ms): `celebrate` kart her kare çağrılırken
 * kare-aralıklı gelir; zincir bu kadar koparsa (yeni maç oynandı, ekran
 * değişti) kilit açılır. Bu olmazsa uzun maç-sonu ekranı konfeti döngüsüne girer.
 */
const REARM_GAP_MS = 2000;

// --- climaks zaman bütçesi ---
/** Kalp atışı dönemi (sn): dinlenik nabız ~66 atım/dk. */
const PULSE_PERIOD = 0.9;

const TAU = Math.PI * 2;

/**
 * Monotonik saat — `fieldReactive`/`fieldDecals`/`fieldLights` ile aynı üç
 * satırlık koruma. `fieldKit`'in determinizm yasağı YALNIZ bake içindir; bu
 * katman ağda taşınmayan çizim yüzeyi sunumudur.
 */
const clock = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** tamsayıdan 0..1 — konfeti/flaş dağılımının tek, tekrarlanabilir kaynağı. */
function hash01(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * `#RRGGBB` → 'rgba(r,g,b,a)'; anahtar başına bir kez kurulur (kare başına
 * dize tahsisi yok). Hex dışı renk güvenli altına düşer — görsel hata üretmez.
 */
const rgbaCache = new Map();
function rgba(hex, a) {
  const key = `${hex}|${a}`;
  let out = rgbaCache.get(key);
  if (out === undefined) {
    const n = /^#[0-9a-fA-F]{6}$/.test(String(hex)) ? parseInt(String(hex).slice(1), 16) : NaN;
    out = Number.isNaN(n)
      ? rgba(UI_COLORS.crownGold, a)
      : `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    rgbaCache.set(key, out);
  }
  return out;
}

// --- climaks sprite'ları ------------------------------------------------------
/**
 * Vinyet halkası sprite'ı: merkez saydam, saha kenarına denk gelen bantta tepe,
 * dışta sönen 256×256 radyal gradyan. Karede `createRadialGradient` YASAK —
 * renk başına bir kez pişer, karede yalnız `drawImage` damgası.
 */
const vignetteSprites = new Map();
function vignetteSprite(color) {
  let sprite = vignetteSprites.get(color);
  if (sprite !== undefined) return sprite || null;
  sprite = null;
  if (typeof document !== 'undefined' && document?.createElement) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const sctx = c.getContext('2d');
    if (sctx) {
      const g = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(0.5, rgba(color, 0));
      g.addColorStop(0.78, rgba(color, 1));
      g.addColorStop(1, rgba(color, 0));
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 256, 256);
      sprite = c;
    }
  }
  vignetteSprites.set(color, sprite ?? false);
  return sprite;
}

/**
 * Kalp atışı zarfı: dinlenik nabzın çift vuruşu (lub-dub). `t` dönemin 0..1
 * aralığındaki fazıdır; iki Gauss tepesi ana vuruşu ve daha yumuşak ikinci
 * vuruşu verir. Saf fonksiyon — test edilebilir.
 * @param {number} t 0..1 faz
 * @returns {number} 0..~1 zarf
 */
export function heartPulse(t) {
  const tt = t - Math.floor(t);
  const bump = (c, w) => Math.exp(-((tt - c) * (tt - c)) / (2 * w * w));
  return bump(0.1, 0.075) + 0.55 * bump(0.34, 0.095);
}

// --- durum (bir kez tahsis, alan yazımı) --------------------------------------
const climax = { level: 0, stamp: -Infinity };

/** @type {{x:number,y:number,vx:number,vy:number,swayAmp:number,swayFreq:number,phase:number,roll:number,flip:number,size:number,tall:number,delay:number,life:number,color:string}[]} */
const confetti = [];
for (let i = 0; i < CONFETTI_CAP; i += 1) {
  confetti.push({
    x: 0, y: 0, vx: 0, vy: 0, swayAmp: 0, swayFreq: 0, phase: 0, roll: 0, flip: 0,
    size: 4, tall: 6, delay: 0, life: CONFETTI_LIFE, color: UI_COLORS.gold,
  });
}

/** @type {{x:number,y:number,stamp:number,alive:boolean}[]} */
const flashes = [];
for (let i = 0; i < FLASH_CAP; i += 1) {
  flashes.push({ x: 0, y: 0, stamp: -Infinity, alive: false });
}

/** Kutlama paleti — sabit dizi, patlama başında alan yazımı. */
const partyColors = [UI_COLORS.gold, UI_COLORS.gold, UI_COLORS.gold, UI_COLORS.gold, UI_COLORS.gold, UI_COLORS.gold];
let partyColorCount = 1;
let burstStamp = -Infinity;
let burstSeed = 0;
let burstDone = false;
let lastCelebrateCall = -Infinity;
let nextFlashAt = 0;
let flashCount = 0;

/** Kutlama kutusu — her çizimde yeniden yazılan tek nesne (karede tahsis yok). */
const partyBox = { left: 0, top: 0, width: 0, height: 0, unit: 1 };
const climaxBox = { left: 0, top: 0, width: 0, height: 0, unit: 1 };

/**
 * Arena/viewport benzeri kutuyu normalize eder: `left/top` yoksa `cx/cy`'den
 * türetilir (kumanda world-view kartı böyle gelir). Sonuç YENİDEN KULLANILAN
 * modül nesnesine yazılır — çağrı başına tahsis yok.
 */
function fillBox(target, src) {
  const w = Math.max(1, Number(src?.width) || 0);
  const h = Math.max(1, Number(src?.height) || 0);
  const left = Number.isFinite(Number(src?.left)) ? Number(src.left) : (Number(src?.cx) || 0) - w / 2;
  const top = Number.isFinite(Number(src?.top)) ? Number(src.top) : (Number(src?.cy) || 0) - h / 2;
  const unit = Number(src?.unit);
  target.left = left;
  target.top = top;
  target.width = w;
  target.height = h;
  target.unit = Number.isFinite(unit) && unit > 0 ? unit : 1;
}

/** Tanılama: climaks durumu ve canlı kutlama parçacığı sayıları. */
export const fieldAmbienceStats = { climax: 0, confetti: 0, flashes: 0 };

/**
 * Climaks nabzının seviyesini beyan eder. TEK çağıran:
 * `tabletopRenderer.renderStandardScoreboard` (her kare, jenerik seviye).
 * Tazelenmeyen slot `CLIMAX_SLOT_MAX_AGE` içinde kendiliğinden ölür.
 * @param {number} level 0..1 (0 = kapalı)
 */
export function setClimax(level) {
  const v = clamp01(Number(level) || 0);
  if (v <= 0) {
    climax.level = 0;
    climax.stamp = -Infinity;
    fieldAmbienceStats.climax = 0;
    return;
  }
  climax.level = v;
  climax.stamp = clock();
  fieldAmbienceStats.climax = 1;
}

/**
 * Climaks vinyetini saha dışına çizer. TEK çağıran: `fieldKit.paintBackdrop`
 * (backdrop blit'inin hemen ardından — saha katmanı üstünü örter, ışık yalnız
 * masaya düşer). Slot bayat/kapalıyken ctx'ye hiç dokunmaz.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} box arena kutusu (viewport uzayı)
 * @param {number} [unit] saha ölçeği
 */
export function drawClimaxVignette(ctx, box, unit = 1) {
  if (!ctx || !box) return;
  const now = clock();
  const age = (now - climax.stamp) / 1000;
  const live = climax.level > 0 && age >= 0 && age < CLIMAX_SLOT_MAX_AGE;
  fieldAmbienceStats.climax = live ? 1 : 0;
  if (!live) return;

  fillBox(climaxBox, box);
  const red = vignetteSprite(UI_COLORS.crownRed);
  const gold = vignetteSprite(UI_COLORS.crownGold);
  if (!red && !gold) return;

  const b = climaxBox;
  const u = Number.isFinite(unit) && unit > 0 ? unit : b.unit;
  const expand = Math.max(16 * u, Math.min(b.width, b.height) * 0.24);
  const frozen = motionScale() <= 0;
  const pulse = frozen ? 0.45 : heartPulse((now / 1000 % PULSE_PERIOD) / PULSE_PERIOD);
  const level = climax.level;

  if (red) {
    const r = expand * 1.15;
    ctx.globalAlpha = level * (0.1 + 0.15 * pulse);
    ctx.drawImage(red, b.left - r, b.top - r, b.width + r * 2, b.height + r * 2);
  }
  if (gold) {
    const r = expand * 0.62;
    ctx.globalAlpha = level * (0.05 + 0.1 * pulse);
    ctx.drawImage(gold, b.left - r, b.top - r, b.width + r * 2, b.height + r * 2);
  }
  ctx.globalAlpha = 1;
}

/**
 * Şampiyonluk kutlamasını başlatır. Aktif patlama sürerken çağrılar NO-OP'tur;
 * patlama bittikten sonra da NO-OP kalır (TEK patlama / maç sonu). Çağrı
 * zinciri `REARM_GAP_MS`'ten fazla koparsa kilit açılır — yeni maçın sonunda
 * tekrar patlar.
 *
 * @param {string[]} colors konfeti paleti (kazanan + sıra renkleri)
 * @param {FieldGeometry} box kutlama alanı (viewport ya da arena kutusu)
 * @returns {boolean} yeni patlama açıldıysa true
 */
export function celebrate(colors, box) {
  // Hareket tercihi kapalıysa konfeti uçuşmaz — kutlama, kartın kendi giriş
  // yumuşamasıyla sınırlı kalır (MOTION_PLAN freni; climaks nabzı yalnız donar).
  if (motionScale() <= 0) return false;
  const now = clock();
  const gap = now - lastCelebrateCall;
  lastCelebrateCall = now;
  if (gap > REARM_GAP_MS) burstDone = false;
  // Ömrü dolan patlamayı kilitle. Bunu celebrate de yapar: kart celebrate'i
  // drawCelebration'dan ÖNCE çağırır; vadesi dolan burst yalnız çizim tarafında
  // söndürülseydi aynı karede yeniden açılır ve ekran konfeti döngüsüne girerdi.
  if (burstStamp >= 0 && now - burstStamp >= BURST_LIFE * 1000) {
    burstStamp = -Infinity;
    burstDone = true;
    fieldAmbienceStats.confetti = 0;
    fieldAmbienceStats.flashes = 0;
  }
  if (burstDone || burstStamp >= 0) return false;

  burstStamp = now;
  burstSeed = (now % 0x7fffffff) | 0;
  fillBox(partyBox, box || {});

  // Palet: sabit diziye alan yazımı; geçersiz renkler atlanır, boşsa altın.
  partyColorCount = 0;
  const push = (c) => {
    if (partyColorCount >= partyColors.length) return;
    if (typeof c === 'string' && c) {
      partyColors[partyColorCount] = c;
      partyColorCount += 1;
    }
  };
  if (Array.isArray(colors)) for (const c of colors) push(c);
  push(UI_COLORS.gold);
  if (partyColorCount === 0) push(UI_COLORS.resultGold || UI_COLORS.gold);

  const b = partyBox;
  const u = b.unit;
  for (let i = 0; i < confetti.length; i += 1) {
    const s = confetti[i];
    const h1 = hash01(burstSeed + i * 3 + 1);
    const h2 = hash01(burstSeed + i * 3 + 2);
    const h3 = hash01(burstSeed + i * 3 + 3);
    s.x = b.left + (-0.05 + 1.1 * h1) * b.width;
    s.y = b.top - (14 + h2 * 56) * u;
    s.vx = (h3 - 0.5) * 46 * u;
    s.vy = (120 + hash01(burstSeed + i * 7 + 5) * 150) * u;
    s.swayAmp = (8 + hash01(burstSeed + i * 7 + 9) * 14) * u;
    s.swayFreq = 1.6 + hash01(burstSeed + i * 7 + 13) * 2.2;
    s.phase = hash01(burstSeed + i * 11 + 3) * TAU;
    s.roll = (hash01(burstSeed + i * 11 + 7) - 0.5) * 5;
    s.flip = 2.6 + hash01(burstSeed + i * 11 + 11) * 3.6;
    s.size = (3.2 + hash01(burstSeed + i * 13 + 5) * 3.4) * u;
    s.tall = s.size * (1.35 + hash01(burstSeed + i * 13 + 9) * 0.8);
    s.delay = h1 * SPAWN_WINDOW;
    s.life = CONFETTI_LIFE * (0.85 + hash01(burstSeed + i * 17 + 3) * 0.3);
    s.color = partyColors[i % partyColorCount];
  }

  for (let i = 0; i < flashes.length; i += 1) flashes[i].alive = false;
  nextFlashAt = now + 350;
  flashCount = 0;
  fieldAmbienceStats.confetti = 0;
  fieldAmbienceStats.flashes = 0;
  return true;
}

/**
 * Sıradaki deterministik kamera flaşını saha dışı bant kutusuna yerleştirir.
 */
function spawnFlash(now) {
  const i = flashCount;
  const b = partyBox;
  const u = b.unit;
  const h1 = hash01(burstSeed + 9000 + i * 5 + 1);
  const h2 = hash01(burstSeed + 9000 + i * 5 + 2);
  const h3 = hash01(burstSeed + 9000 + i * 5 + 3);
  let slot = flashes[0];
  for (let k = 1; k < flashes.length; k += 1) {
    if (!flashes[k].alive) { slot = flashes[k]; break; }
    if (flashes[k].stamp < slot.stamp) slot = flashes[k];
  }
  if (h3 < 0.55) {
    // saha dışı bant: kenar seç, kenar boyunca yürü, dışa doğru taşı
    const side = Math.floor(h1 * 4);
    const along = h2;
    const out = (8 + h1 * 34) * u;
    if (side === 0) { slot.x = b.left + along * b.width; slot.y = b.top - out; }
    else if (side === 1) { slot.x = b.left + along * b.width; slot.y = b.top + b.height + out; }
    else if (side === 2) { slot.x = b.left - out; slot.y = b.top + along * b.height; }
    else { slot.x = b.left + b.width + out; slot.y = b.top + along * b.height; }
  } else {
    // saha içi kenar şeridi: seyirci flaşı arenanın iç kenarında da parlar
    const inset = 0.06 + h1 * 0.12;
    slot.x = b.left + (h2 < 0.5 ? inset * b.width : (1 - inset) * b.width);
    slot.y = b.top + (h1 < 0.5 ? (0.08 + h2 * 0.84) * b.height : (0.08 + h3 * 0.84) * b.height);
  }
  slot.stamp = now;
  slot.alive = true;
}

/** Havuzları/patlama durumunu boşaltır — oyun değişimi / katman serbest bırakma. */
export function clearFieldAmbience() {
  climax.level = 0;
  climax.stamp = -Infinity;
  burstStamp = -Infinity;
  burstDone = false;
  lastCelebrateCall = -Infinity;
  nextFlashAt = 0;
  flashCount = 0;
  for (let i = 0; i < confetti.length; i += 1) confetti[i].delay = 0;
  for (let i = 0; i < flashes.length; i += 1) flashes[i].alive = false;
  fieldAmbienceStats.climax = 0;
  fieldAmbienceStats.confetti = 0;
  fieldAmbienceStats.flashes = 0;
}

/**
 * Kutlama katmanını çizer. TEK çağıran: `hud.renderMatchOver` — dim'in
 * ARDINDAN, sonuç panelinin ÖNCESİNDE (konfeti kartın arkasında kalır).
 * Patlama yok/bittiğinde ctx'ye hiç dokunmaz.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} box kutlama alanı (viewport ya da arena kutusu)
 */
export function drawCelebration(ctx, box) {
  if (!ctx || burstStamp < 0) return;
  const now = clock();
  const age = now - burstStamp;
  if (age < 0) return;
  if (age >= BURST_LIFE * 1000) {
    burstStamp = -Infinity;
    burstDone = true;
    fieldAmbienceStats.confetti = 0;
    fieldAmbienceStats.flashes = 0;
    return;
  }
  if (box) fillBox(partyBox, box);

  // Vadesi gelen flaşlar: takvim patlama damgasından türer (deterministik).
  while (flashCount < FLASH_MAX_PER_BURST && now >= nextFlashAt) {
    spawnFlash(now);
    flashCount += 1;
    nextFlashAt += (420 + hash01(burstSeed + 9000 + flashCount * 5 + 11) * 520);
  }

  const b = partyBox;
  const u = b.unit;
  let liveConfetti = 0;
  let liveFlashes = 0;
  for (let i = 0; i < flashes.length; i += 1) {
    const f = flashes[i];
    if (!f.alive) continue;
    if (now - f.stamp >= FLASH_LIFE * 1000) { f.alive = false; continue; }
    liveFlashes += 1;
  }
  for (let i = 0; i < confetti.length; i += 1) {
    const s = confetti[i];
    const a = age / 1000 - s.delay;
    if (a < 0 || a >= s.life) continue;
    liveConfetti += 1;
  }
  fieldAmbienceStats.confetti = liveConfetti;
  fieldAmbienceStats.flashes = liveFlashes;
  if (liveConfetti === 0 && liveFlashes === 0) return;

  for (let i = 0; i < flashes.length; i += 1) {
    const f = flashes[i];
    if (!f.alive) continue;
    const k = (now - f.stamp) / (FLASH_LIFE * 1000);
    ctx.globalAlpha = (1 - k) * 0.4;
    ctx.fillStyle = rgba(UI_COLORS.gold, 1);
    ctx.beginPath();
    ctx.arc(f.x, f.y, Math.max(1, (4 + 9 * k) * u), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = rgba(UI_COLORS.white, 1);
    ctx.beginPath();
    ctx.arc(f.x, f.y, Math.max(0.8, 2.1 * u), 0, TAU);
    ctx.fill();
  }

  for (let i = 0; i < confetti.length; i += 1) {
    const s = confetti[i];
    const a = age / 1000 - s.delay;
    if (a < 0 || a >= s.life) continue;
    const k = a / s.life;
    const x = s.x + s.vx * a + Math.sin(a * s.swayFreq + s.phase) * s.swayAmp;
    const y = s.y + s.vy * a;
    // 2.5D pul: dönüş + cosine ile yassılaşma — pul havada takla atar gibi okunur.
    const flip = Math.cos(a * s.flip + s.phase);
    const fadeIn = Math.min(1, a / 0.12);
    const fadeOut = k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1;
    ctx.save();
    ctx.globalAlpha = fadeIn * fadeOut * 0.92;
    ctx.translate(x, y);
    ctx.rotate(s.phase + a * s.roll);
    ctx.scale(1, Math.max(0.14, Math.abs(flip)));
    ctx.fillStyle = s.color;
    ctx.fillRect(-s.size / 2, -s.tall / 2, s.size, s.tall);
    ctx.restore();
  }
}
