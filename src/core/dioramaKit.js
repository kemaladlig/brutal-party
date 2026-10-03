// Paylaşılan Tabletop Diorama Görsel Kiti — 12 oyun modunun tamamında
// fiziksel konsol / masaüstü diorama kalitesini sağlayan modüler görsel yapıtaşları.
// Kural: Kopya-yapıştır yok; yönlü gölgeler, 3B küreler, kesme taşlar, jetonlar
// ve tehlike şeritleri buradan tüketilir. Sıfır GC ayrımı (döngüde gradyan/nesne yok).

import { UI_COLORS } from '../ui/tokens.js';
import { drawTabletopIcon } from './tabletopIcons.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

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
