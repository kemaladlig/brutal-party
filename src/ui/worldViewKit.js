// World-view kromu: tüm client world renderer'ların paylaştığı overlay katmanı
// (raunt/maç bandı, placeholder, stale) ve arena hizalama yardımcısı.
// Sadece i18n + çizim import eder; oyun simülasyonu/AI import etmez.

import { t } from '../i18n.js';
import { UI_COLORS, uiFont, getDisplayProfile } from './tokens.js';
import { drawResultPanel, uiTextScale } from './resultPanel.js';

// World koordinatlarını client canvas'a orantılı sığdırır ve draw'u dünya uzayında
// çağırır. arena: [left, top, right, bottom].
/**
 * World→ekran dönüşümünün TEK çözümü. `fitWorld` ve `worldScreenBox` aynı
 * matematiği iki yerde tekrar yazarsa arka plan ile saha kayar.
 */
export function worldFit(width, height, arena) {
  const [left, top, right, bottom] = arena;
  const worldWidth = Math.max(1, right - left);
  const worldHeight = Math.max(1, bottom - top);
  const scale = Math.min(width / worldWidth, height / worldHeight);
  return {
    scale,
    left,
    top,
    worldWidth,
    worldHeight,
    offsetX: (width - worldWidth * scale) / 2,
    offsetY: (height - worldHeight * scale) / 2,
  };
}

export function fitWorld(ctx, width, height, arena, draw) {
  const f = worldFit(width, height, arena);
  ctx.save();
  ctx.translate(f.offsetX, f.offsetY);
  ctx.scale(f.scale, f.scale);
  ctx.translate(-f.left, -f.top);
  draw();
  ctx.restore();
}

/**
 * Arenanın EKRAN uzayındaki kutusu. Sahanın dışını boyayan `paintBackdrop`
 * ekran uzayında çizilir (fitWorld'ün DIŞINDA), ama arenanın nereye oturduğunu
 * bilmesi gerekir — dünya koordinatlarıyla çağrılırsa gölge sahadan kayar.
 */
export function worldScreenBox(width, height, arena) {
  const f = worldFit(width, height, arena);
  return {
    left: f.offsetX,
    top: f.offsetY,
    width: f.worldWidth * f.scale,
    height: f.worldHeight * f.scale,
  };
}

function pathRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

export function drawWorldBanner(ctx, width, height, title, subtitle = '') {
  // Host'taki tur/final bandıyla aynı panel: kumanda başka dil konuşmaz.
  const ts = uiTextScale(getDisplayProfile(width, height).baseUnit);
  const boxW = Math.min(width - 32, Math.round(420 * ts));
  const boxH = Math.round((subtitle ? 88 : 64) * ts);
  const box = { x: (width - boxW) / 2, y: (height - boxH) / 2, w: boxW, h: boxH };

  ctx.save();
  drawResultPanel(ctx, box, ts);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_COLORS.resultGold;
  ctx.font = uiFont('button', ts);
  ctx.fillText(title, width / 2, subtitle ? box.y + boxH * 0.38 : box.y + boxH / 2, boxW - Math.round(28 * ts));
  if (subtitle) {
    ctx.fillStyle = UI_COLORS.resultMuted;
    ctx.font = uiFont('monoBody', ts);
    ctx.fillText(subtitle, width / 2, box.y + boxH * 0.7, boxW - Math.round(28 * ts));
  }
  ctx.restore();
}

export function renderWorldPlaceholder(ctx, width, height, fill = '#14101F') {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = fill === '#14101F' ? '#F6F1E8' : '#1A1A1A';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 18px "Space Grotesk", sans-serif';
  ctx.fillText(t('pad.waiting'), width / 2, height / 2);
  ctx.restore();
}

export function renderWorldConnecting(ctx, width, height, fill = '#14101F') {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = fill === '#14101F' ? '#F6F1E8' : '#1A1A1A';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 18px "Space Grotesk", sans-serif';
  ctx.fillText(t('net.worldConnecting'), width / 2, height / 2 - 10);
  ctx.fillStyle = fill === '#14101F' ? '#B3A9C6' : '#575750';
  ctx.font = '800 12px "JetBrains Mono", monospace';
  ctx.fillText(t('net.worldConnectingHint'), width / 2, height / 2 + 16);
  ctx.restore();
}

export function renderWorldStale(ctx, width, height) {
  const boxW = Math.min(width - 32, 440);
  const boxH = 56;
  const x = (width - boxW) / 2;
  const y = (height - boxH) / 2;
  const r = 14;

  ctx.save();
  ctx.fillStyle = 'rgba(10, 8, 24, 0.45)';
  pathRoundRect(ctx, x, y + 3, boxW, boxH, r);
  ctx.fill();

  ctx.fillStyle = 'rgba(26, 20, 42, 0.88)';
  pathRoundRect(ctx, x, y, boxW, boxH, r);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  pathRoundRect(ctx, x, y, boxW, boxH, r);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 15px "JetBrains Mono", monospace';
  ctx.fillText(t('net.hostGoneRetry'), width / 2, height / 2);
  ctx.restore();
}
