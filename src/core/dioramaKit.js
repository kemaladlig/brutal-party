// Paylaşılan Tabletop Diorama Görsel Kiti — 12 oyun modunun tamamında
// fiziksel konsol / masaüstü diorama kalitesini sağlayan modüler görsel yapıtaşları.
// Kural: Kopya-yapıştır yok; yönlü gölgeler, 3B küreler, kesme taşlar, jetonlar
// ve tehlike şeritleri buradan tüketilir. Sıfır GC ayrımı (döngüde gradyan/nesne yok).

import { UI_COLORS } from '../ui/tokens.js';
import { drawTabletopIcon } from './tabletopIcons.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// 0. YUMUŞAK TEMAS GÖLGESİ (paylaşılan sprite)
// ---------------------------------------------------------------------------

/**
 * Gölge mürekkebi — TEK kaynak. `arenaKit`'in önceki gölge damgası da bu
 * değeri kullanıyordu; iki ayrı mürekkep yüzeyin birinde koyu diğerinde
 * gri gölge üretiyordu.
 */
export const CONTACT_SHADOW_INK = '12, 8, 20';

/** `rgba()` kurucusu — çağrı başına tek dize, sprite duraklarında bir kez. */
export const contactShadowInk = (a) => `rgba(${CONTACT_SHADOW_INK}, ${a})`;

/**
 * 64×64 radyal düşüş, BİR KEZ pişirilir; karede yalnız `drawImage`.
 *
 * Neden sprite: iç içe birkaç elips yumuşak düşüşün yalnız TAKLİDİDİR ve
 * kenarda görünen bantlar bırakır. `shadowBlur` DEĞİL: her çizimde konvolüsyon
 * yapar ve GPU hızlı yolunu kapatır. 64×64 ≈ 16 KB, tek kez.
 */
const CONTACT_SHADOW_SIZE = 64;
const CONTACT_SHADOW_STOPS = /** @type {ReadonlyArray<[number, string]>} */ (Object.freeze([
  [0, contactShadowInk(0.44)],
  [0.34, contactShadowInk(0.25)],
  [0.68, contactShadowInk(0.08)],
  [1, contactShadowInk(0)],
]));

let contactShadowSprite = null;
let contactShadowTried = false;

/**
 * Yumuşak gölge sprite'ı (64×64) veya `null` (DOM'suz ortam).
 *
 * Negatif sonuç da önbelleklenir: `document.createElement` her çağrıda yeniden
 * denemek, SSR/test yolunda her varlıkta bir `TypeError` demekti.
 */
export function getContactShadowSprite() {
  if (contactShadowSprite || contactShadowTried) return contactShadowSprite;
  contactShadowTried = true;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    // Değişken adı bilinçli: `sprite`, `canvas` DEĞİL. Kural §4 oyun yüzeyinin
    // DPR'sini main.js'e bağlar; offscreen katman boyutlaması serbesttir ve
    // `fieldKit.createLayerCanvas` de `layer` adıyla aynı deseni kullanır.
    const sprite = document.createElement('canvas');
    const g = sprite.getContext && sprite.getContext('2d');
    if (!g) return null;
    sprite.width = CONTACT_SHADOW_SIZE;
    sprite.height = CONTACT_SHADOW_SIZE;
    const half = CONTACT_SHADOW_SIZE / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    for (const [stop, color] of CONTACT_SHADOW_STOPS) grad.addColorStop(stop, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, CONTACT_SHADOW_SIZE, CONTACT_SHADOW_SIZE);
    contactShadowSprite = sprite;
  } catch {
    contactShadowSprite = null;
  }
  return contactShadowSprite;
}

/**
 * Varlığın altına yumuşak temas gölgesi basar — kare başına tek `drawImage`.
 *
 * `ctx` zaten varlığın MERKEZİNE ötelenmişse `(0, ry)` de yeterlidir; dünya
 * koordinatında çağıranlar `cx/cy` verir. `ry` gölgenin yarı ekseni, `rx` yarı
 * genişliğidir; `drop` gövde merkezinden tabana olan düşüş (küre yarıçapına
 * oranlıdır, ham px yazılmaz).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx gövde merkezinin x'i
 * @param {number} cy gövde merkezinin y'si (veya `drop` uygulanmışsa taban)
 * @param {number} rx
 * @param {number} ry
 * @param {{alpha?: number, drop?: number}} [opts]
 */
export function drawDioramaContactShadow(ctx, cx, cy, rx, ry, opts = {}) {
  if (!(rx > 0) || !(ry > 0)) return;
  const alpha = opts.alpha ?? 1;
  if (!(alpha > 0)) return;
  const baseY = cy + (opts.drop || 0);
  // Sprite'ın ÇİZİLEBİLİR olması gerekir: sahte/eksik ctx'ler (test kaydedici,
  // SSR) `document.createElement` yanıltıcı biçimde döndürebilir. Çizilemiyorsa
  // aşağıdaki elips yoluna düşeriz — görsel daha sert, ama çökmez.
  const sprite = typeof ctx?.drawImage === 'function' ? getContactShadowSprite() : null;
  if (!sprite) {
    // DOM'suz ortam (test/SSR): üç iç içe elips. Görsel olarak daha sert, ama
    // çökmez ve aynı alanı kaplar.
    ctx.save();
    for (const [scale, a] of [[1, 0.08], [0.72, 0.12], [0.45, 0.18]]) {
      ctx.globalAlpha = alpha * a;
      ctx.fillStyle = contactShadowInk(1);
      ctx.beginPath();
      ctx.ellipse(cx, baseY, rx * scale, ry * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.translate(cx, baseY);
  ctx.scale(1, ry / rx);
  ctx.drawImage(sprite, -rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

/**
 * 1. ZEMİN TEMAS VE UÇUŞ GÖLGESİ (Diorama Ground Shadow)
 * Sol-üst (-45°) ışıktan türeyen yönlü elips temas/yükseklik gölgesi.
 */
export function drawDioramaShadow(ctx, x, y, radius, opts = {}) {
  const u = opts.u ?? 1;
  const aspect = opts.aspect ?? 0.55;
  const height = opts.height ?? 0;
  const baseAlpha = opts.alpha ?? 0.24;
  const alpha = Math.max(0.04, baseAlpha - height * 0.015);
  const scale = Math.max(0.6, 1 - height * 0.03);
  const rx = radius * scale;
  const ry = radius * aspect * scale;
  const ox = (opts.offsetX ?? 1.5) * u;
  const oy = (opts.offsetY ?? 3.5) * u;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = opts.color || UI_COLORS.inkDark;
  ctx.beginPath();
  ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 2. VOLUMETRİK 3B KÜRE (Diorama 3D Sphere)
 * Fiziksel bilye/top hacmi: -45° speküler ışık kubbesi + alt hilal oklüzyonu + kontur.
 */
export function drawDioramaSphere(ctx, x, y, radius, color, opts = {}) {
  const u = opts.u ?? (radius / 16);
  const r = Math.max(1, radius);

  ctx.save();
  // Ana gövde dolgusu
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // 3B Işık & Gölge Klipsi
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // Alt gölge hilali (Ambient Occlusion)
  ctx.globalAlpha = opts.shadowAlpha ?? 0.32;
  ctx.fillStyle = UI_COLORS.pureBlack;
  ctx.beginPath();
  ctx.arc(x + 1.6 * u, y + 2.6 * u, r, 0, Math.PI * 2);
  ctx.fill();

  // Üst-sol speküler ışık kubbesi (Key Light)
  ctx.globalAlpha = opts.highlightAlpha ?? 0.42;
  ctx.fillStyle = UI_COLORS.white;
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Dış mürekkep konturu
  ctx.strokeStyle = opts.stroke || UI_COLORS.lineDark;
  ctx.lineWidth = Math.max(1, (opts.strokeWidth ?? 2.2) * u);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();

  // Akkor iç çekirdek (smash, plazma, enerji patlamaları için)
  if (opts.glowCore) {
    ctx.save();
    ctx.globalAlpha = opts.glowAlpha ?? 0.92;
    ctx.fillStyle = UI_COLORS.white;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * 3. 2.5D MADALYON / ALTIN JETON (Diorama Coin)
 * Milled rim (kalın kenar), speküler pah ve damgalı iç kabartma.
 */
export function drawDioramaCoin(ctx, x, y, radius, opts = {}) {
  const u = opts.u ?? (radius / 12);
  const r = Math.max(1, radius);
  const rim = Math.max(1.5, 2.4 * u);
  const hoverY = opts.hoverY ?? 0;
  const drawY = y + hoverY;

  // Zemin gölgesi
  drawDioramaShadow(ctx, x, y, r, { u, height: Math.abs(hoverY) });

  ctx.save();
  // 2.5D Madalyon Kenar Kalınlığı (Coin Extrusion)
  ctx.fillStyle = UI_COLORS.crownAmber;
  ctx.beginPath();
  ctx.ellipse(x, drawY + rim, r, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI_COLORS.lineDark;
  ctx.lineWidth = 1.6 * u;
  ctx.stroke();

  // Canlı Altın Ön Yüzey
  ctx.fillStyle = opts.color || UI_COLORS.crownGold;
  ctx.beginPath();
  ctx.arc(x, drawY, r, 0, Math.PI * 2);
  ctx.fill();

  // Üst-Sol Speküler Işık Pahı (-45° Key Light)
  ctx.save();
  ctx.strokeStyle = UI_COLORS.white;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, 1.4 * u);
  ctx.beginPath();
  ctx.arc(x, drawY, r - 1.2 * u, Math.PI * 0.85, Math.PI * 1.85);
  ctx.stroke();
  ctx.restore();

  // Dış Kontur
  ctx.strokeStyle = UI_COLORS.lineDark;
  ctx.lineWidth = Math.max(1, 1.8 * u);
  ctx.beginPath();
  ctx.arc(x, drawY, r, 0, Math.PI * 2);
  ctx.stroke();

  // İç Damga (Yıldız / İkon / Glif)
  if (opts.icon) {
    drawTabletopIcon(ctx, opts.icon, x, drawY, Math.round(r * 1.2), { color: opts.iconColor || UI_COLORS.inkDark });
  } else {
    drawTabletopIcon(ctx, 'star', x, drawY, Math.round(r * 1.25), { color: opts.iconColor || UI_COLORS.inkDark });
  }

  ctx.restore();
}

/**
 * 4. KESME DEĞERLİ TAŞLAR VE RELİKLER (Diorama Faceted Gems)
 * Çift tonlu yüzeyler (aydınlık sol/üst, koyu sağ/alt) ve prizma ışıltısı.
 */
export function drawDioramaGem(ctx, x, y, radius, type = 'diamond', opts = {}) {
  const u = opts.u ?? (radius / 14);
  const r = Math.max(1, radius);
  const hoverY = opts.hoverY ?? 0;
  const drawY = y + hoverY;

  // Zemin gölgesi
  drawDioramaShadow(ctx, x, y, r, { u, height: Math.abs(hoverY) });

  ctx.save();
  ctx.translate(x, drawY);

  if (type === 'relic' || type === 'octahedron') {
    // 8 Yüzlü Antik Relik Taşı (Flash/Seismic Zone Relic)
    const baseColor = opts.color || UI_COLORS.crownSpark;
    const shadowColor = opts.shadowColor || UI_COLORS.crownAmber;

    // Sağ gölge üçgeni
    ctx.fillStyle = shadowColor;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();

    // Sol aydınlık üçgeni
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(-r, 0);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();

    // Orta faset çizgisi
    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();

    // Dış kontur
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.stroke();

    // Üst tepe prizma ışıltısı
    ctx.fillStyle = UI_COLORS.white;
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.25, 1.4 * u, 0, Math.PI * 2);
    ctx.fill();

    if (opts.icon) {
      drawTabletopIcon(ctx, opts.icon, 0, 0, Math.round(r * 1.1), { color: UI_COLORS.inkDark });
    }
  } else {
    // Klasik Elmas/Yakut Prizması (Diamond / Ruby / Emerald)
    const baseColor = opts.color || (type === 'ruby' ? UI_COLORS.crownRed : UI_COLORS.crownTeleport);
    const shadowColor = opts.shadowColor || (type === 'ruby' ? UI_COLORS.danger : UI_COLORS.crownBlue);

    // Alt gölge yüzü
    ctx.fillStyle = shadowColor;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();

    // Üst aydınlık yüzü
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(-r, 0);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = UI_COLORS.lineDark;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.stroke();

    // Merkez elmas ikonu / glint
    drawTabletopIcon(ctx, 'gem', 0, 0, Math.max(10, r * 1.1), { color: UI_COLORS.white });
  }

  ctx.restore();
}

/**
 * 5. JAPON BAHÇE TAŞ FENERİ (Diorama Stone Lantern / Tōrō)
 * Pagoda çatısı, taş kaidesi, oymalı penceresi ve sıcak amber kandil ışıltısı.
 */
export function drawDioramaLantern(ctx, x, y, opts = {}) {
  const u = opts.u ?? 1;
  const active = opts.active !== false;

  // 1. Zemin gölgesi
  drawDioramaShadow(ctx, x, y, 14 * u, { u, aspect: 0.5, alpha: 0.28 });

  ctx.save();
  ctx.translate(x, y);

  // Sıcak kandil zemin aurası
  if (active) {
    ctx.save();
    ctx.globalAlpha = 0.16 + (opts.flicker ?? 0) * 0.06;
    ctx.fillStyle = UI_COLORS.crownGold;
    ctx.beginPath();
    ctx.arc(0, 0, 48 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Taş Ayak Kaidesi (Stone Base)
  ctx.fillStyle = UI_COLORS.crownStone;
  ctx.fillRect(-7 * u, 4 * u, 14 * u, 5 * u);
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = 1.5 * u;
  ctx.strokeRect(-7 * u, 4 * u, 14 * u, 5 * u);

  // 3. Işıklı Fener Odası (Lattice Light Box)
  ctx.fillStyle = active ? UI_COLORS.crownGold : UI_COLORS.crownStoneDarker;
  ctx.fillRect(-9 * u, -7 * u, 18 * u, 11 * u);
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineWidth = 1.8 * u;
  ctx.strokeRect(-9 * u, -7 * u, 18 * u, 11 * u);

  // Ahşap/taş pencere ızgarası (Lattice Bars)
  ctx.beginPath();
  ctx.moveTo(0, -7 * u);
  ctx.lineTo(0, 4 * u);
  ctx.moveTo(-9 * u, -1.5 * u);
  ctx.lineTo(9 * u, -1.5 * u);
  ctx.stroke();

  // Kandil alevi (Candle Flame)
  if (active) {
    ctx.fillStyle = UI_COLORS.white;
    ctx.beginPath();
    ctx.arc(0, -1.5 * u, 2.5 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Pagoda Çatısı (Tiered Roof Cap - Beveled)
  // Çatı alt yüzü
  ctx.fillStyle = UI_COLORS.crownStoneDark;
  ctx.beginPath();
  ctx.moveTo(-15 * u, -7 * u);
  ctx.lineTo(15 * u, -7 * u);
  ctx.lineTo(12 * u, -9 * u);
  ctx.lineTo(-12 * u, -9 * u);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Çatı ana kubbesi
  ctx.fillStyle = UI_COLORS.crownStone;
  ctx.beginPath();
  ctx.moveTo(-14 * u, -9 * u);
  ctx.lineTo(0, -16 * u);
  ctx.lineTo(14 * u, -9 * u);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Çatı üstü süs topu (Hoju Finial)
  ctx.fillStyle = UI_COLORS.crownGold;
  ctx.beginPath();
  ctx.arc(0, -17.5 * u, 2.2 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}
