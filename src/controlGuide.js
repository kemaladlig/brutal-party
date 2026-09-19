const GUIDE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

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
  ctx.strokeStyle = '#F4F0EA';
  ctx.lineWidth = 3;
  ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxTextWidth = panelWidth - 24;
  const displayText = text.length > 70 ? `${text.slice(0, 67)}...` : text;

  if (isPortrait) {
    ctx.fillStyle = '#D84727';
    ctx.font = '900 13px "JetBrains Mono", monospace';
    ctx.fillText(title, viewportWidth / 2, panelY + 16);
    ctx.font = '800 13px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(displayText, viewportWidth / 2, panelY + panelHeight - 16, maxTextWidth);
  } else {
    ctx.fillStyle = '#F4F0EA';
    ctx.font = '900 13px "JetBrains Mono", monospace';
    ctx.fillText(`${title}  //  ${displayText}`, viewportWidth / 2, panelY + panelHeight / 2, maxTextWidth);
  }

  if (isPortrait && arena.bottom < viewportHeight - 12) {
    const footerY = arena.bottom + 6;
    const footerHeight = Math.max(44, viewportHeight - arena.bottom - 12);
    ctx.fillStyle = 'rgba(26, 26, 24, 0.95)';
    ctx.fillRect(panelX, footerY, panelWidth, footerHeight);
    ctx.strokeStyle = '#F4F0EA';
    ctx.lineWidth = 3;
    ctx.strokeRect(panelX, footerY, panelWidth, footerHeight);
    ctx.fillStyle = '#D84727';
    ctx.font = '900 14px "Space Grotesk", sans-serif';
    ctx.fillText('OYUNCU BÖLGELERİ', viewportWidth / 2, footerY + 16);

    const swatchY = footerY + 30;
    const swatchStartX = viewportWidth / 2 - Math.min(entries.length, 4) * 44;
    entries.slice(0, 4).forEach((entry, index) => {
      const swatchX = swatchStartX + index * 88;
      ctx.fillStyle = GUIDE_COLORS[index];
      ctx.fillRect(swatchX, swatchY - 7, 14, 14);
      ctx.fillStyle = '#F4F0EA';
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
    ctx.strokeStyle = '#F4F0EA';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, y - 13, textWidth, 26);
    ctx.fillStyle = '#FFFFFF';
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
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(-halfW, -halfH, w, h);

    ctx.strokeStyle = '#99948A';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(-halfW, -halfH, w, h);
    ctx.setLineDash([]);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#75726B';
    ctx.font = '900 24px "Space Grotesk", sans-serif';
    ctx.fillText(`${slotIndex + 1}`, 0, -8);

    ctx.fillStyle = '#8A857B';
    ctx.font = '800 11px "Space Grotesk", sans-serif';
    ctx.fillText('+ KATIL', 0, 14);

  } else if (isHuman) {
    // 2. OYUNCU (HUMAN)
    // Solid 4px Shadow
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(-halfW + 4, -halfH + 4, w, h);

    // Card Face: Krem + %22 Oyuncu Rengi
    ctx.fillStyle = '#FAF7F2';
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
    ctx.font = '900 28px "Space Grotesk", sans-serif';
    const hasName = !!playerName;
    ctx.fillText(`${slotIndex + 1}`, 0, hasName ? -9 : 0);

    if (hasName) {
      // Player Name Pill
      ctx.fillStyle = '#1A1A1A';
      ctx.font = '900 11px "Space Grotesk", sans-serif';
      const displayName = playerName.length > 10 ? playerName.slice(0, 9) + '…' : playerName;
      ctx.fillText(`👤 ${displayName.toUpperCase()}`, 0, 14);
    }

  } else if (isBot) {
    // 3. BOT (KOYU ANTRASİT + SARI ROZET)
    // Solid Shadow
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(-halfW + 4, -halfH + 4, w, h);

    // Dark Charcoal Face
    ctx.fillStyle = '#1F1F1D';
    ctx.fillRect(-halfW, -halfH, w, h);

    // High Contrast Border
    ctx.strokeStyle = isBotGod ? '#FFD700' : '#E5E0D6';
    ctx.lineWidth = isBotGod ? 3.5 : 2.5;
    ctx.strokeRect(-halfW, -halfH, w, h);

    // Bot Number
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 28px "Space Grotesk", sans-serif';
    ctx.fillText(`${slotIndex + 1}`, 0, -9);

    // Bot Tag
    ctx.fillStyle = isBotGod ? '#FFD700' : '#FFDE59';
    ctx.font = '900 12px "Space Grotesk", sans-serif';
    ctx.fillText(isBotGod ? '⚡ GOD BOT' : '🤖 BOT', 0, 14);
  }

  ctx.restore();
}

