// Oyun-içi HUD helper'ları — tüm motorlarda aynı üst hap, köşe skoru,
// raund bandı ve final kutusu. Davranış (sayaç, skor, state) motora aittir;
// burası sadece çizer. Ölçü/stil kararları src/ui/tokens.js'tedir.

import { UI_COLORS, UI_SIZES, UI_FONTS, uiFont, getUiScale } from './tokens.js';

// Standart üst hap: arena üstünde ortalı.
// Ekran boyutuna (TV / monitör vs telefon) göre orantılı büyür, metin uzunluğuna göre genişler.
// text: '💣 4.2s' gibi durum metni, urgent: kırmızı zemin.
// alpha: oyun alanı çakışmasında hapı soldurmak için.
export function renderTopPill(ctx, { arena, text, urgent = false, alpha = 1, customW = null }) {
  const scale = getUiScale(arena);
  const fontSize = Math.round(15 * scale);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${fontSize}px ${UI_FONTS.mono}`;
  const measured = ctx.measureText(text).width;

  const minW = Math.round(136 * scale);
  const pillW = customW ? Math.round(customW * scale) : Math.max(minW, Math.round(measured + 28 * scale));
  const pillH = Math.round(UI_SIZES.pillH * scale);
  const pillX = arena.cx - pillW / 2;
  const pillY = arena.top + Math.round(10 * scale);
  const shadow = Math.max(2, Math.round(3 * Math.min(1.6, scale)));

  // Sert Neo-brutalist gölge
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(pillX + shadow, pillY + shadow, pillW, pillH);

  // Gövde
  ctx.fillStyle = urgent ? UI_COLORS.danger : UI_COLORS.line;
  ctx.fillRect(pillX, pillY, pillW, pillH);

  // Kenar
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(2.5, Math.round(2.5 * Math.min(1.5, scale)));
  ctx.strokeRect(pillX, pillY, pillW, pillH);

  // Metin
  ctx.fillStyle = UI_COLORS.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, arena.cx, pillY + pillH / 2);
  ctx.restore();
}

// Saha ortası büyük filigran sayaç / zamanlayıcı / durum metni.
// TV ve büyük monitörlerde koltuktan rahatça görülecek kadar büyüktür,
// ancak yarı-saydam (alpha) ve saha zemininde çizildiği için oyuncuları ve oyunu asla engellemez.
export function renderArenaWatermarkTimer(ctx, {
  arena,
  text,
  subText = '',
  urgent = false,
  color = null,
  alpha = 0.16,
  ringProgress = null,
  offsetY = 0,
}) {
  if (!text) return;
  const scale = getUiScale(arena);
  const minDim = Math.min(arena.width, arena.height);

  // Büyük ekranda (TV/monitör) 72px - 140px, telefonda 38px - 54px
  const mainFontSize = Math.max(38, Math.min(Math.round(120 * (scale / 1.55)), Math.floor(minDim * 0.18)));
  const subFontSize = Math.max(11, Math.min(Math.round(16 * scale), Math.floor(minDim * 0.032)));

  const cx = arena.cx;
  const cy = arena.cy + offsetY;

  ctx.save();

  // Acil durumda (panik) hafif nabız atan opaklık ve kırmızı/altın ton
  let effAlpha = alpha;
  if (urgent) {
    const pulse = (Math.sin(performance.now() * 0.01) + 1) * 0.5;
    effAlpha = Math.min(0.32, alpha + 0.10 + pulse * 0.08);
  }
  ctx.globalAlpha = effAlpha;

  // İlerleme halkası (opsiyonel)
  if (typeof ringProgress === 'number' && ringProgress >= 0) {
    const ringR = Math.max(minDim * 0.14, mainFontSize * 0.85);
    ctx.strokeStyle = color || (urgent ? UI_COLORS.danger : UI_COLORS.ink);
    ctx.lineWidth = Math.max(4, Math.round(6 * scale));
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + Math.min(1.0, ringProgress) * Math.PI * 2);
    ctx.stroke();
  }

  // Ana metin (sayaç sayısı veya durum)
  ctx.fillStyle = color || (urgent ? UI_COLORS.danger : UI_COLORS.ink);
  ctx.font = `900 ${mainFontSize}px ${UI_FONTS.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textY = subText ? cy - subFontSize * 0.7 : cy;
  ctx.fillText(text, cx, textY);

  // Alt bilgi etiketi
  if (subText) {
    ctx.font = `800 ${subFontSize}px ${UI_FONTS.mono}`;
    ctx.letterSpacing = `${Math.round(1.5 * scale)}px`;
    ctx.fillText(subText, cx, textY + mainFontSize * 0.56 + subFontSize * 0.5);
  }

  ctx.restore();
}

// Standart köşe skorları: 4 köşede renkli 'N★'.
// Büyük ekranda (TV) uzak mesafeden okunması için boyutu orantılı büyütülür ve hafif gölge eklenir.
export function renderCornerScores(ctx, { arena, entries }) {
  const { left, right, top, bottom, width, height } = arena;
  const scale = getUiScale(arena);
  const minDim = Math.min(width, height);
  // Büyük ekranda 64-88px'e kadar genişler
  const scoreSize = Math.max(34, Math.min(Math.round(84 * (scale / 1.55)), Math.floor(minDim * 0.088)));
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
    // TV/Monitörde yüksek kontrast için ince taban gölgesi
    if (scale > 1.2) {
      ctx.fillStyle = 'rgba(26, 26, 26, 0.22)';
      ctx.fillText(entry.text, spots[i].x + 2, spots[i].y + 2);
    }
    ctx.fillStyle = entry.color;
    ctx.globalAlpha = 0.90;
    ctx.fillText(entry.text, spots[i].x, spots[i].y);
  });
  ctx.restore();
}

// Standart raund bandı: başlık + alt bilgi.
// TV ve büyük monitörlerde orantılı genişler.
export function renderRoundBanner(ctx, { arena, title, titleColor, sub = '' }) {
  const scale = getUiScale(arena);
  const boxW = Math.min(Math.round(440 * scale), arena.width * 0.88);
  const boxH = Math.round(80 * Math.min(1.4, scale));
  const boxX = arena.cx - boxW / 2;
  const boxY = arena.cy - boxH / 2;
  const shadow = Math.max(3, Math.round(5 * Math.min(1.4, scale)));

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(boxX + shadow, boxY + shadow, boxW, boxH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(3, Math.round(3.5 * Math.min(1.3, scale)));
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = titleColor;
  ctx.font = uiFont('button', Math.min(1.35, scale));
  ctx.fillText(title, arena.cx, sub ? boxY + boxH * 0.38 : boxY + boxH / 2, boxW - 24);

  if (sub) {
    ctx.fillStyle = UI_COLORS.muted;
    ctx.font = uiFont('monoBody', Math.min(1.3, scale));
    ctx.fillText(sub, arena.cx, boxY + boxH * 0.72, boxW - 24);
  }
  ctx.restore();
}

// Standart final kutusu: başlık + kazanan + skor listesi + çalışan 'YENİDEN OYNA' butonu.
export function renderMatchOver(ctx, {
  arena, uiButtons, headline, winnerName = '', winnerColor = UI_COLORS.ink, rows = [], onRestart,
}) {
  const scale = getUiScale(arena);
  const boxW = Math.min(Math.round(460 * scale), Math.min(arena.width, arena.height) * 0.90);
  const boxH = Math.round(230 * Math.min(1.35, scale));
  const boxX = arena.cx - boxW / 2;
  const boxY = arena.cy - boxH / 2;
  const shadow = Math.max(4, Math.round(6 * Math.min(1.4, scale)));

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(boxX + shadow, boxY + shadow, boxW, boxH);
  ctx.fillStyle = UI_COLORS.card;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = UI_COLORS.ink;
  ctx.lineWidth = Math.max(3.5, Math.round(4 * Math.min(1.3, scale)));
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_COLORS.ink;
  ctx.font = uiFont('body', Math.min(1.3, scale));
  ctx.fillText(headline, arena.cx, boxY + Math.round(30 * scale));

  ctx.fillStyle = winnerName ? winnerColor : UI_COLORS.ink;
  ctx.font = uiFont('title', Math.min(1.3, scale));
  ctx.fillText(winnerName ? `${winnerName} KAZANDI!` : 'BERABERE!', arena.cx, boxY + Math.round(68 * scale), boxW - 24);

  ctx.font = uiFont('monoBody', Math.min(1.2, scale));
  const rowStep = Math.round(18 * Math.min(1.3, scale));
  rows.forEach((row, i) => {
    ctx.fillStyle = row.color;
    ctx.fillText(row.text, arena.cx, boxY + Math.round(96 * scale) + i * rowStep, boxW - 24);
  });

  const btnW = Math.round(UI_SIZES.finalBtnW * Math.min(1.35, scale));
  const btnH = Math.round(UI_SIZES.finalBtnH * Math.min(1.3, scale));
  const btnX = arena.cx - btnW / 2;
  const btnY = boxY + boxH - btnH - Math.round(18 * scale);

  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(btnX, btnY, btnW, btnH);
  ctx.fillStyle = UI_COLORS.white;
  ctx.font = uiFont('buttonSmall', Math.min(1.3, scale));
  ctx.fillText('YENİDEN OYNA', arena.cx, btnY + btnH / 2);
  ctx.restore();

  uiButtons.push({ x: btnX, y: btnY, w: btnW, h: btnH, onClick: onRestart });
}
