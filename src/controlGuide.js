import { UI_COLORS, UI_SIZES, uiFont } from './ui/tokens.js';

const GUIDE_COLORS = UI_COLORS.players;

export function renderControlGuide(ctx, arena, title, entries) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isPortrait = arena.height > arena.width;
  const panelHeight = isPortrait ? Math.max(54, arena.top - 8) : Math.max(28, Math.min(38, arena.top - 6));
  const panelY = 6;
  const panelWidth = Math.min(arena.width, viewportWidth - 24);
  const panelX = (viewportWidth - panelWidth) / 2;
  const text = entries.join('   •   ');

  if (panelHeight <= 14) return;

  ctx.save();
  ctx.fillStyle = 'rgba(26, 26, 24, 0.95)';
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.strokeStyle = UI_COLORS.paperWarm;
  ctx.lineWidth = 3;
  ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxTextWidth = panelWidth - 24;
  const displayText = text.length > 70 ? `${text.slice(0, 67)}...` : text;

  if (isPortrait) {
    ctx.fillStyle = UI_COLORS.danger;
    ctx.font = uiFont('monoLabel');
    ctx.fillText(title, viewportWidth / 2, panelY + 16);
    ctx.font = uiFont('body');
    ctx.fillStyle = UI_COLORS.white;
    ctx.fillText(displayText, viewportWidth / 2, panelY + panelHeight - 16, maxTextWidth);
  } else {
    ctx.fillStyle = UI_COLORS.paperWarm;
    ctx.font = uiFont('monoLabel');
    ctx.fillText(`${title}  //  ${displayText}`, viewportWidth / 2, panelY + panelHeight / 2, maxTextWidth);
  }

  if (isPortrait && arena.bottom < viewportHeight - 12) {
    const footerY = arena.bottom + 6;
    const footerHeight = Math.max(44, viewportHeight - arena.bottom - 12);
    ctx.fillStyle = 'rgba(26, 26, 24, 0.95)';
    ctx.fillRect(panelX, footerY, panelWidth, footerHeight);
    ctx.strokeStyle = UI_COLORS.paperWarm;
    ctx.lineWidth = 3;
    ctx.strokeRect(panelX, footerY, panelWidth, footerHeight);
    ctx.fillStyle = UI_COLORS.danger;
    ctx.font = uiFont('section');
    ctx.fillText('OYUNCU BÖLGELERİ', viewportWidth / 2, footerY + 16);

    const swatchY = footerY + 30;
    const swatchStartX = viewportWidth / 2 - Math.min(entries.length, 4) * 44;
    entries.slice(0, 4).forEach((entry, index) => {
      const swatchX = swatchStartX + index * 88;
      ctx.fillStyle = GUIDE_COLORS[index];
      ctx.fillRect(swatchX, swatchY - 7, 14, 14);
      ctx.fillStyle = UI_COLORS.paperWarm;
      ctx.font = '900 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`P${index + 1}`, swatchX + 18, swatchY);
    });
  }

  ctx.restore();
}

export function renderPlayerLegend(ctx, arena, players, labels) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isPortrait = arena.height > arena.width;
  const y = isPortrait ? Math.max(arena.bottom + 12, viewportHeight - 32) : 22;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 13px "JetBrains Mono", monospace';
  const text = players
    .filter((player) => player.isJoined || player.isAlive || player.slotType !== 'empty')
    .map((player) => `${labels[player.index]} ${player.name || `P${player.index + 1}`}`)
    .join('   |   ');
  if (text) {
    ctx.fillStyle = 'rgba(26, 26, 24, 0.95)';
    const textWidth = ctx.measureText(text).width + 24;
    const boxX = (viewportWidth - textWidth) / 2;
    ctx.fillRect(boxX, y - 13, textWidth, 26);
    ctx.strokeStyle = UI_COLORS.paperWarm;
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, y - 13, textWidth, 26);
    ctx.fillStyle = UI_COLORS.white;
    ctx.fillText(text, viewportWidth / 2, y, Math.max(120, viewportWidth - 32));
  }
  ctx.restore();
}

export function getGuideColor(index) {
  return GUIDE_COLORS[index % GUIDE_COLORS.length];
}

/**
 * Standardized Neo-Brutalist Lobby Seat Card
 * Instantly distinguishes between:
 * 1. EMPTY  -> Soft warm background, dashed border, "+ KATIL"
 * 2. HUMAN  -> Color tint, 4px player-color border, "👤 NAME"
 * 3. BOT    -> Dark charcoal card, high-contrast, "🤖 BOT" yellow badge
 */
export function renderLobbySeatCard(ctx, {
  x,
  y,
  w,
  h,
  slotIndex,
  slotType = 'empty',
  playerName = '',
  playerColor = '#D84727',
  rotation = 0,
}) {
  const isHuman = slotType === 'human';
  const isBot = slotType === 'bot_normal' || slotType === 'bot_god';
  const isBotGod = slotType === 'bot_god';
  const isEmpty = !isHuman && !isBot;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rotation !== 0) {
    ctx.rotate(rotation);
  }

  const halfW = w / 2;
  const halfH = h / 2;

  if (isEmpty) {
    // 1. BOŞ KOLTUK
    ctx.fillStyle = UI_COLORS.card;
    ctx.fillRect(-halfW, -halfH, w, h);

    ctx.strokeStyle = UI_COLORS.faint;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(-halfW, -halfH, w, h);
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_COLORS.muted;
    ctx.font = uiFont('seatEmpty');
    ctx.fillText(`${slotIndex + 1}`, 0, -8);

    ctx.fillStyle = UI_COLORS.dim;
    ctx.font = uiFont('label');
    ctx.fillText('+ KATIL', 0, 14);

  } else if (isHuman) {
    // 2. OYUNCU (HUMAN)
    // Solid 4px Shadow
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillRect(-halfW + 4, -halfH + 4, w, h);

    // Card Face: Krem + %22 Oyuncu Rengi
    ctx.fillStyle = UI_COLORS.card;
    ctx.fillRect(-halfW, -halfH, w, h);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = playerColor;
    ctx.fillRect(-halfW, -halfH, w, h);
    ctx.globalAlpha = 1.0;

    // Bold Color Border
    ctx.strokeStyle = playerColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(-halfW, -halfH, w, h);

    // Slot Number
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = playerColor;
    ctx.font = uiFont('seatNum');
    const hasName = !!playerName;
    ctx.fillText(`${slotIndex + 1}`, 0, hasName ? -9 : 0);

    if (hasName) {
      // Player Name Pill
      ctx.fillStyle = UI_COLORS.ink;
      ctx.font = uiFont('nameTag');
      const displayName = playerName.length > 10 ? playerName.slice(0, 9) + '…' : playerName;
      ctx.fillText(`👤 ${displayName.toUpperCase()}`, 0, 14);
    }

  } else if (isBot) {
    // 3. BOT (KOYU ANTRASİT + SARI ROZET)
    // Solid Shadow
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillRect(-halfW + 4, -halfH + 4, w, h);

    // Dark Charcoal Face
    ctx.fillStyle = UI_COLORS.botFace;
    ctx.fillRect(-halfW, -halfH, w, h);

    // High Contrast Border
    ctx.strokeStyle = isBotGod ? UI_COLORS.botGod : UI_COLORS.botEdge;
    ctx.lineWidth = isBotGod ? 3.5 : 2.5;
    ctx.strokeRect(-halfW, -halfH, w, h);

    // Bot Number
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_COLORS.white;
    ctx.font = uiFont('seatNum');
    ctx.fillText(`${slotIndex + 1}`, 0, -9);

    // Bot Tag
    ctx.fillStyle = isBotGod ? UI_COLORS.botGod : UI_COLORS.botTag;
    ctx.font = uiFont('tag');
    ctx.fillText(isBotGod ? '⚡ GOD BOT' : '🤖 BOT', 0, 14);
  }

  ctx.restore();
}

// --- Standart Lobi Ölçüleri: tüm motorlarda aynı kare koltuk + aynı başlat butonu ---
// Konum oyuna göre değişebilir (örn. PONG kenar-orta kullanır) ama ölçü + stil sabittir.
export const LOBBY_SEAT_INSET = UI_SIZES.seatInset;

// Responsive kare koltuk kenarı: min(arena)*0.22, 96-148px bandında.
export function getStandardSeatSize(arena) {
  const base = Math.min(arena.width || 0, arena.height || 0);
  return Math.max(UI_SIZES.seatMin, Math.min(UI_SIZES.seatMax, Math.floor(base * UI_SIZES.seatRatio)));
}

// 4 köşe kare koltuk rect'i: [P1 sol-alt, P2 sol-üst, P3 sağ-üst, P4 sağ-alt]
export function getStandardSeatRects(arena, inset = LOBBY_SEAT_INSET) {
  const s = getStandardSeatSize(arena);
  return [
    { x: arena.left + inset, y: arena.bottom - s - inset, w: s, h: s },
    { x: arena.left + inset, y: arena.top + inset, w: s, h: s },
    { x: arena.right - s - inset, y: arena.top + inset, w: s, h: s },
    { x: arena.right - s - inset, y: arena.bottom - s - inset, w: s, h: s },
  ];
}

// Standart lobi başlat butonu: min(220)x60, şartlı yazı, hazırsa uiButtons'a basar.
// accent: oyunun kimlik rengi, textColor: accent üstü yazı rengi, centerYOffset: merkezden kayma.
// hidden: TV host modunda canvas butonu çizilmez — başlatma tek yoldan
// (DOM staging çubuğu) yapılır, sayaç/telefon bildirimi atlanamaz.
export function renderLobbyStartButton(ctx, {
  arena,
  uiButtons,
  joinedCount,
  accent = '#D84727',
  textColor = '#FFFFFF',
  onStart,
  centerYOffset = 0,
  hidden = false,
}) {
  if (hidden) return null;
  const btnW = Math.min(UI_SIZES.startW, arena.width * 0.45);
  const btnH = UI_SIZES.startH;
  const btnX = arena.cx - btnW / 2;
  const btnY = arena.cy - btnH / 2 + centerYOffset;
  const ready = joinedCount >= 2;

  ctx.save();
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(btnX + 5, btnY + 5, btnW, btnH);
  ctx.fillStyle = ready ? accent : UI_COLORS.disabled;
  ctx.fillRect(btnX, btnY, btnW, btnH);
  ctx.strokeStyle = UI_COLORS.line;
  ctx.lineWidth = 3;
  ctx.strokeRect(btnX, btnY, btnW, btnH);
  ctx.fillStyle = ready ? textColor : UI_COLORS.muted;
  ctx.font = ready ? uiFont('button') : uiFont('body');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ready ? '▶ MAÇI BAŞLAT' : '2 KİŞİ GEREKİYOR', arena.cx, btnY + btnH / 2);
  ctx.restore();

  if (ready) {
    uiButtons.push({ x: btnX, y: btnY, w: btnW, h: btnH, onClick: onStart });
  }
  return { x: btnX, y: btnY, w: btnW, h: btnH };
}

