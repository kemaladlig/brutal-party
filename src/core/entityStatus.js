/**
 * entityStatus.js — Karakter üstü "hazır / doluyor / blokeli" göstergesinin
 * TEK sahibi.
 *
 * Neden çember değil: saha zemini L* 92.5-97.5 krem (`fieldKit.FIELD_THEMES`).
 * Bu zeminde altın (1.18:1) ve turkuaz (1.26:1) ölü — oyun içi bir "mermi hazır"
 * sinyali olarak kullanılamaz. Aynı renkler koyu plaka üstünde 9.9-10.6:1.
 * `hordeView.js` bunu çok önce çözdü: yuvarlak cooldown halkasını kaldırıp
 * tepesine koyu zeminli bar koydu. Bu modül o dili 15 oyun için tek yerde
 * tanımlar.
 *
 * Sözleşme:
 *   READY    koyu plaka + `hudReady` kenarlığı ve ikonu — en belirgin hal
 *   CHARGING koyu plaka + alttan dolan `hudReady` barı + kalan saniye rakamı
 *   BLOCKED  koyu plaka + `danger` kenarlığı ve ikonu
 *
 * HAM OS emojisi kullanılmaz; ikon anahtarları `tabletopIcons`'tandır (§8).
 */

import { UI_COLORS, UI_FONTS } from '../ui/tokens.js';
import { drawTabletopIcon, hasTabletopIcon } from './tabletopIcons.js';

export const STATUS_STATE = Object.freeze({
  READY: 'ready',
  CHARGING: 'charging',
  BLOCKED: 'blocked',
});

/** Göstergenin dikey adımı (üst üste yığın için): verilen ölçekte px. */
export function statusChipStep(scale = 1) {
  return Math.max(14, Math.round(18 * scale));
}

/** Göstergenin taban genişliği — `index`/`count` ile yatay dizilim yapar. */
export function statusChipWidth(scale = 1, withText = false) {
  const base = Math.max(20, Math.round(22 * scale));
  return withText ? base + Math.round(20 * scale) : base;
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

/**
 * Durum rozetini karakterin üstüne çizer.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 * @param {number} opts.x            karakter merkez X
 * @param {number} opts.y            karakter merkez Y
 * @param {number} [opts.radius]     karakter yarıçapı (konum ve kenarlık için)
 * @param {FieldGeometry} [opts.arena]  kenara sıkışma düzeltmesi için
 * @param {number} [opts.scale]      saha ölçeği
 * @param {string} [opts.icon]       `tabletopIcons` anahtarı
 * @param {string} [opts.state]      STATUS_STATE değeri
 * @param {number} [opts.progress]   0..1 (1 = hazır); verilirse `state` türetilir
 * @param {number} [opts.remaining]  kalan saniye (CHARGING'de rakam olarak)
 * @param {number} [opts.anchorY]   verilirse yerleşim tamamen çağırana kalır:
 *   rozet `anchorY` ÜST KENARINA oturur, tavan çakışma düzeltmesi uygulanmaz.
 *   Çağıran kendi yığınını kuruyorsa (ör. `renderEntityHUD` yetenek + can +
 *   cephane) yön kararı zaten onundur.
 * @param {number} [opts.index]      yatay dizilim indeksi
 * @param {number} [opts.count]      yatay dizilim eleman sayısı
 * @returns {null|{x:number,y:number,w:number,h:number}} çizilen kutu ya da null
 */
export function drawStatusChip(ctx, {
  x,
  y,
  radius = 16,
  arena = null,
  scale = 1,
  icon = 'zap',
  state = null,
  progress = null,
  remaining = 0,
  anchorY = null,
  index = 0,
  count = 1,
}) {
  const s = Math.max(0.75, Math.min(1.5, scale));
  const resolved = state
    ?? (Number.isFinite(progress)
      ? (progress >= 0.999 ? STATUS_STATE.READY : STATUS_STATE.CHARGING)
      : STATUS_STATE.READY);

  const showText = resolved === STATUS_STATE.CHARGING && Number.isFinite(remaining) && remaining > 0;
  const chipW = statusChipWidth(s, showText);
  const chipH = Math.max(14, Math.round(18 * s));
  const gap = Math.max(3, Math.round(4 * s));

  // Yatay dizilim: bir karakterde birden fazla yetenek rozeti üst üste binmesin.
  const totalW = chipW * count + gap * (count - 1);
  const startX = x - totalW / 2;
  const boxX = Math.round(startX + index * (chipW + gap));

  // Dikey: `anchorY` verilmişse çağırının yığınına uy (üst kenar oraya oturur),
  // yoksa karakterin üstüne koy ve tavana yakınsa alta çevir (edge flip).
  let boxY;
  if (Number.isFinite(anchorY)) {
    boxY = Math.round(anchorY - chipH);
  } else {
    const above = y - radius - Math.round(6 * s);
    boxY = Math.round(above - chipH);
    if (arena && boxY < (arena.top || 0) + 4) {
      boxY = Math.round(y + radius + Math.round(6 * s));
    }
  }

  // Kenara sıkışma: rozet arena dışına taşmasın.
  let clampedX = boxX;
  if (arena) {
    const minX = (arena.left || 0) + 4;
    const maxX = (arena.right || 800) - 4 - chipW;
    clampedX = Math.max(minX, Math.min(maxX, clampedX));
  }
  const cx = clampedX + chipW / 2;
  const r = Math.max(3, Math.round(4 * s));

  ctx.save();
  roundRectPath(ctx, clampedX, boxY, chipW, chipH, r);

  // Gövde
  ctx.fillStyle = UI_COLORS.hudPlate;
  ctx.fill();

  // Dolum barı: yalnız CHARGING'de, alttan yukarı.
  if (resolved === STATUS_STATE.CHARGING) {
    const ratio = Math.max(0, Math.min(1, Number(progress) || 0));
    ctx.save();
    roundRectPath(ctx, clampedX, boxY, chipW, chipH, r);
    ctx.clip();
    ctx.fillStyle = UI_COLORS.hudReady;
    ctx.fillRect(clampedX, boxY + chipH - chipH * ratio, chipW, chipH * ratio);
    ctx.restore();
  }

  // Kenarlık: hazırken en belirgin, doluyorken geri çekilir.
  ctx.strokeStyle = resolved === STATUS_STATE.READY
    ? UI_COLORS.hudReady
    : (resolved === STATUS_STATE.BLOCKED ? UI_COLORS.danger : UI_COLORS.hudMuted);
  ctx.lineWidth = resolved === STATUS_STATE.READY
    ? Math.max(1.5, Math.round(2 * s))
    : Math.max(1, Math.round(1.25 * s));
  roundRectPath(ctx, clampedX, boxY, chipW, chipH, r);
  ctx.stroke();

  // İkon + (doluyorken) rakam
  const iconSize = Math.round(11 * s);
  const iconColor = resolved === STATUS_STATE.BLOCKED ? UI_COLORS.danger : UI_COLORS.hudReady;
  const hasIcon = hasTabletopIcon(icon);
  if (showText) {
    const text = `${Math.max(1, Math.round(remaining))}`;
    ctx.font = `900 ${Math.round(11 * s)}px ${UI_FONTS.mono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_COLORS.hudPlateInk;
    ctx.fillText(text, clampedX + chipW - Math.round(4 * s), boxY + chipH / 2);
    if (hasIcon) {
      drawTabletopIcon(ctx, icon, clampedX + Math.round(7 * s), boxY + chipH / 2, iconSize, {
        color: UI_COLORS.hudMuted,
      });
    }
  } else if (hasIcon) {
    drawTabletopIcon(ctx, icon, cx, boxY + chipH / 2, iconSize, { color: iconColor });
  } else {
    // Bilinmeyen anahtar: plaka yine de durumu taşır, boş kutu bırakma.
    ctx.fillStyle = iconColor;
    ctx.beginPath();
    ctx.arc(cx, boxY + chipH / 2, Math.max(2, iconSize * 0.32), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  return { x: clampedX, y: boxY, w: chipW, h: chipH };
}
