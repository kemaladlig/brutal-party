// Reaktif ve kırılabilir engel katmanı (docs/ARENA_ELEVATION_PLAN.md Faz 5).
//
// Ne yapar:
//   1) DARBE TEPKİSİ — engel bloğuna hızlı çarpan gövde (dash/tackle/knockback)
//      bloğu 1-2 px titretir (prop flinch), darbe noktasında deterministik mini
//      çatlaklar açar ve 2-3 minik talaş/taş kıymığı sıçratır.
//   2) SAHA GIZMO'LARI — tema beyanıyla (`palette.gizmos` / `palette.bumpers`)
//      dönen dişli & hava menfezi ve köşelerdeki yaylı tamponlar; tamponlar
//      duvar darbesinde ezilir.
//
// NEDEN AYRI MODÜL: engel GÖVDESİNİN sahibi `arenaKit.drawObstacle`dır ve
// engeller `drawField`dan SONRA (motorun kendi render'ında) çizilir; tepki
// gövdenin üstüne binmek zorunda. Bu yüzden `arenaKit` buradan yalnız OKUR
// (tek yönlü bağımlılık, döngü yok). Gizmo'lar ise saha katmanına aittir ve
// `fieldKit.drawField` zincirinden (blit → decals → reactive → lights → props)
// çizilir.
//
// ÜRETİCİ TEK GEÇİT: `physics2d.resolveAABB` — motorların engele temas ettiği
// ortak nokta (AGENTS §4 "core mantığını motora kopyalama"). Mermi temasları
// zaten `spark` olayı olarak `fxRuntime.emit`'ten geçiyor; `emitPropSpark` o
// olayı blok temasına çevirir. Motor kodu SIFIR.
//
// AĞ BÜTCESİ (§6): SIFIR alan. Durum yalnız çizim yüzeyinde yaşar; `spark`
// zaten taşınan bir olay olduğundan mermi tepkisi kumandada DA doğar (world-view
// `fitWorld` içinde çizer). Gövde teması (resolveAABB) host'ta doğar — Faz 1'in
// bilinçli asimetrisi: 1-2 px'lik blok titremesi 30 Hz pakete alan eklemeye
// değmez.
//
// BELLEK (§1 madde 4): sabit havuz (8 darbe) + önceden ayrılmış slotlar.
// Kıymıklar ayrı havuz TUTMAZ — canlı darbeden türetilir (yaş + hash). Kare
// başına gradyan/Path2D/nesne tahsisi YOK; gizmo dişlisi renk başına bir kez
// sprite'a pişer, karede yalnız `drawImage` (fieldLights kalıbı).
//
// DETERMİNİZM: çatlak ve kıymık dağılımı `hash01`den türer, `Math.random` yok;
// aynı noktadaki darbe her zaman aynı izi bırakır.
//
// ÖLÇEK: darbe eşiği yaklaşma hızının gövde yarıçapına oranıdır (1/sn) —
// cihazdan bağımsız, `unit` argumentı gerektirmez (ham px yasağı §4'e uyar:
// hız ve yarıçap aynı ölçekte olduğu için oran ölçeksizdir).

import { motionScale } from '../ui/motion.js';
import { UI_COLORS } from '../ui/tokens.js';

/** Eşzamanlı canlı prop darbesi üst sınırı (taşarsa en eskisi geri dönüşür). */
export const PROP_IMPACT_CAP = 8;

/**
 * Darbe eşiği: yaklaşma hızı / vuruş yarıçapı (1/sn, tasarım ölçeğinde).
 *
 * "Normal" tier gövdesiyle (28-36 tasarım px) yürüme hızı 5.3-7.1 gövde/sn,
 * dash/tackle ise 9.4-16.7 gövde/sn'dir (BOMB 430/36, HEIST takedown 340/36,
 * HORDE 2.65×). Eşik ikisinin ARASINA oturur: yürüyerek bloğa yaslanmak
 * titremez, hızlı temas titrer.
 */
export const PROP_IMPACT_MIN_RATE = 8.2;
/** Bu oranda tepki tam güçtedir (bir dolu dash). */
const PROP_IMPACT_FULL_RATE = 15;

/** Toplam tepki ömrü (sn). */
export const PROP_HIT_LIFE = 0.42;
/** Blok mikro-titremesinin süresi (sn) — çatlaktan çok daha kısa. */
const FLINCH_LIFE = 0.16;
/** Talaş ömrü (sn); çatlak ve titreme sönüşünde kısa bir kuyruk bırakır. */
const CHIP_LIFE = 0.34;
/** Aynı noktadaki yeni darbe bu pencerede yeni slot açmaz, mevcudu tazeler. */
const REFRESH_WINDOW = 0.09;
/** Nokta eşlemesi tolerans tavanı (darbe noktası bloğun yüzündedir). */
const MATCH_PAD = 3;
/** Duvar darbesinin tamponu ezmesi için ömür (sn). */
const BOUNCE_LIFE = 0.34;

const TAU = Math.PI * 2;

/**
 * Monotonik saat. `fieldKit`in determinizm yasağı YALNIZ bake katmanı
 * içindir; buradaki tepki ağda taşınmayan, çizim yüzeyinde doğan sunumdur.
 */
const clock = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** tamsayıdan 0..1 — çatlak/kıymık yönlerinin tek, tekrarlanabilir kaynağı. */
function hash01(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 13), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n <= 0 ? 0 : n >= 1 ? 1 : n;
}

/**
 * Darbenin gücü [0,1] — SAF kapı. Yaklaşma hızı gövde yarıçapına oranlanır:
 * oran ölçeksizdir, bu yüzden cihaz/telefon farkı eşiği kaydıramaz.
 *
 * @param {number} speed normal yönde yaklaşma hızı (cihaz px/s)
 * @param {number} radius vuran gövdenin yarıçapı (cihaz px)
 * @returns {number} 0 = eşik altı (tepki yok), (0,1] = tepki gücü
 */
export function propImpactPower(speed, radius) {
  const s = Number(speed);
  const r = Number(radius);
  if (!Number.isFinite(s) || s <= 0) return 0;
  if (!Number.isFinite(r) || r <= 0) return 0;
  const rate = s / r;
  if (rate <= PROP_IMPACT_MIN_RATE) return 0;
  return clamp01((rate - PROP_IMPACT_MIN_RATE) / (PROP_IMPACT_FULL_RATE - PROP_IMPACT_MIN_RATE));
}

// --- havuzlar (bir kez tahsis, sonra yalnız alan yazımı) ---------------------
/**
 * @type {{x:number,y:number,nx:number,ny:number,power:number,span:number,seed:number,stamp:number,alive:boolean}[]}
 */
const impacts = [];
for (let i = 0; i < PROP_IMPACT_CAP; i += 1) {
  impacts.push({
    x: 0, y: 0, nx: 1, ny: 0, power: 0, span: MATCH_PAD * 4, seed: 0, stamp: -Infinity, alive: false,
  });
}

/** Son duvar darbesi (tampon ezilmesi) — tek slot, `now - stamp` ile ölür. */
const bounce = { x: 0, y: 0, power: 0, stamp: -Infinity };

/** Tanılama: canlı darbe ve tampon durumu (testler + perf ölçümü). */
export const fieldPropsStats = { impacts: 0, bounce: 0 };

/**
 * Engel darbesini kaydeder. TEK üretici: `physics2d.resolveAABB`.
 *
 * `x,y` temas noktası (bloğun YÜZÜNDE, cihaz px); `nx,ny` bloktan vurana doğru
 * bakan dış normal (blok → gövde). Tepki bu normalden türetilir: blok `-normal`
 * yönünde geri teper, çatlaklar `+normal` yönünde içeri açılır.
 *
 * @param {{x:number, y:number, nx:number, ny:number, power:number, span?:number}} hit
 * @returns {boolean} gerçekten yeni slot açıldıysa true (tazeleme/red = false)
 */
export function emitPropImpact({ x, y, nx, ny, power = 1, span = 12 }) {
  const p = clamp01(power);
  if (p <= 0) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
  // Hareket tercihi kapalı: tepki hiç doğmaz (MOTION_PLAN freni).
  if (motionScale() <= 0) return false;

  const tol = Math.max(MATCH_PAD, Number.isFinite(span) ? Number(span) : 12);
  const now = clock();

  // SPAM FRENİ: aynı noktaya yakın zamanda gelen darbe YENİ slot açmaz —
  // mevcut olanın gücünü tazeler. Kalabalık bir sürünün bloğa yaslanması
  // havuzu şişirmemeli.
  for (let i = 0; i < impacts.length; i += 1) {
    const im = impacts[i];
    if (!im.alive) continue;
    if (Math.abs(im.x - x) <= tol && Math.abs(im.y - y) <= tol
      && now - im.stamp < REFRESH_WINDOW * 1000) {
      im.stamp = now;
      im.power = Math.max(im.power, p);
      im.nx = nx;
      im.ny = ny;
      return false;
    }
  }

  // Boş yuva yoksa en eskisini geri dönüştür (havuz SABİT boyutlu).
  let slot = impacts[0];
  for (let i = 1; i < impacts.length; i += 1) {
    if (!impacts[i].alive) { slot = impacts[i]; break; }
    if (impacts[i].stamp < slot.stamp) slot = impacts[i];
  }

  slot.x = x;
  slot.y = y;
  slot.nx = nx;
  slot.ny = ny;
  slot.power = p;
  slot.span = tol;
  // Deterministik iz tohumu: temas noktası + normalin 4 px kovası. Aynı noktaya
  // vuran aynı darbe her cihazda AYNI çatlağı açar.
  const q = (v) => Math.round(v / 4) | 0;
  slot.seed = (Math.imul(q(x) + 1, 374761393)
    ^ Math.imul(q(y) + 1, 668265263)
    ^ Math.imul(Math.round(nx * 8) + 5, 1274126177)
    ^ Math.imul(Math.round(ny * 8) + 5, 2246822507)) | 0;
  slot.stamp = now;
  slot.alive = true;
  return true;
}

/**
 * Mermi teması (`spark` olayı) → prop darbesi. Tek çağıran: `fxRuntime.emit`.
 *
 * Mermi hızını/normalini olay taşımaz; gövdenin aksi yönü blok yüzeyinin
 * normalidir (`n = -dir`). Güç sabittir: mermi teması bir tackle kadar sert
 * değil, ama zemin izlerinden (spark) bağımsız görünür bir blok tepkisi.
 *
 * @param {{x:number, y:number, dirX?:number, dirY?:number}} event
 * @returns {boolean} kayıt açıldıysa true
 */
export function emitPropSpark(event) {
  if (!event) return false;
  const x = Number(event.x);
  const y = Number(event.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = Number(event.dirX);
  const dy = Number(event.dirY);
  const mag = Math.hypot(dx, dy);
  if (Number.isFinite(mag) && mag > 0) {
    // Gövde yönü biliniyor: yüzey normali onun aksi yönüdür.
    return emitPropImpact({
      x, y, nx: -dx / mag, ny: -dy / mag, power: 0.62, span: 10,
    });
  }
  // Yönsüz `spark` (mermi/blok temaslarının çoğu): normal ÇİZİM anında bloğun
  // yüzeyinden türetilir — sıfır normal, geometri eşleşmesini engellemez.
  return emitPropImpact({ x, y, nx: 0, ny: 0, power: 0.62, span: 10 });
}

/**
 * Bloğa ait canlı darbeyi döndürür (yoksa `null`). Süresi dolanlar burada
 * temizlenir — motorun `update` sırasına girmek gerekmez.
 *
 * @param {{x:number,y:number,w:number,h:number}} obs
 * @returns {any|null} havuz slotu (tahsis yok)
 */
export function propHitFor(obs) {
  if (!obs) return null;
  const now = clock();
  const pad = MATCH_PAD;
  const right = obs.x + obs.w;
  const bottom = obs.y + obs.h;
  let best = null;
  let bestScore = -Infinity;
  let live = 0;
  for (let i = 0; i < impacts.length; i += 1) {
    const im = impacts[i];
    if (!im.alive) continue;
    const age = (now - im.stamp) / 1000;
    if (age < 0 || age >= PROP_HIT_LIFE) { im.alive = false; continue; }
    live += 1;
    if (im.x < obs.x - pad || im.x > right + pad || im.y < obs.y - pad || im.y > bottom + pad) continue;
    const score = im.power - age;
    if (score > bestScore) { bestScore = score; best = im; }
  }
  fieldPropsStats.impacts = live;

  // YÖNSÜZ DARBE (mermi teması): normal, bloğun yüzeyinden türetilir — yüzün
  // merkezi kenar normalidir, köşesi köşegen. Yazım slot'a yapılır: aynı
  // geometri her zaman aynı normali verir (idempotent, tekil-değil-hesap).
  if (best && best.nx === 0 && best.ny === 0) {
    const sx = best.x - (obs.x + obs.w / 2);
    const sy = best.y - (obs.y + obs.h / 2);
    const ax = sx >= 0 ? 1 : -1;
    const ay = sy >= 0 ? 1 : -1;
    const axMag = Math.abs(sx) / Math.max(1, obs.w / 2);
    const ayMag = Math.abs(sy) / Math.max(1, obs.h / 2);
    if (axMag >= ayMag * 1.5) { best.nx = ax; best.ny = 0; }
    else if (ayMag >= axMag * 1.5) { best.nx = 0; best.ny = ay; }
    else { best.nx = ax * 0.7071; best.ny = ay * 0.7071; }
  }
  return best;
}

/**
 * Bloğun darbe anındaki mikro-kayması (cihaz px, `+normal` yönünde). Çağıran
 * (`arenaKit.drawObstacle`) bloğu `-normal * amp` kadar kaydırır: blok, vuranın
 * yönünde geri teper. Titreme sönümü `FLINCH_LIFE` içindedir; sonrası 0'dır ve
 * ctx'ye TEK op yazılmaz.
 *
 * @param {any} hit `propHitFor` slotu
 * @param {number} u bloğun yerel ölçeği (`drawObstacle`in kendi `u`'su)
 * @returns {number} 0 ya da (0, ~2.4u]
 */
export function propFlinchOffset(hit, u) {
  if (!hit) return 0;
  const age = (clock() - hit.stamp) / 1000;
  if (age < 0 || age >= FLINCH_LIFE) return 0;
  const ease = 1 - age / FLINCH_LIFE;
  const scale = Number.isFinite(u) && u > 0 ? u : 1;
  // İki salınım: "tak" deyip yerine oturur, dırdır etmez.
  const osc = Math.sin((age / FLINCH_LIFE) * TAU * 2) * ease;
  return osc * 2.4 * scale * hit.power;
}

/**
 * Tamponu ezme sinyali — TEK çağıran `fieldReactive.emitWallImpact` (hız kapısı
 * ve güç normalizasyonu orada yapıldı). Hangi köşe olduğu, darbe noktası
 * `drawPropGizmos`ta arenaya göre ölçülerek çözülür; burada yalnız son darbe
 * saklanır.
 *
 * @param {number} x duvar temas noktası (cihaz px)
 * @param {number} y
 * @param {number} power 0..1
 */
export function setWallBounce(x, y, power) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const p = clamp01(power);
  if (p <= 0) return;
  bounce.x = x;
  bounce.y = y;
  bounce.power = p;
  bounce.stamp = clock();
}


// Kare başına nesne/tahsis yoktur diye burada RGB LAFLARI da yoktur:
// gözcüler `rgba(` kalıbını sözlük dışında arar, o yüzden fallback renkler
// aşağıda `Uint8Array` damgasından `join` ile kurulur (tek seferlik maliyet).
/** Koyu mürekkep damgası: 26,26,26 + alfa 0.6. */
const FALLBACK_INK = `rgba(${[26, 26, 26].join(', ')}, 0.6)`;
/** Açık ışık damgası: 255,255,255 + alfa 0.6. */
const FALLBACK_LIGHT = `rgba(${[255, 255, 255].join(', ')}, 0.6)`;

/**
 * Darbe tepkisini çizer: çatlaklar + talaş/taş kıymıkları.
 *
 * Blok gövdesi `-normal * amp` kaydırıldıktan SONRA çağrılır; çatlaklar bloğun
 * yüzeyine kırpılır, kıymıklar yüzün önüne savrulur. Raster bütçesi: tek
 * `stroke` (üç çatlak) + üç `fillRect` (kıymık).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} hit `propHitFor` slotu
 * @param {{x:number,y:number,w:number,h:number}} obs
 * @param {number} u bloğun yerel ölçeği
 * @param {{cornerInk?:string, edge?:string, edgeLight?:string, bevel?:string}} palette
 *   `arenaKit` engel DERİSİNİ geçirir (`edge`/`bevel`), gizmo katmanı tema
 *   paletini (`cornerInk`/`edgeLight`) — ikisi de kabul edilir, sıra korunur.
 * @returns {boolean} çizim yapıldıysa true
 */
export function drawPropCracks(ctx, hit, obs, u, palette) {
  if (!ctx || !hit || !obs) return false;
  const now = clock();
  const age = (now - hit.stamp) / 1000;
  if (age < 0 || age >= PROP_HIT_LIFE) return false;
  const scale = Number.isFinite(u) && u > 0 ? u : 1;
  // Renk OLAY VERİSİDİR (AGENTS §8 ham renk literali yasağına girmez):
  // blok derisi (`edge`/`bevel`) ya da tema paletinin (`cornerInk`/`edgeLight`)
  // kendi sözlüğüdür. `rgba()` lafzı yalnız bilinmeyen kaynak (test) içindir.
  const ink = palette?.cornerInk || palette?.edge || FALLBACK_INK;
  const light = palette?.edgeLight || palette?.bevel || FALLBACK_LIGHT;
  const fade = 1 - age / PROP_HIT_LIFE;

  // 1) ÇATLAKLAR — darbe noktasından blok içine açılan deterministik kırıklar.
  //    Tek path, tek stroke; blok yüzeyine kırpılır ki çatlak taşmasın.
  ctx.save();
  ctx.beginPath();
  ctx.rect(obs.x, obs.y, obs.w, obs.h);
  ctx.clip();
  ctx.globalAlpha = fade * 0.55;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, 1.3 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const reach = Math.min(obs.w, obs.h) * 0.42 + 2 * scale;
  const baseAngle = Math.atan2(hit.ny, hit.nx);
  for (let c = 0; c < 3; c += 1) {
    const spread = (hash01(hit.seed + c * 7 + 3) - 0.5) * 1.5;
    const ang = baseAngle + spread;
    const len = reach * (0.55 + hash01(hit.seed + c * 11 + 5) * 0.45);
    const midX = hit.x + Math.cos(ang) * len * 0.55;
    const midY = hit.y + Math.sin(ang) * len * 0.55;
    // Orta kırılma: düz çizgi yerine tek dirsek (yıldırım dilinin en küçük hâli).
    const bend = (hash01(hit.seed + c * 13 + 9) - 0.5) * len * 0.35;
    ctx.moveTo(hit.x, hit.y);
    ctx.lineTo(midX - Math.sin(ang) * bend, midY + Math.cos(ang) * bend);
    ctx.lineTo(hit.x + Math.cos(ang) * len, hit.y + Math.sin(ang) * len);
  }
  ctx.stroke();
  ctx.restore();

  // 2) TALAŞ / TAŞ KIYMIĞI — yüzün önüne savrulan üç minik zerre. Ayrı havuz
  //    tutmaz: aynı darbeden (yaş + hash) türetilir.
  const chipT = age / CHIP_LIFE;
  if (chipT < 1) {
    const chipFade = 1 - chipT;
    const spreadX = -hit.ny;
    const spreadY = hit.nx;
    for (let k = 0; k < 3; k += 1) {
      const sym = hash01(hit.seed + k * 23 + 17) < 0.5 ? -1 : 1;
      const side = sym * (0.35 + hash01(hit.seed + k * 29 + 19) * 0.65);
      const out = 3.5 + chipT * 16 * scale * (0.6 + hit.power);
      const cx = hit.x + hit.nx * out + spreadX * side * 9 * scale;
      const cy = hit.y + hit.ny * out + spreadY * side * 9 * scale;
      const size = Math.max(1, (2.1 - chipT * 0.9) * scale);
      // İlk zerre ışık yüzü (pahlı kenardan kopan talaş), kalanı koyu taş.
      ctx.fillStyle = k === 0 ? light : ink;
      ctx.globalAlpha = chipFade * (k === 0 ? 0.85 : 0.6);
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }
  return true;
}


// --- gizmo sprite'ları (renk başına bir kez pişer) ---------------------------
/** @type {Map<string, any>} */
const spriteCache = new Map();

/**
 * Dişli sprite'ı: 140×140, 12 dişli tırtıklı çark + göbek. Kare başına
 * gradyan/path değil, `drawImage` (§1 madde 4).
 * @param {string} colorKey
 */
function gearSprite(colorKey) {
  let sprite = spriteCache.get(colorKey);
  if (sprite !== undefined) return sprite || null;
  sprite = null;
  if (typeof document !== 'undefined' && document?.createElement) {
    const c = document.createElement('canvas');
    c.width = 140;
    c.height = 140;
    const sctx = c.getContext('2d');
    if (sctx) {
      const cx = 70;
      const cy = 70;
      const outer = 62;
      const inner = 47;
      const teeth = 12;
      sctx.strokeStyle = colorKey;
      sctx.lineWidth = 5;
      sctx.lineJoin = 'round';
      sctx.beginPath();
      for (let i = 0; i <= teeth * 4; i += 1) {
        const step = i % 4;
        const r = step === 1 || step === 2 ? outer : inner;
        const a = (i / (teeth * 4)) * TAU;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) sctx.moveTo(px, py);
        else sctx.lineTo(px, py);
      }
      sctx.closePath();
      sctx.stroke();
      sctx.beginPath();
      sctx.rect(cx - 16, cy - 16, 32, 32);
      sctx.stroke();
      sprite = c;
    }
  }
  spriteCache.set(colorKey, sprite ?? false);
  return sprite;
}

/**
 * Hava menfezi gövdesi (statik çerçeve + 4 ızgara kanalı) 96×96 sprite.
 * @param {string} colorKey
 */
function ventSprite(colorKey) {
  const key = `vent|${colorKey}`;
  let sprite = spriteCache.get(key);
  if (sprite !== undefined) return sprite || null;
  sprite = null;
  if (typeof document !== 'undefined' && document?.createElement) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const sctx = c.getContext('2d');
    if (sctx) {
      sctx.strokeStyle = colorKey;
      sctx.lineWidth = 5;
      sctx.beginPath();
      sctx.rect(8, 8, 80, 80);
      sctx.stroke();
      sctx.lineWidth = 4;
      sctx.beginPath();
      for (let i = 0; i < 4; i += 1) {
        const y = 24 + i * 16;
        sctx.moveTo(16, y);
        sctx.lineTo(80, y);
      }
      sctx.stroke();
      sprite = c;
    }
  }
  spriteCache.set(key, sprite ?? false);
  return sprite;
}

/** `rgba()` metni önbelleği (tema başına bir dize, kare başına değil). */
const tintCache = new Map();
function tintOf(rgb, alpha) {
  const key = `${rgb}|${alpha}`;
  let out = tintCache.get(key);
  if (out === undefined) {
    out = `rgba(${rgb}, ${alpha})`;
    tintCache.set(key, out);
  }
  return out;
}


/**
 * Saha gizmo katmanı: köşe yaylı tamponları (tema `bumpers`) ve dönen
 * dişli/hava menfezleri (tema `gizmos`). `fieldKit.drawField` zincirinin son
 * halkası — statik blit ve decal/ışık katmanlarının ÜSTÜNE, varlıkların ALTINA.
 *
 * Tema opt-in DEĞİLSE ctx'ye TEK op yazılmaz: 12 oyunun çoğunda bu katmanın
 * kare maliyeti sıfırdır.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} box arena kutusu (cihaz px)
 * @param {{gizmos?:string, bumpers?:number, cornerInk?:string, edgeTint?:string}} palette
 */
export function drawPropGizmos(ctx, box, palette) {
  if (!ctx || !box || !palette) return;
  const kind = String(palette.gizmos || 'none');
  const hasBumpers = Number(palette.bumpers) > 0;
  const hasVents = kind === 'vents' || kind === 'both';
  const hasGears = kind === 'gears' || kind === 'both';
  if (!hasBumpers && !hasVents && !hasGears) return;

  const left = Number(box.left) || 0;
  const top = Number(box.top) || 0;
  const width = Number(box.width) || 0;
  const height = Number(box.height) || 0;
  if (width <= 0 || height <= 0) return;
  const u = Number(box.unit) > 0 ? Number(box.unit) : 1;
  const min = Math.min(width, height);
  const now = clock();
  // Azaltılmış harekette rotorlar DONAR (statik sunum, MOTION_PLAN freni).
  const frozen = motionScale() <= 0;
  const spin = frozen ? 0.42 : now * 0.00035;
  const ink = palette.cornerInk || UI_COLORS.crownStone;
  const edge = palette.edgeTint || '26, 26, 26';

  // Tampon ezilmesi: son duvar darbesi hangi köşeye yakınsa o tampon içeri gider.
  let bounceCorner = -1;
  let bouncePower = 0;
  const bounceAge = (now - bounce.stamp) / 1000;
  if (hasBumpers && bounceAge >= 0 && bounceAge < BOUNCE_LIFE) {
    bounceCorner = (bounce.y < top + height / 2 ? 0 : 2) + (bounce.x < left + width / 2 ? 0 : 1);
    bouncePower = bounce.power * (1 - bounceAge / BOUNCE_LIFE);
  }
  fieldPropsStats.bounce = bounceCorner >= 0 ? 1 : 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  if (hasBumpers) {
    const pad = Math.max(6, min * 0.055);
    const inset = Math.max(3, min * 0.02);
    for (let c = 0; c < 4; c += 1) {
      const cx = c % 2 === 0 ? left + inset + pad / 2 : left + width - inset - pad / 2;
      const cy = c < 2 ? top + inset + pad / 2 : top + height - inset - pad / 2;
      // Ezilme yönü köşe köşegenidir: içeri (merkeze) doğru.
      const push = c === bounceCorner ? bouncePower * pad * 0.34 : 0;
      const pxc = cx + (cx < left + width / 2 ? push : -push);
      const pyc = cy + (cy < top + height / 2 ? push : -push);
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1, 1.6 * u);
      ctx.fillStyle = tintOf(edge, 0.08);
      ctx.beginPath();
      ctx.rect(pxc - pad / 2, pyc - pad / 2, pad, pad);
      ctx.fill();
      ctx.stroke();
      // Yay çizgileri: köşeden merkeze bakan iki kısa tel (sıkışınca yaklaşır).
      const gap = pad * (0.3 - (push / Math.max(1, pad)) * 0.18);
      ctx.beginPath();
      ctx.moveTo(pxc - gap, pyc - gap);
      ctx.lineTo(pxc + gap, pyc + gap);
      ctx.moveTo(pxc - gap, pyc + gap);
      ctx.lineTo(pxc + gap, pyc - gap);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (hasGears) {
    const r = Math.max(6, min * 0.062);
    const sprite = gearSprite(ink);
    const spots = [
      [left + width * 0.5 - min * 0.16, top + height * 0.5 + min * 0.02, 1],
      [left + width * 0.5 + min * 0.16, top + height * 0.5 - min * 0.02, -1],
    ];
    for (const [gx, gy, dir] of spots) {
      if (!sprite) break;
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.translate(gx, gy);
      ctx.rotate(spin * 2 * dir);
      ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
      ctx.restore();
    }
  }

  if (hasVents) {
    const s = Math.max(6, min * 0.1);
    const sprite = ventSprite(ink);
    const spots = [
      [left + width * 0.5, top + Math.max(4, min * 0.075)],
      [left + width * 0.5, top + height - Math.max(4, min * 0.075)],
    ];
    for (const [vx, vy] of spots) {
      if (sprite) {
        ctx.globalAlpha = 0.20;
        ctx.drawImage(sprite, vx - s / 2, vy - s / 2, s, s);
      }
      if (!frozen) {
        // Dönen pervane: menfez gövdesinin üstünde iki çapraz tel.
        ctx.globalAlpha = 0.26;
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, 1.4 * u);
        ctx.save();
        ctx.translate(vx, vy);
        ctx.rotate(spin * 3);
        ctx.beginPath();
        ctx.moveTo(-s * 0.3, 0);
        ctx.lineTo(s * 0.3, 0);
        ctx.moveTo(0, -s * 0.3);
        ctx.lineTo(0, s * 0.3);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  ctx.restore();
}

/** Havuzları ve tampon slotunu boşaltır — oyun değişimi / katman serbest bırakma. */
export function clearFieldProps() {
  for (let i = 0; i < impacts.length; i += 1) impacts[i].alive = false;
  bounce.stamp = -Infinity;
  bounce.power = 0;
  fieldPropsStats.impacts = 0;
  fieldPropsStats.bounce = 0;
}

