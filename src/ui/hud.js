// Oyun-içi HUD helper'ları — tüm motorlarda aynı üst hap, köşe skoru,
// raund bandı ve final kutusu. Davranış (sayaç, skor, state) motora aittir;
// burası sadece çizer. Ölçü/stil kararları src/ui/tokens.js'tedir.

import { UI_COLORS, UI_SIZES, uiFont } from './tokens.js';

// Standart üst hap: sabit 128x34, arena üstünde ortalı (top+12).
// text: '💣 4.2s' gibi kısa durum metni, urgent: kırmızı zemin.
export function renderTopPill(ctx, { arena, text, urgent = false }) {
  const pillW = 128;
  const pillH = UI_SIZES.pillH;
  const pillX = arena.cx - pillW / 2;
  const pillY = arena.top + 12;

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(pillX + 3, pillY + 3, pillW, pillH);
  ctx.fillStyle = urgent ? UI_COLORS.danger : UI_COLORS.line;
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(pillX, pillY, pillW, pillH);
  ctx.fillStyle = UI_COLORS.white;
  ctx.font = uiFont('pill');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, arena.cx, pillY + pillH / 2, pillW - 16);
  ctx.restore();
}

// Standart köşe skorları: 4 köşede renkli 'N★' (alpha 0.85).
// entries: 4 elemanlı dizi; null/undefined olan köşe atlanır.
export function renderCornerScores(ctx, { arena, entries }) {
  const { left, right, top, bottom, width, height } = arena;
  const scoreSize = Math.max(32, Math.min(52, Math.floor(Math.min(width, height) * 0.08)));
  const spots = [
    { x: left + width * 0.11, y: bottom - height * 0.11 },
    { x: left + width * 0.11, y: top + height * 0.11 },
    { x: right - width * 0.11, y: top + height * 0.11 },
    { x: right - width * 0.11, y: bottom - height * 0.11 },
  ];

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${scoreSize}px "Space Grotesk", sans-serif`;
  entries.forEach((entry, i) => {
    if (!entry) return;
    ctx.fillStyle = entry.color;
    ctx.globalAlpha = 0.85;
    ctx.fillText(entry.text, spots[i].x, spots[i].y);
  });
  ctx.restore();
}

// Standart raund bandı: min(300)x80 kutu, başlık + alt bilgi.
// sub yoksa başlık ortalanır.
export function renderRoundBanner(ctx, { arena, title, titleColor, sub = '' }) {
  const boxW = Math.min(300, arena.size * 0.85);
  const boxH = 80;
  const boxX = arena.cx - boxW / 2;
  const boxY = arena.cy - boxH / 2;

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(boxX + 5, boxY + 5, boxW, boxH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = titleColor;
  ctx.font = uiFont('button');
  ctx.fillText(title, arena.cx, sub ? boxY + 30 : boxY + boxH / 2, boxW - 20);
  if (sub) {
    ctx.fillStyle = UI_COLORS.muted;
    ctx.font = uiFont('monoBody');
    ctx.fillText(sub, arena.cx, boxY + 58, boxW - 20);
  }
  ctx.restore();
}

// Standart final kutusu: min(320)x220, başlık + kazanan + skor listesi +
// çalışan 'YENİDEN OYNA' butonu (uiButtons'a basar).
// rows: [{ color, text }] — skor listesi satırları.
export function renderMatchOver(ctx, {
  arena, uiButtons, headline, winnerName = '', winnerColor = UI_COLORS.ink, rows = [], onRestart,
}) {
  const boxW = Math.min(320, Math.min(arena.width, arena.height) * 0.85);
  const boxH = 220;
  const boxX = arena.cx - boxW / 2;
  const boxY = arena.cy - boxH / 2;

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(boxX + 6, boxY + 6, boxW, boxH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = 4;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_COLORS.ink;
  ctx.font = uiFont('body');
  ctx.fillText(headline, arena.cx, boxY + 32);

  ctx.fillStyle = winnerName ? winnerColor : UI_COLORS.ink;
  ctx.font = uiFont('title');
  ctx.fillText(winnerName ? `${winnerName} KAZANDI!` : 'BERABERE!', arena.cx, boxY + 68, boxW - 20);

  ctx.font = uiFont('monoBody');
  rows.forEach((row, i) => {
    ctx.fillStyle = row.color;
    ctx.fillText(row.text, arena.cx, boxY + 96 + i * 18, boxW - 20);
  });

  const btnW = UI_SIZES.finalBtnW;
  const btnH = UI_SIZES.finalBtnH;
  const btnX = arena.cx - btnW / 2;
  const btnY = boxY + 154;
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(btnX, btnY, btnW, btnH);
  ctx.fillStyle = UI_COLORS.white;
  ctx.font = uiFont('buttonSmall');
  ctx.fillText('YENİDEN OYNA', arena.cx, btnY + btnH / 2);
  ctx.restore();

  uiButtons.push({ x: btnX, y: btnY, w: btnW, h: btnH, onClick: onRestart });
}
