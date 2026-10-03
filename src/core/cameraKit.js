// KAMERA — sunum katmanı zoom/punch. Simülasyon değil.
//
// Ölçülen eksik: `BaseGame.applyScreenShake` yalnız ÖTELME yapıyordu. Darbe
// "güçlü" olduğunda ekran kayıyor ama YAKLAŞMIYORDU; sonuçta ağır bir darbe ile
// hafif bir darbe ekranda aynı büyüklükte okunuyordu. Brawl Stars / Smash'te
// kritik vuruş anında kamera içe doğru atar ve geri döner — "güç" bilgisi
// yalnız ses ve titreşimden değil, GÖRÜNTÜden de okunur.
//
// MİMARİ: bu bir çekirdek modüldür ve motorlar kendi kamera ayarlarını buraya
// yazar. Sarsıntı `BaseGame`'de kalır çünkü motor `applyScreenShake`'i zaten
// çağırıyor ve bu iki katmanı birleştirmek 12 motorun çağrı yerini değiştirmek
// olurdu. Bunun yerine `beginCamera`/`endCamera` bir CAMERA BLOKU açar:
//   ctx.save(); ... beginCamera(ctx, arena); sahne ... endCamera(ctx, arena); ... ctx.restore()
// `endCamera` sarsıntıyı da kendi içinde uygular, yani `applyScreenShake`
// çağrısı yapılırsa ikisi ÇAKIŞMAZ (aşağıda `shaked` bayrağı).
//
// AĞ BÜTÇESİ (§6): SIFIZ alan. Zoom yalnız HOST'ta uygulanır; kumanda
// world-view kendi `fitWorld` dönüşümünü kullanır. Bu FARKLILIK bilinçlidir:
// kumanda zaten arenayı ekrana SIĞDIRAN farklı bir kamera ile çiziyor, aynı
// zoom'u uygulamak görüntüyü kırpardı. Vuruş izleri (decal/ışık) iki yüzeyde
// doğar, çünkü onlar türetilmiş sunumdur.
//
// BELLEK: kare başına nesne/gradyan tahsisi YOK. Zoom tek `ctx.scale` + iki
// `translate`; süreç durumu hazır ayrılmış tek nesnede yaşar.

import { motionScale } from '../ui/motion.js';

/** Darbe punch'ının tepe büyümesi (1.03 = %3 içe). */
const PUNCH_MAX = 0.03;
/** Punch'ın sönme süresi (sn). */
const PUNCH_LIFE = 0.16;
/** Climaks sürekli yakınlaşmasının tepe oranı. */
const CLIMAX_MAX = 0.022;

/**
 * GÖRÜNMEZ YAKINLAŞMA EŞİĞİ (~%0.4).
 *
 * Ölçülen gerekçe: `fxKit` profillerinde `hit` travması 0.2'dir; %0.4'ün
 * altındaki zoom bir 1900px sahnada ~7px'dir ve ekranda "ne oldu?" sorusunu
 * doğurmaz — yani her isabette hafif bir zoom uygulamak yalnız yeniden
 * raster maliyeti üretir, bilgi taşımaz. Eşiğin altı ölçek DEĞİŞTİRMEZ
 * (`zoom === 1` erken dönüş), yani boş kareler `ctx.scale` bile yazmaz.
 */
const PUNCH_DEADZONE = 0.004;

const clock = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

/** Süreç durumu — bir kez tahsis, sonra alan yazımı. */
const cam = { punch: 0, punchStamp: -Infinity, climax: 0 };

/** Tanısal. */
export const cameraStats = { punch: 0, climax: 0, applied: false };

/**
 * Darbe punch'ı kaydeder. `power` 0..1 (daha yüksek = daha sert vuruş).
 *
 * @param {number} power
 */
export function punchCamera(power) {
  const p = Number(power);
  if (!Number.isFinite(p) || p <= 0) return false;
  if (motionScale() <= 0) return false;
  cam.punch = Math.min(1, p);
  cam.punchStamp = clock();
  return true;
}

/**
 * Sürekli yakınlaşma seviyesi (0..1) — maç gerilimi. Kaynak:
 * `roundLifecycle.climaxLevel` → `fieldAmbience.setClimax` ile AYNI sinyal.
 * İki katman aynı veriyi okur, ikisi de farklı efekt üretir.
 *
 * @param {number} level
 */
export function setCameraClimax(level) {
  const v = Number(level);
  cam.climax = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/**
 * Kamera bloğunu açar: sahnenin ETRAFINI orta noktaya sabitler ve ölçekler.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {FieldGeometry} arena - `width/height` zorunlu; `left/top` yoksa 0
 */
export function beginCamera(ctx, arena) {
  if (!ctx || !arena) return 1;
  const w = Number(arena.width) || 0;
  const h = Number(arena.height) || 0;
  if (!(w > 0) || !(h > 0)) return 1;

  // Teşhis her zaman güncel durumu yansıtmalı: 1:1 dönüşte de `applied=false`
  // demektir, ama `climax`/`punch` değerleri silinmez (aksi halde "neden
  // yaklaşmıyor?" sorusunun cevabı teşhiste kaybolur).
  cameraStats.punch = cam.punch;
  cameraStats.climax = cam.climax;

  let zoom = 1 + cam.climax * CLIMAX_MAX;
  const age = (clock() - cam.punchStamp) / 1000;
  if (cam.punch > 0 && age >= 0 && age < PUNCH_LIFE) {
    // Hızlı at, yumuşak dön: tepe anın başında, kübik sönüşle.
    const k = 1 - age / PUNCH_LIFE;
    zoom += PUNCH_MAX * cam.punch * k * k;
  } else if (cam.punch > 0) {
    cam.punch = 0;
  }
  // Eşiğin altı: `zoom` 1'e YUVARLANIR (float artık bırakılmaz), sonra erken
  // dönüş. Yuvarlama olmadan `1.0004` da `scale()` yazardı.
  zoom = Math.round(zoom * 1e4) / 1e4;
  if (Math.abs(zoom - 1) < PUNCH_DEADZONE) zoom = 1;
  if (zoom === 1) return 1;

  // Ölçekleme ARENA MERKEZİ etrafında olmalı; ekran merkezi değil. Aksi
  // hâlde zoom kenarlardaki boşluğu yutup arenayı kaydırırdı.
  const cx = (Number(arena.left) || 0) + w / 2;
  const cy = (Number(arena.top) || 0) + h / 2;
  ctx.translate(cx, cy);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);

  cameraStats.applied = true;
  return zoom;
}

/**
 * Kamera bloğunu kapatır — çağıranın kendi `ctx.restore()`'ına devreder.
 *
 * Sarsıntı BURADA uygulanır ve `BaseGame.applyScreenShake` ile çakışmaz:
 * ikisi de `ctx.translate` yapsa ikinci biri birincinin üstüne eklendiği için
 * toplam ofset iki katına çıkardı. Motor sarsıntıyı BURAYA devreder.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} maxOffset
 * @param {number} trauma 0..1
 * @param {{x:number, y:number, impulse:number}} dir yönlü itki vektörü
 */
export function endCamera(ctx, maxOffset = 14, trauma = 0, dir = null) {
  if (!ctx) return;
  const t = Number(trauma);
  if (!(t > 0)) return;
  const intensity = t * t * maxOffset;
  if (!(intensity > 0)) return;
  const w = Math.min(1, (dir?.impulse ?? 0)) * 0.7;
  const jx = (Math.random() - 0.5) * 2;
  const jy = (Math.random() - 0.5) * 2;
  ctx.translate(intensity * (jx * (1 - w) + (dir?.x || 0) * w), intensity * (jy * (1 - w) + (dir?.y || 0) * w));
}

/** Süreç durumunu sıfırlar — maç/oyun değişimi. */
export function resetCamera() {
  cam.punch = 0;
  cam.punchStamp = -Infinity;
  cam.climax = 0;
  cameraStats.punch = 0;
  cameraStats.climax = 0;
  cameraStats.applied = false;
}