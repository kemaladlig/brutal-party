// Zemin çatışma izleri (docs/ARENA_ELEVATION_PLAN.md Faz 2) — patlama isi,
// patinaj çizgisi ve boya sıçraması: maç uzadıkça saha bir savaş alanına
// döner, raunt değişince tertemiz açılır. Statik bake'in ÜSTÜNDE,
// varlıkların ALTINDA çizilir (`fieldKit.drawField` blit'in hemen ardından).
//
// Neden motorlarda TEK SATIR YOK: 12 motor iki ortak geçitten zaten geçer —
// çatışma olayları `FxRuntime.emit`'ten, saha çizimi `drawField`'den. Üretici
// de tüketici de merkezde; "moda özel dal" (§3/§9) yazılmadan 12 oyun birden
// kazanır.
//
// AĞ BÜTCESİ (§6): SIFIR alan. İz, olayın ZATEN taşıdığı veriden türer
// (x, y, renk, yön, boyut, unit) ve havuz yalnız çizim yüzeyinde yaşar.
// Faz 1'in aksine bu katman TELEFONDA DA görünür: kumanda FX olaylarını anlık
// güvenilir yoldan alıp kendi `FxRuntime`'ında oynatıyor (`acceptFx`), yani
// izler orada aynı olaydan, aynı DÜNYA koordinatlarında doğar. World-view
// çizimi `fitWorld` dönüşümünün içinde olduğu için host-uzayı koordinatlar
// telefon ekranına kendi kendine oturur.
//
 // BELLEK (§1 madde 4): sabit boyutlu HALKA TAMPO (ring buffer, 32 iz). Kare
// başına yeni nesne/gradyan/yol YOK — aşan olay en eski izi ezer, süpürme
// `now - stamp` farkıyla yapılır (motorun `update` sırasına girmek gerekmez).
// Boş havuz ctx'ye TEK bir çizim yapmaz. Tempo freni (`SCAR_MIN_GAP`) yeni iz
// açma hızını ~7/sn'ye sabitler: çizim maliyeti böylece olay yoğunluğuyla
// değil, tavanla ölçeklenir.
//
// TEMİZLİK: izlerin silinmesi için raunt olayı dinlemeye gerek yok — her
// motor `drawField`'e kendi `seed`'ini (`hashFieldSeed(mode, roundId)`)
// veriyor. Seed değiştiyse yeni raunttur: kalan izler 0.4 sn'de süpürülür ve
// süpürme bitene kadar yeni iz açılmaz (temiz raunt başlangıcı). Host da
// kumanda da aynı seed'i okuduğu için davranış iki yüzde de aynıdır.
//
// DETERMİNİZM: lob yönleri ve sıçramaların dağılımı `hash01(seed)`'den türer,
// `Math.random` yok — aynı olay her zaman aynı izi bırakır.

import { motionScale } from '../ui/motion.js';

/** Eşzamanlı zemin izi üst sınırı (halka tampon: taşarsa en eskisi ezilir). */
export const DECAL_CAP = 32;

/** İz imzaları — `DECAL_*` tamsayıları havuz slotunun `kind` alanıdır. */
export const DECAL_SCORCH = 0;
export const DECAL_SKID = 1;
export const DECAL_SPLAT = 2;

/** Ömürler (sn). Plan: is 4-6 sn'de yavaşça solar; sürtme/sıçrama daha kısa. */
const SCORCH_LIFE = 5.2;
const SKID_LIFE = 3.0;
const SPLAT_LIFE = 3.8;

/** Raunt değişiminde eski izlerin süpürülme süresi (sn). */
const WIPE_LIFE = 0.4;
/** Aynı noktadaki aynı imza bu pencerede yeni kayıt açmaz, mevcut olanı tazeler. */
const REFRESH_WINDOW = 0.45;
/** "Aynı nokta" yarıçapı (tasarım px — `unit` ile çarpılır). */
const REFRESH_SPAN = 16;
/**
 * Yeni iz açma temposu (sn arası). TANKS turbo dumanı ve SNAKE boost egzozu
 * KARE BAŞINA olay üretir; tavanlı bir aynı-nokta birleştirme onların peşinden
 * yetişemez (varlık yer değiştirir). Bu fren olmadan zemin halıya döner ve 32
 * yuvanın tamamı tek tankın izleriyle dolar.
 */
const SCAR_MIN_GAP = 0.14;

/** Tepe opaklıkları: iz zemine işlemek için var, varlık sanılacak kadar da koyu değil. */
const SCORCH_ALPHA = 0.3;
const SKID_ALPHA = 0.2;
const SPLAT_ALPHA = 0.5;

/** Boyutu olmayan olaylar için varsayılan tasarım px karakteristiği (FX pop'un 34'ü). */
const DEFAULT_EVENT_SIZE = 34;

const TAU = Math.PI * 2;

/**
 * Monotonik saat. `fieldKit`'in determinizm yasağı YALNIZ bake katmanı
 * içindir; buradaki iz ağda taşınmayan, çizim yüzeyinde doğan bir sunumdur.
 * (`fieldReactive` aynı üç satırlık korumayı taşıyor — iki kardeş modülde de
 * platform özelliği yalnız bu küçücük taramadır.)
 */
const clock = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** tamsayıdan 0..1 — lob yönlerinin tek, tekrarlanabilir kaynağı. */
function hash01(n) {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * İzin koyu mürekkebi — `palette.edgeTint` (tema kenar tonu) tam opak, gücü
 * `globalAlpha` verir. Neden önbellek: tema başına bir dize, kare başına
 * bir dize DEĞİL (§1 madde 4; tahsis yapmayan arama için anahtar ilkel string).
 */
const inkCache = new Map();
function scarInk(palette) {
  const key = String(palette?.edgeTint);
  let ink = inkCache.get(key);
  if (ink === undefined) {
    ink = `rgba(${key}, 1)`;
    inkCache.set(key, ink);
  }
  return ink;
}

/**
 * FX olayı → zemin imzası eşlemesi. Yalnız ZATEN VAR olan olaylar listelenir
 * (`fxKit` kapalı kümesi); bilinmeyen ya da listelenmemiş kind iz açmaz.
 *
 * - `kill`  → İS: patlama/infilak seviyesindeki tek olay (flaş profili de ondadır).
 * - `slay`  → SÇRAMA: sıradan düşman ölümü, kendi renginde.
 * - `hit`   → SÇRAMA: vurulanın rengi zemine dökülür.
 * - `dust`  → PATİNAJ: dash/tackle/ani yön değişimi ayağın altından toz kaldırdığında.
 */
const SCAR_FOR_FX = Object.freeze({
  kill: DECAL_SCORCH,
  slay: DECAL_SPLAT,
  hit: DECAL_SPLAT,
  dust: DECAL_SKID,
});

// --- havuz (bir kez tahsis, sonra yalnız alan yazımı) -----------------------
/** @type {{kind:number,x:number,y:number,size:number,unit:number,rot:number,seed:number,color:string|null,stamp:number,maxLife:number,alive:boolean}[]} */
const scars = [];
for (let i = 0; i < DECAL_CAP; i += 1) {
  scars.push({
    kind: DECAL_SCORCH, x: 0, y: 0, size: 1, unit: 1, rot: 0, seed: 0,
    color: null, stamp: -Infinity, maxLife: SCORCH_LIFE, alive: false,
  });
}

/** Süpürme başlangıç damgası; 0 = süpürme yok. */
let wipeStamp = 0;
/** Son YENİ iz açma damgası (`SCAR_MIN_GAP` freni); -Infinity = hiç açılmadı. */
let lastScarAt = -Infinity;
/** Son görülen saha seed'i; null = henüz hiç gözlemlenmedi (ilk kare süpürme yapmaz). */
let seedKey = null;

/** Tanılama: canlı iz sayısı, imza bazında (testler ve perf ölçümü). */
export const fieldDecalStats = { live: 0, scorch: 0, skid: 0, splat: 0 };

/**
 * FX olayını zemin izine çevirir. TEK çağıran: `FxRuntime.emit`.
 *
 * @param {string} fxKind `fxKit` olay adı ('kill' | 'slay' | 'hit' | 'dust' | ...)
 * @param {{x?:number, y?:number, color?:string, dirX?:number, dirY?:number, size?:number}} event
 * @param {number} unit saha ölçeği (`arena.unit`; boyutlar buradan türer)
 * @returns {boolean} yeni iz açıldıysa true (tazeleme / tempo veya süpürme freni → false)
 */
export function emitFxScar(fxKind, event, unit = 1) {
  const kind = SCAR_FOR_FX[fxKind];
  if (kind === undefined) return false;
  const x = Number(event?.x);
  const y = Number(event?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  // Süpürme sürerken zemin tertemiz kalmak zorundadır: yeni rauntun ilk
  // karelerinde eski izlerin üstüne leke bırakmayız.
  if (wipeStamp !== 0) return false;
  if (motionScale() <= 0) return false;

  const u = Number.isFinite(unit) && unit > 0 ? unit : 1;
  const raw = Number(event?.size);
  const size = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EVENT_SIZE;
  const now = clock();

  // SPAM FRENİ: çatışma yoğunken (HORDE sürüsü, tank yaylımı) aynı yerdeki
  // aynı imza yeni slot yemez — mevcut iz tazelenir ve büyür. Havuzun 32
  // yuvası böylece tek köşedeki kavgayla dolup sahanın geri kalanını
  // hafızasız bırakmaz.
  const span = REFRESH_SPAN * u;
  for (let i = 0; i < scars.length; i += 1) {
    const s = scars[i];
    if (!s.alive || s.kind !== kind) continue;
    if (now - s.stamp < REFRESH_WINDOW * 1000
      && Math.abs(s.x - x) <= span && Math.abs(s.y - y) <= span) {
      s.stamp = now;
      s.size = Math.max(s.size, resolveSize(kind, size));
      s.color = resolveColor(event?.color, s.color);
      return false;
    }
  }

  // TEMPO FRENİ: ardışık iki YENİ iz arasında `SCAR_MIN_GAP` olmalı. Yalnız
  // kare-başı olay üreten akışları (turbo dumanı, boost egzozu) bu durdurur —
  // leke başına ~17 canvas op'u var ve halı gibi döşenmiş bir zemin okunurluğu
  // (I7) de havuzu da yer. Tazeleme (yukarıda) fren dışıdır: o yeni kayıt açmaz.
  if (now - lastScarAt < SCAR_MIN_GAP * 1000) return false;

  // Boş yuva yoksa en eskisini ez (halka tampon).
  let slot = scars[0];
  let slotIndex = 0;
  for (let i = 1; i < scars.length; i += 1) {
    if (!scars[i].alive) { slot = scars[i]; slotIndex = i; break; }
    if (scars[i].stamp < slot.stamp) { slot = scars[i]; slotIndex = i; }
  }

  // YÖN: olay yön taşıyorsa (geri tepme/sekme) patinaj oraya döner; yoksa
  // tek belirli hash yönü — sayaç kullanılsaydı aynı olay ikinci kez
  // üretildiğinde farklı iz çıkarır ve test edilemez olurdu.
  const dirX = Number(event?.dirX);
  const dirY = Number(event?.dirY);
  const powered = Number.isFinite(dirX) && Number.isFinite(dirY) && (dirX * dirX + dirY * dirY > 0.25);
  const seed = ((Math.round(x) * 73856093) ^ (Math.round(y) * 19349663)
    ^ (slotIndex * 83492791) ^ (kind * 2654435761)) | 0;

  slot.kind = kind;
  slot.x = x;
  slot.y = y;
  slot.size = resolveSize(kind, size);
  slot.unit = u;
  slot.rot = powered ? Math.atan2(/** @type {number} */ (dirY), /** @type {number} */ (dirX))
    : hash01(seed * 3 + 1) * Math.PI * 2;
  slot.seed = seed;
  slot.color = resolveColor(event?.color, null);
  slot.maxLife = kind === DECAL_SCORCH ? SCORCH_LIFE : (kind === DECAL_SKID ? SKID_LIFE : SPLAT_LIFE);
  slot.stamp = now;
  slot.alive = true;
  lastScarAt = now;
  return true;
}

/** İmza başına karakteristik boyut (tasarım px) — tavanlar küçük telefonda kalabalığı keser. */
function resolveSize(kind, size) {
  if (kind === DECAL_SCORCH) return clampNum(size * 1.15, 20, 88);
  if (kind === DECAL_SPLAT) return clampNum(size * 0.26, 3.5, 12);
  return clampNum(size * 0.5, 12, 30);
}

/** Olay rengi; yoksa `null` kalır (çizim anında tema mürekkebine düşer). */
function resolveColor(color, fallback) {
  return typeof color === 'string' && color ? color : (fallback ?? null);
}

/** Havuzu boşaltır — oyun değişimi / katman serbest bırakma. */
export function clearFieldDecals() {
  for (let i = 0; i < scars.length; i += 1) scars[i].alive = false;
  wipeStamp = 0;
  lastScarAt = -Infinity;
  seedKey = null;
  fieldDecalStats.live = 0;
  fieldDecalStats.scorch = 0;
  fieldDecalStats.skid = 0;
  fieldDecalStats.splat = 0;
}

/**
 * Zemin izi katmanını arena uzayında çizer: `fieldKit.drawField` statik
 * blit'inin hemen ardından, reaktif kenar tepkisinden ÖNCE çağırır.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} box arena kutusu (cihaz px)
 * @param {FieldPalette} palette `fieldTheme()` çıktısı
 * @param {number} [seed] saha seed'i — raunt/oyun kimliği; değişince zemin süpürülür
 */
export function drawFieldDecals(ctx, box, palette, seed = 0) {
  if (!ctx || !box) return;
  const now = clock();
  const left = Number(box.left) || 0;
  const top = Number(box.top) || 0;
  const right = left + (Number(box.width) || 0);
  const bottom = top + (Number(box.height) || 0);

  // 1) SÜPÜRME: süresi dolan ve arena kutusu dışında kalan kayıtlar kapanır.
  //    Kutu resize/raunt ile değişmiş olabilir; eski koordinattaki iz yeni
  //    sahanın ortasında duran bir leke olurdu.
  let live = 0;
  let scorch = 0;
  let skid = 0;
  let splat = 0;
  for (let i = 0; i < scars.length; i += 1) {
    const s = scars[i];
    if (!s.alive) continue;
    const age = (now - s.stamp) / 1000;
    if (age < 0 || age >= s.maxLife
      || s.x < left - 1 || s.x > right + 1 || s.y < top - 1 || s.y > bottom + 1) {
      s.alive = false;
      continue;
    }
    live += 1;
    if (s.kind === DECAL_SCORCH) scorch += 1;
    else if (s.kind === DECAL_SKID) skid += 1;
    else splat += 1;
  }

  // 2) Süpürme bitti mi? Eski izler tamamen kapanır; bundan sonra açılanlar
  //    yeni rauntun izleridir ve tam güçle çizilir.
  if (wipeStamp !== 0 && now - wipeStamp >= WIPE_LIFE * 1000) {
    wipeStamp = 0;
    for (let i = 0; i < scars.length; i += 1) scars[i].alive = false;
    live = 0; scorch = 0; skid = 0; splat = 0;
  }

  // 3) RAUNT DEĞİŞİKLİĞİ: seed `(mode, roundId)`'den türer, yani seed'i
  //    görmek raundu görmektir — ayrı bir yaşam döngüsü bağlantısı yok.
  const seedValue = Number(seed) >>> 0;
  if (seedKey === null) seedKey = seedValue;
  else if (seedKey !== seedValue) {
    seedKey = seedValue;
    if (live > 0) wipeStamp = now;
  }

  fieldDecalStats.live = live;
  fieldDecalStats.scorch = scorch;
  fieldDecalStats.skid = skid;
  fieldDecalStats.splat = splat;
  // BOŞ HAVUZ TEMSİLİ YOK: ctx'ye hiç dokunmadan döner (bake log eşitliği).
  if (live === 0) return;

  const wipeMul = wipeStamp === 0 ? 1 : Math.max(0, 1 - (now - wipeStamp) / (WIPE_LIFE * 1000));

  // KIRPMA: izler arenanın içinde doğar ama loblar/sıçramalar kenardan taşabilir
  // — saha dışı zemine (tepsi kenarının üstüne) tek bir piksel bile sızmaz.
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  ctx.clip();

  for (let i = 0; i < scars.length; i += 1) {
    const s = scars[i];
    if (!s.alive) continue;
    const k = (now - s.stamp) / 1000 / s.maxLife;
    if (s.kind === DECAL_SCORCH) paintScorch(ctx, s, k, palette, wipeMul);
    else if (s.kind === DECAL_SKID) paintSkid(ctx, s, k, palette, wipeMul);
    else paintSplat(ctx, s, k, palette, wipeMul);
  }
  ctx.restore();
}

/**
 * Sönüm eğrisi: iz bir süre OLDUĞU GİBİ kalır (partinin hafızası aksın), sonra
 * kuyrukta solar. `hold` imzaya göre ayarlanır — patinaj en çabuk silineni.
 */
function scarFade(k, hold) {
  return k <= hold ? 1 : 1 - (k - hold) / (1 - hold);
}

/**
 * Patlama isi: merkezden dışa yayılan, yarı saydam organik leke. Ana elips +
 * iki hash lobu + bir dış zerrecik tek path'te TOPLANIR (tek `fill`), çünkü
 * kare başına op bütçesi var. `moveTo` alt-yolu, elipsleri birbirine bağlayan
 * çizgiyi keser.
 */
function paintScorch(ctx, s, k, palette, wipeMul) {
  // Doğuş: ilk ~%10'da leke dışa açılır, sonra sabit kalır ve solar.
  const grow = 0.84 + 0.16 * Math.min(1, k / 0.1);
  const r = s.size * s.unit * grow;
  ctx.globalAlpha = scarFade(k, 0.5) * SCORCH_ALPHA * wipeMul;
  ctx.fillStyle = scarInk(palette);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rot);
  ctx.beginPath();
  appendBlob(ctx, 0, 0, r, r * 0.72);
  for (let lobe = 0; lobe < 2; lobe += 1) {
    const a = hash01(s.seed * (lobe + 2) + 1) * TAU;
    const dist = r * (0.5 + hash01(s.seed * (lobe + 3) + 7) * 0.35);
    const rr = r * (0.3 + hash01(s.seed * (lobe + 5) + 13) * 0.2);
    appendBlob(ctx, Math.cos(a) * dist, Math.sin(a) * dist, rr, rr * 0.7);
  }
  const speckA = hash01(s.seed * 11 + 3) * TAU;
  appendBlob(ctx, Math.cos(speckA) * r * 1.3, Math.sin(speckA) * r * 1.3,
    Math.max(1, r * 0.14), Math.max(1, r * 0.1));
  ctx.fill();
  ctx.restore();
}

/**
 * Patinaj / fren çizgisi: harekete paralel, öne doğru daralan ÇİFT iz. Koyu
 * mürekkep (tema kenar tonu) — lastik/sürtünme rengi oyuncunun rengi değil.
 */
function paintSkid(ctx, s, k, palette, wipeMul) {
  const half = s.size * s.unit;
  const gap = Math.max(1, 4.5 * s.unit);
  ctx.globalAlpha = scarFade(k, 0.28) * SKID_ALPHA * wipeMul;
  ctx.strokeStyle = scarInk(palette);
  ctx.lineWidth = Math.max(1, 2.8 * s.unit);
  ctx.lineCap = 'round';
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rot);
  ctx.beginPath();
  ctx.moveTo(-half, -gap);
  ctx.lineTo(half, -gap * 0.55);
  ctx.moveTo(-half, gap);
  ctx.lineTo(half, gap * 0.55);
  ctx.stroke();
  ctx.restore();
}

/**
 * Boya sıçraması: vurulanın kendi renginde merkez leke + dışa saçılan üç
 * zerrecik. Renkli pullar krem zeminde okunur ama varlık sanılmasın diye
 * küçük tutulur (boyut `size` tavanı `resolveSize`'de).
 */
function paintSplat(ctx, s, k, palette, wipeMul) {
  const r = s.size * s.unit;
  ctx.globalAlpha = scarFade(k, 0.5) * SPLAT_ALPHA * wipeMul;
  ctx.fillStyle = s.color || scarInk(palette);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rot);
  ctx.beginPath();
  appendBlob(ctx, 0, 0, r, r * 0.8);
  for (let fleck = 0; fleck < 3; fleck += 1) {
    const a = hash01(s.seed * (fleck + 2) + 5) * TAU;
    const dist = r * (1.5 + hash01(s.seed * (fleck + 4) + 9) * 1.1);
    const rr = Math.max(0.6, r * (0.24 + hash01(s.seed * (fleck + 7) + 17) * 0.2));
    appendBlob(ctx, Math.cos(a) * dist, Math.sin(a) * dist, rr, rr);
  }
  ctx.fill();
  ctx.restore();
}

/** Path'e kapalı bir elips alt-yolu ekler — `moveTo` bağlantı çizgisini keser. */
function appendBlob(ctx, x, y, rx, ry) {
  const w = Math.max(0.5, rx);
  const h = Math.max(0.5, ry);
  ctx.moveTo(x + w, y);
  ctx.ellipse(x, y, w, h, 0, 0, TAU);
}
