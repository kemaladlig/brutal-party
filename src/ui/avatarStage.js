// Brutal Party — Profil Kartı / Avatar Atölyesi sahne tuvali
//
// İki canvas (ana menü kartı + atölye önizlemesi) aynı kurallıdır:
//   - bitmap, CSS kutusundan ve DPR'den türetilir (sabit 192/220 px değil)
//   - gövde yarıçapı ve saha geometrisi bitmap'in KISA KENARINA oranlıdır
//
// Neden oranlı: yarıçap bitmap'e sabitlenmişken CSS kutusu breakpoint'lerde
// 148 → 104 → 68px'e küçülüyordu. Ölçülen sonuç: gövde kutunun %46'sını
// kaplıyor, geri kalanı boş alan — kart "kırık" okunuyordu. Kutuya göre
// türetilen yarıçap her breakpoint'te aynı oranı tutar ve net (DPR) çizilir.
import { drawBrutalAvatar } from './characterRenderer.js';

/** Gövde çapı, kutunun kısa kenarının bu oranı kadar olsun. */
const BODY_RATIO = 0.74;

/**
 * Canvas'ın CSS kutusu değiştiğinde (görünür/gizlenme, breakpoint, yazı
 * yüklenmesi) ölçümü tazeler.
 *
 * Neden `window.resize` yetmez: menü gizliyken `getBoundingClientRect()` 0 döner
 * ve bitmap 1x1'e düşer; menü açıldığında `resize` olayı çalılmadığı için
 * ölçüm bir daha yapılmaz ve avatar görünmez olur. `ResizeObserver` kutu 0'dan
 * gerçeğe geçtiğinde de tetiklenir.
 * @param {HTMLCanvasElement} canvas
 * @param {() => void} onResize
 * @returns {() => void} Observer'ı bırakan fonksiyon
 */
export function observeStageCanvas(canvas, onResize) {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }
  const ro = new ResizeObserver(() => onResize());
  ro.observe(canvas);
  return () => ro.disconnect();
}

/**
 * Kare temizliği: `clearRect` YALNIZ aktif klip bölgesini siler. Çizim
 * kodundan kaçan bir `clip()` (veya dönüşüm) sonraki tüm kareleri birbirine
 * kilitler ve eski kareler kalıcı olarak üst üste biner — gözlenen belirti:
 * yuvarlak değil, DİKDÖRTGEN tabanlı dolgu + köşede ikinci bir disk, kare
 * yenilendikçe katlanarak büyüyen artık. Kutu `save()`/`restore()` ile
 * sarmalanınca sızan klip ve dönüşüm kare sonunda zorla düşer; `clearRect`
 * de tam bitmap'i temizler.
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D}
 */
export function beginStageFrame(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

/**
 * Canvas'ı CSS kutusuna göre eşitler ve ölçüleri döndürür.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ ctx: CanvasRenderingContext2D, w: number, h: number, r: number }}
 */
export function syncStageCanvas(canvas) {
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
  const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  // `width` ataması bitmap'i sıfırlar; sadece gerçekten değiştiyse yaz.
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    ctx,
    w,
    h,
    r: Math.max(6, Math.round((Math.min(w, h) * BODY_RATIO) / 2)),
  };
}

/**
 * Dokunma patlaması (boing kıvılcımları): üret + ilerlet + çiz.
 * Üçü de burada — menü kartı döngüsü ile `?probe=sparks` aynı kodu kullanır,
 * böylece probda ölçülen merkez, sahnede çizilen merkezdir.
 *
 * Birimler: konumlar CSS px, hızlar r/s, yerçekimi r/s². Konum integrali
 * hıza yarıçapı BİR kez uygular (`p.x += p.vx * r * dt`); ivme hızı doğrudan
 * artırır (`p.vy += G * dt`). İkisini de `* r` ile çarpmak birim hatası olur,
 * patlama kutudan taşardı.
 */
const SPARK_GRAVITY = 5; // r/s²

export function spawnBoingSparks(cx, cy, r, colorHex, rand = Math.random) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI * 2 * i) / 10 + (rand() - 0.5) * 0.4;
    const spd = 1.5 + rand() * 2.2;
    out.push({
      x: cx,
      y: cy - r * 0.23,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 1.0,
      color: i % 2 === 0 ? colorHex : '#FFD700',
      size: 0.07 + rand() * 0.08,
      shape: i % 3 === 0 ? 'star' : (i % 3 === 1 ? 'cross' : 'square'),
      life: 1.0,
      decay: 1.6 + rand() * 0.8,
    });
  }
  return out;
}

export function stepSparks(sparks, r, dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.x += p.vx * r * dt;
    p.y += p.vy * r * dt;
    p.vy += SPARK_GRAVITY * dt;
    p.life -= p.decay * dt;
    if (p.life <= 0) sparks.splice(i, 1);
  }
}

export function drawSparks(ctx, r, sparks) {
  for (const p of sparks) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = Math.max(1, r * 0.023);

    if (p.shape === 'star') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (p.shape === 'cross') {
      const s = p.size * r;
      ctx.lineWidth = Math.max(1.5, r * 0.045);
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y);
      ctx.lineTo(p.x + s, p.y);
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x, p.y + s);
      ctx.stroke();
    } else {
      const s = p.size * r;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }
}
/**
 * Zemin gölge gradyanı — kare başına `createRadialGradient` tahsisi yerine
 * `characterRenderer.js`'teki `playFaceShading` deseni: WeakMap(ctx) →
 * yarıçap 0.25px'e kuantalanmış harita. Gradyan ORİJİN etrafında üretilir;
 * çizim `translate(cx, groundY) + scale(shadowScale)` ile taşınır, böylece
 * ölçek değişimi gradyanı da taşır ve cache tek boyutta kalır.
 */
const GROUND_SHADOW_CACHE = new WeakMap();
const SHADOW_GLOW_REF = 64;

function groundShadowGradient(ctx, r) {
  let byR = GROUND_SHADOW_CACHE.get(ctx);
  if (!byR) {
    byR = new Map();
    GROUND_SHADOW_CACHE.set(ctx, byR);
  }
  const key = Math.round(r * 4) / 4;
  let gradient = byR.get(key);
  if (!gradient) {
    if (byR.size > SHADOW_GLOW_REF) byR.delete(byR.keys().next().value);
    gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.1, key * 0.95));
    gradient.addColorStop(0, 'rgba(12, 8, 34, 0.34)');
    gradient.addColorStop(0.62, 'rgba(12, 8, 34, 0.16)');
    gradient.addColorStop(1, 'rgba(12, 8, 34, 0)');
    byR.set(key, gradient);
  }
  return gradient;
}

/**
 * Sahne çizimi: zemin gölge diski + kaide halkası + gövde.
 * Tüm değerler yarıçapa oranlıdır (ölçülen taban oranları: gölge 1.09r / 0.82r /
 * 0.25r, kaide halkası 0.95r, çerçeve 0.08r, zemin gölgesi 0.09r).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {Object} avatarOpts - drawBrutalAvatar seçenekleri (renk/ifade/açı)
 * @param {number} [yOffset] - Dikey kayma (zıplama/nefes)
 * @param {number} [shadowScale] - Zemin gölgesinin zıplamaya göre ölçeklenmesi
 * @param {number} [ringPulse] - 0..1 dokunma/heyecan halkası parıltısı
 */
export function drawAvatarStage(ctx, w, h, r, avatarOpts, yOffset = 0, shadowScale = 1, ringPulse = 0) {
  const cx = w / 2;
  const cy = h / 2;

  // Zemin gölge diski: karakteri sahneye oturtur, zıplamada uzaklaşır/küçülür.
  // Yumuşak geçişli elips: sert disk kenarları gövdeyi "yırtıyormuş" gibi
  // okunduğu için radyal gradyanla çözüldü; gradyan cache'li, ölçek transform'la.
  ctx.save();
  const groundY = cy + r * 1.02;
  ctx.save();
  ctx.translate(cx, groundY);
  ctx.scale(shadowScale, shadowScale);
  ctx.fillStyle = groundShadowGradient(ctx, r);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Kaide hedef halkası — `ringPulse` yalnız alınlığı/kalınlığı modüle eder;
  // 0'da bugünkü statik çizimle pik pik aynıdır.
  const pulse = Math.max(0, Math.min(1, ringPulse));
  ctx.strokeStyle = `rgba(255, 248, 234, ${(0.28 + pulse * 0.5).toFixed(3)})`;
  ctx.lineWidth = Math.max(1, r * 0.03 * (1 + pulse * 0.6));
  ctx.setLineDash([r * 0.07, r * 0.07]);
  ctx.beginPath();
  ctx.ellipse(cx, groundY, r * 0.95 * (1 + 0.05 * pulse), r * 0.3 * (1 + 0.05 * pulse), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawBrutalAvatar(ctx, cx, cy + yOffset, r, {
    showPips: false,
    showPointer: false,
    // Menü sahnesinde karakter menünün tek öznesidir: düz sticker gibi
    // okumasın diye hacim (sol üst ışık + sağ alt gölge) açılır. Kontur
    // oyun içinden belirgin şekilde incedir — büyük boyda kalınlık "çizgi
    // roman" gibi okunuyordu.
    volume: true,
    borderWidth: Math.max(1.5, r * 0.045),
    shadowOffset: Math.max(1.5, r * 0.1),
    ...avatarOpts,
  });
}
