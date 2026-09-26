// World-view kromu: tüm client world renderer'ların paylaştığı overlay katmanı
// (raunt/maç bandı, placeholder, stale) ve arena hizalama yardımcısı.
// Sadece i18n + çizim import eder; oyun simülasyonu/AI import etmez.

import { t } from '../i18n.js';

// World koordinatlarını client canvas'a orantılı sığdırır ve draw'u dünya uzayında
// çağırır. arena: [left, top, right, bottom].
export function fitWorld(ctx, width, height, arena, draw) {
  const [left, top, right, bottom] = arena;
  const worldWidth = Math.max(1, right - left);
  const worldHeight = Math.max(1, bottom - top);
  const scale = Math.min(width / worldWidth, height / worldHeight);
  const offsetX = (width - worldWidth * scale) / 2;
  const offsetY = (height - worldHeight * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-left, -top);
  draw();
  ctx.restore();
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
  const boxWidth = Math.min(width - 32, 420);
  const boxHeight = subtitle ? 92 : 64;
  const x = (width - boxWidth) / 2;
  const y = (height - boxHeight) / 2;
  const boxR = 16;

  ctx.save();
  ctx.fillStyle = 'rgba(10, 8, 24, 0.42)';
  pathRoundRect(ctx, x, y + 4, boxWidth, boxHeight, boxR);
  ctx.fill();

  ctx.fillStyle = '#D84727';
  pathRoundRect(ctx, x, y, boxWidth, boxHeight, boxR);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 2.5;
  pathRoundRect(ctx, x, y, boxWidth, boxHeight, boxR);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 24px "Space Grotesk", sans-serif';
  ctx.fillText(title, width / 2, y + (subtitle ? 30 : boxHeight / 2));
  if (subtitle) {
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.fillText(subtitle, width / 2, y + 64);
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
