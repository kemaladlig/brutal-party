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
 * @param {boolean} [opts.transient] true ise hazır (ready) durumunda çizilmez, aksiyon alanını temiz tutar
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
  transient = false,
}) {
  const s = Math.max(0.75, Math.min(1.5, scale));
  const resolved = state
    ?? (Number.isFinite(progress)
      ? (progress >= 0.999 ? STATUS_STATE.READY : STATUS_STATE.CHARGING)
      : STATUS_STATE.READY);

  // Transient kontrolü: Hazır durumda başüstünü temiz tut
  if (transient && resolved === STATUS_STATE.READY) {
    return null;
  }

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

/**
 * Varlık etrafında kompakt radyal durum yayı çizer (fitil, gerilim, şarj vb.).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 * @param {number} opts.x               karakter merkez X
 * @param {number} opts.y               karakter merkez Y
 * @param {number} [opts.radius]        karakter yarıçapı
 * @param {number} [opts.progress]      0..1 dolum/kalan oranı
 * @param {string} [opts.color]         dolum rengi (varsayılan hudReady)
 * @param {string} [opts.trackColor]    arkaplan iz rengi (varsayılan hudPlate)
 * @param {number} [opts.lineWidth]     çizgi kalınlığı px
 * @param {number} [opts.startAngle]    başlangıç açısı radyan (-Math.PI/2 = tepe)
 * @param {number} [opts.gapAngle]      tam daireden eksik bırakılan nefes açısı (0..PI)
 * @param {number} [opts.alpha]         opaklık 0..1
 */
export function drawRadialArc(ctx, {
  x,
  y,
  radius = 16,
  progress = 0,
  color = UI_COLORS.hudReady,
  trackColor = UI_COLORS.hudPlate,
  lineWidth = 3,
  startAngle = -Math.PI / 2,
  gapAngle = 0,
  alpha = 1,
}) {
  const prog = Math.max(0, Math.min(1, Number(progress) || 0));
  if (prog <= 0 && alpha <= 0) return;

  const arcRadius = radius + Math.max(2, lineWidth);
  const totalSweep = Math.PI * 2 - gapAngle;
  const sweep = totalSweep * prog;

  ctx.save();
  if (alpha < 1) ctx.globalAlpha = Math.max(0, alpha);

  // Arkaplan izi
  if (trackColor) {
    ctx.beginPath();
    ctx.arc(x, y, arcRadius, startAngle, startAngle + totalSweep);
    ctx.strokeStyle = trackColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // İlerleme yayı
  if (prog > 0) {
    ctx.beginPath();
    ctx.arc(x, y, arcRadius, startAngle, startAngle + sweep);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Kompakt başüstü veya gövde-çevresi can ve cephane göstergesi.
 * 120px devasa stack yerine gövde yarıçapını aşmayan modern diegetic dil.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} opts
 * @param {number} opts.x               karakter merkez X
 * @param {number} opts.y               karakter merkez Y
 * @param {number} [opts.radius]        karakter yarıçapı
 * @param {number} [opts.hp]            kalan can
 * @param {number} [opts.maxHp]         maksimum can
 * @param {number} [opts.ammo]          kalan mermi (-1 veya null = mermisiz)
 * @param {number} [opts.maxAmmo]       şarjör kapasitesi
 * @param {boolean} [opts.reloading]    dolduruluyor mu?
 * @param {number} [opts.reloadProgress] 0..1 doldurma ilerlemesi
 * @param {string} [opts.color]         oyuncu/varlık rengi
 * @param {FieldGeometry} [opts.arena]  kenara taşma koruması
 * @param {number} [opts.scale]         ölçek
 * @param {boolean} [opts.transient]    true ise tam can & tam cephane durumunda gizlenir
 * @param {number} [opts.alpha]         0..1 opaklık
 * @returns {null|{x:number,y:number,w:number,h:number}}
 */
export function drawCompactVitals(ctx, {
  x,
  y,
  radius = 16,
  hp = null,
  maxHp = null,
  ammo = null,
  maxAmmo = null,
  reloading = false,
  reloadProgress = 0,
  color = UI_COLORS.ink,
  arena = null,
  scale = 1,
  transient = false,
  alpha = 1,
}) {
  const hasHp = Number.isFinite(hp) && Number.isFinite(maxHp) && (maxHp ?? 0) > 0;
  const hasAmmo = Number.isFinite(ammo) && Number.isFinite(maxAmmo) && (maxAmmo ?? 0) > 0;

  // Transient kontrolü: Can tam ve cephane tam ve doldurulmuyor ise başüstünü temiz tut
  if (transient) {
    const hpFull = !hasHp || (hp ?? 0) >= (maxHp ?? 1);
    const ammoFull = !hasAmmo || ((ammo ?? 0) >= (maxAmmo ?? 1) && !reloading && reloadProgress <= 0);
    if (hpFull && ammoFull) return null;
  }

  if (!hasHp && !hasAmmo) return null;

  const s = Math.max(0.75, Math.min(1.4, scale));
  const pipH = Math.max(4, Math.round(5 * s));
  const pipGap = Math.max(2, Math.round(2.5 * s));
  const ammoBarH = hasAmmo ? Math.max(5, Math.round(6 * s)) : 0;
  const totalH = (hasHp ? pipH : 0) + (hasAmmo ? ammoBarH + pipGap : 0);

  // Kenar / Tavan kontrolü: Tavana yakınsa gövde altına çevir (edge flip)
  const isTopClamped = arena && (y - radius - totalH - 8 * s < (arena.top || 0) + 4);
  let curY = isTopClamped
    ? Math.round(y + radius + 7 * s)
    : Math.round(y - radius - 6 * s - totalH);

  let anchorX = Math.round(x);
  if (arena) {
    const minX = (arena.left || 0) + Math.round(24 * s);
    const maxX = (arena.right || 800) - Math.round(24 * s);
    anchorX = Math.max(minX, Math.min(maxX, anchorX));
  }

  ctx.save();
  if (alpha < 1) ctx.globalAlpha = Math.max(0, alpha);

  // 1. Can (HP Micro-Pips): Gövde genişliğini aşmayan sıkı mikro-bloklar
  if (hasHp && maxHp !== null && hp !== null) {
    const pipCount = Math.min(12, maxHp);
    const maxBarW = Math.max(24 * s, radius * 1.6);
    const pipW = Math.max(4, Math.round((maxBarW - (pipCount - 1) * pipGap) / pipCount));
    const totalW = pipCount * pipW + (pipCount - 1) * pipGap;
    const startX = Math.round(anchorX - totalW / 2);

    // Koyu arkalık plaka
    ctx.fillStyle = UI_COLORS.hudPlate;
    ctx.fillRect(startX - 2, curY - 1, totalW + 4, pipH + 2);

    for (let i = 0; i < pipCount; i++) {
      const px = startX + i * (pipW + pipGap);
      const isFilled = i < hp;
      ctx.fillStyle = isFilled ? color : UI_COLORS.hudEmpty;
      ctx.fillRect(px, curY, pipW, pipH);
      ctx.strokeStyle = UI_COLORS.hudInkOutline;
      ctx.lineWidth = 1;
      ctx.strokeRect(px, curY, pipW, pipH);
    }
    curY += pipH + pipGap + 1;
  }

  // 2. Cephane (Kompakt Segment Rayı veya Dolum Animasyonu)
  if (hasAmmo && maxAmmo !== null && ammo !== null) {
    const ammoW = Math.max(26 * s, radius * 1.6);
    const startX = Math.round(anchorX - ammoW / 2);

    ctx.fillStyle = UI_COLORS.hudPlate;
    ctx.fillRect(startX - 2, curY - 1, ammoW + 4, ammoBarH + 2);

    if (reloading) {
      // Doldurma sırasında canlı altın ilerleme rayı
      const prog = Math.max(0, Math.min(1, reloadProgress));
      ctx.fillStyle = UI_COLORS.hudDim;
      ctx.fillRect(startX, curY, ammoW, ammoBarH);
      ctx.fillStyle = UI_COLORS.gold;
      ctx.fillRect(startX, curY, Math.round(ammoW * prog), ammoBarH);
      ctx.strokeStyle = UI_COLORS.hudInkOutline;
      ctx.lineWidth = 1;
      ctx.strokeRect(startX, curY, ammoW, ammoBarH);
    } else {
      // Kalan mermi pips
      const segCount = Math.min(10, maxAmmo);
      const segGap = Math.max(1, Math.round(1.5 * s));
      const segW = Math.max(2, Math.round((ammoW - (segCount - 1) * segGap) / segCount));
      const ratio = ammo / maxAmmo;
      const isLow = ratio <= 0.25;

      for (let j = 0; j < segCount; j++) {
        const sx = startX + j * (segW + segGap);
        const filled = (j / segCount) < ratio;
        ctx.fillStyle = filled ? (isLow ? UI_COLORS.danger : UI_COLORS.hudReady) : UI_COLORS.hudEmpty;
        ctx.fillRect(sx, curY, segW, ammoBarH);
      }
    }
  }

  ctx.restore();
  return { x: anchorX, y: curY, w: radius * 2, h: totalH };
}
