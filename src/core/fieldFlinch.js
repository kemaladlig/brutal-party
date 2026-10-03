// HASAR YÖNÜ OKU — vurulan gövde, darbenin geldiği yöne mikro-itilir.
//
// Ölçülen eksik: `hit`/`slay`/`kill` olayları partikül, halka, pop, hit-stop
// ve ekran sarsıntısı üretiyordu; vurulan gövde ise yerinde duruyordu. Oyuncu
// "nereden geldi" sorusunu ekranda cevaplayamıyordu — özellikle kalabalık
// saha modlarında (HORDE) hangi düşmanın vurduğu okunmuyordu.
//
// ÇÖZÜM: 2-3 px'lik bir itme + gövde boyunca kısa bir ezilme. Kısa bir ivme
// değil, "tema" hissi: kırmızı flaş zaten "vuruldun" diyor, bu "nereden"
// diyor. İkisi birlikte darbeyi okunur kılar.
//
// ÜRETİCİ TEK GEÇİT: `fxRuntime.emit` → `emitFxFlinch` (Faz 2 `emitFxScar`
// ve Faz 3 `emitFxLight` ile AYNI disiplin). Motor kodu SIFIR, paket alanı
// SIFIR.
//
// BELLEK: sabit havuz (8 darbe). Kare başına nesne tahsisi YOK; süpürme
// `now - stamp` farkıyla yapılır. Boş havufta `avatarFlinchOffset` tek bir
// `null` döner ve çağıran hiç op yazmaz.
//
// KİMLİK: yuva SLOt ile değil KONUMLA eşleşir — okuyan taraf, canlı darbeye
// en yakın varlığı bulur. Bu bilinçli bir tercih: host ve kumanda aynı slot
// sırasını taşısa da kumanda `hit` olayını kendi `FxRuntime`'ında oynattığı
// için damga anı farklıdır. Konum eşleşmesi iki yüzeyde de "vurulan o varlık
// itildi" sonucunu üretir; slot eşleşmesi bazen hiç eşleşmezdi.

import { motionScale } from '../ui/motion.js';

/** Eşzamanlı canlı darbe üst sınırı (taşarsa en eskisi geri dönüşür). */
export const FLINCH_CAP = 8;

/** Toplam oku ömrü (sn). */
export const FLINCH_LIFE = 0.18;

/** Aynı noktadaki yeni darbe bu pencerede yeni yuva açmaz, mevcudu tazeler. */
const REFRESH_WINDOW = 0.06;

/** Nokta eşlemesi toleransı — gövde yarıçapı payı kadar yakınlık yeter. */
const MATCH_PAD = 8;

const clock = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** @type {{x:number,y:number,nx:number,ny:number,radius:number,stamp:number,alive:boolean}[]} */
const impacts = [];
for (let i = 0; i < FLINCH_CAP; i += 1) {
  impacts.push({ x: 0, y: 0, nx: 0, ny: 0, radius: 0, stamp: -Infinity, alive: false });
}

let overflow = 0;

export const fieldFlinchStats = { live: 0, overflow: 0 };

/**
 * Darbe okunu kaydeder — görsel itme + ezilme.
 *
 * @param {string} fxKind `fxKit` olay adı
 * @param {{x?: number, y?: number, dirX?: number, dirY?: number, size?: number}} event
 */
export function emitFxFlinch(fxKind, event) {
  // Yalnız GERÇEK hasar oku üretir. `shot` (kendi ateşin) ve `pickup` kıvılcımı
  // darbe değildir; `blocked` ve `zone` da gövde itmesi gerektirmez.
  if (fxKind !== 'hit' && fxKind !== 'slay' && fxKind !== 'kill') return false;
  const x = Number(event?.x);
  const y = Number(event?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  // Azaltılmış harekette oku üretilmez (partikül bilgiyi taşır).
  if (motionScale() <= 0) return false;

  const now = clock();
  let slot = impacts[0];
  let oldest = Infinity;
  for (let i = 0; i < impacts.length; i += 1) {
    if (!impacts[i].alive) { slot = impacts[i]; oldest = -1; break; }
    if (impacts[i].stamp < oldest) { oldest = impacts[i].stamp; slot = impacts[i]; }
  }
  const already = slot.alive && (now - slot.stamp) < REFRESH_WINDOW * 1000
    && Math.abs(slot.x - x) < MATCH_PAD && Math.abs(slot.y - y) < MATCH_PAD;
  if (!already && !slot.alive) overflow += 1;
  if (already) fieldFlinchStats.overflow = overflow;

  // Normal yön: vuruş yönü. `dirX/dirY` verilmemişse merkezden dışarı —
  // yani vurulan gövde nereden geldiyse oradan dışarı itilir (bilinen kötü
  // varsayımdan iyidir; her motor `dirX/dirY` yazmıyor).
  let nx = Number(event?.dirX);
  let ny = Number(event?.dirY);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || (nx === 0 && ny === 0)) { nx = 0; ny = -1; }
  const mag = Math.hypot(nx, ny) || 1;

  slot.x = x;
  slot.y = y;
  slot.nx = nx / mag;
  slot.ny = ny / mag;
  const raw = Number(event?.size);
  slot.radius = Number.isFinite(raw) && raw > 0 ? raw : 0;
  slot.stamp = now;
  slot.alive = true;
  return true;
}

/**
 * Bir varlığın oku ofsetini döner — `null` ise hareket yok, çağıran hiç op
 * yazmamalıdır (boş-havuz temsili, `fieldDecals` ile aynı kapı).
 *
 * @param {number} x
 * @param {number} y
 * @param {number} radius varlık yarıçapı
 * @returns {{x: number, y: number, squeeze: number}|null}
 */
export function avatarFlinchOffset(x, y, radius) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const r = Number(radius);
  const bodyR = Number.isFinite(r) && r > 0 ? r : 0;
  const now = clock();
  let live = 0;
  let best = null;
  let bestAge = Infinity;
  for (let i = 0; i < impacts.length; i += 1) {
    const im = impacts[i];
    if (!im.alive) continue;
    const age = (now - im.stamp) / 1000;
    if (age >= FLINCH_LIFE) { im.alive = false; continue; }
    live += 1;
    // Nokta eşleşmesi: darbe varlığın gövdesinde (veya çok yakınında) mi?
    const tol = MATCH_PAD + bodyR;
    if (Math.abs(im.x - x) > tol || Math.abs(im.y - y) > tol) continue;
    if (age < bestAge) { bestAge = age; best = im; }
  }
  fieldFlinchStats.live = live;
  if (!best) return null;

  // Zaman eğrisi: hızlı çık, yumuşak dön. Kare başına `Math.sin` değil,
  // lineer ilerleme — türev süreksizliği görsel olarak "düşme" gibi durur.
  const k = Math.max(0, 1 - bestAge / FLINCH_LIFE);
  const push = k * k * (bodyR * 0.14);
  return {
    x: best.nx * push,
    y: best.ny * push,
    // Gövde, darbe yönünde hafifçe ezilir (tema hissi).
    squeeze: k * 0.14,
  };
}

/** Havuzları boşaltır — oyun değişimi / katman serbest bırakma. */
export function clearFieldFlinch() {
  for (let i = 0; i < impacts.length; i += 1) impacts[i].alive = false;
  overflow = 0;
  fieldFlinchStats.live = 0;
  fieldFlinchStats.overflow = 0;
}