// Sonuç yüzeyinin panel primitifleri: host canvas'ı (`hud.js`) ve kumanda
// world-view'ı (`worldViewKit.js`) aynı dili konuşsun. İkisi ayrı panel yazarsa
// telefonla TV farklı oyun gibi görünür — kullanıcı şikâyetinin kökü buydu.
//
// Ağır bağımlılık YOK (yalnız token): kumanda paketi bu dosya için `hud.js`'i
// ve avatar zincirini çekmek zorunda kalmaz.
//
// Dil: koyu panel + radius + yumuşak katmanlı gölge + tek ince kenar. Eski
// krem kart + 3px mürekkep çerçeve + ofsetli sert gölge, sahanın kreminde
// kayboluyor ve uygulamanın güncel koyu yüzeyinden kopuyordu.

import { UI_COLORS, UI_SIZES } from './tokens.js';

// `--result-bg` gradyanının canvas karşılığı. Kare başına tahsis yerine kutu
// geometrisiyle önbelleğe alınır (yalnız resize'da yeniden üretilir).
let panelFillCache = null;

function panelFill(ctx, box) {
  const key = `${Math.round(box.y)}:${Math.round(box.h)}`;
  if (!panelFillCache || panelFillCache.key !== key) {
    const grad = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    grad.addColorStop(0, UI_COLORS.resultPanelTop);
    grad.addColorStop(1, UI_COLORS.resultPanelBottom);
    panelFillCache = { key, grad };
  }
  return panelFillCache.grad;
}

export function resultPanelRadius(box) {
  return Math.round(Math.min(UI_SIZES.finalRadiusMax, box.w * 0.055));
}

// Yumuşak gölge: iç içe saydam yuvarlak katmanlar. `shadowBlur` kare başına
// pahalı; tek `rgba` ofset kutu ise eski "sert kutu gölgesi"ne düşüyor.
export function drawResultPanel(ctx, box, scale, radius = null) {
  const r = Number.isFinite(radius) ? radius : resultPanelRadius(box);
  const layers = [
    [Math.round(11 * scale), 0.07],
    [Math.round(6 * scale), 0.11],
    [Math.round(2 * scale), 0.15],
  ];
  ctx.save();
  for (const [spread, alpha] of layers) {
    ctx.fillStyle = `rgba(${UI_COLORS.resultShadowRgb}, ${alpha})`;
    roundRect(ctx, box.x - spread, box.y - spread + Math.round(4 * scale), box.w + spread * 2, box.h + spread * 2, r + spread);
    ctx.fill();
  }

  ctx.fillStyle = panelFill(ctx, box);
  roundRect(ctx, box.x, box.y, box.w, box.h, r);
  ctx.fill();

  // Tek ince kenar: tel kafes değil, panelin ışığı.
  ctx.strokeStyle = UI_COLORS.resultEdge;
  ctx.lineWidth = 1.5;
  roundRect(ctx, box.x, box.y, box.w, box.h, r);
  ctx.stroke();
  ctx.restore();
}

// Panelin arkasını kısık tutar. `viewport` verilirse ekranın tamamı, yoksa
// verilen kutu karartılır — sahanın dışının sahibi `fieldKit.paintBackdrop`tır.
export function dimBehindPanel(ctx, box) {
  if (!box || box.width <= 0 || box.height <= 0) return;
  ctx.save();
  ctx.fillStyle = UI_COLORS.scrim;
  ctx.fillRect(box.left ?? box.x ?? 0, box.top ?? box.y ?? 0, box.width, box.height);
  ctx.restore();
}

// Yazı tabanı: `UI_TEXT` kademeleri telefon referansıyla (ölçek 1) tune edildi,
// profil ölçeği MOBILE'da 0.72'ye kadar düşürüyor. Saha varlığı için doğru olan
// bu, arayüz yazısını okunmaz hâle getiriyordu. Arayüz yazısı yalnız büyür.
export function uiTextScale(scale, max = 1.7) {
  return Math.max(1, Math.min(max, scale));
}

export function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}
