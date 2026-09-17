const GUIDE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function renderControlGuide(ctx, arena, title, entries) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isPortrait = arena.height > arena.width;
  const panelHeight = isPortrait ? Math.max(42, arena.top - 8) : Math.max(18, arena.top - 4);
  const panelY = isPortrait ? 4 : 4;
  const panelWidth = Math.min(arena.width, viewportWidth - 24);
  const panelX = (viewportWidth - panelWidth) / 2;
  const text = entries.join('   •   ');

  ctx.save();
  ctx.fillStyle = 'rgba(26, 26, 24, 0.9)';
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.strokeStyle = '#F4F0EA';
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxTextWidth = panelWidth - 18;
  const displayText = text.length > 82 ? `${text.slice(0, 79)}...` : text;
  ctx.fillStyle = '#F4F0EA';
  ctx.font = isPortrait ? '800 9px "JetBrains Mono", monospace' : '800 8px "JetBrains Mono", monospace';
  if (isPortrait) {
    ctx.fillText(title, viewportWidth / 2, panelY + 11);
    ctx.font = '700 10px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(displayText, viewportWidth / 2, panelY + panelHeight - 12, maxTextWidth);
  } else {
    ctx.fillText(`${title} // ${displayText}`, viewportWidth / 2, panelY + panelHeight / 2, maxTextWidth);
  }

  if (isPortrait && arena.bottom < viewportHeight - 8) {
    const footerY = arena.bottom + 4;
    const footerHeight = Math.max(36, viewportHeight - arena.bottom - 8);
    ctx.fillStyle = 'rgba(26, 26, 24, 0.9)';
    ctx.fillRect(panelX, footerY, panelWidth, footerHeight);
    ctx.strokeStyle = '#F4F0EA';
    ctx.strokeRect(panelX, footerY, panelWidth, footerHeight);
    ctx.fillStyle = '#D84727';
    ctx.font = '900 11px "Space Grotesk", sans-serif';
    ctx.fillText('OYUNCU BÖLGELERİ', viewportWidth / 2, footerY + footerHeight / 2);

    const swatchY = footerY + 15;
    const swatchStartX = viewportWidth / 2 - Math.min(entries.length, 4) * 38;
    entries.slice(0, 4).forEach((entry, index) => {
      const swatchX = swatchStartX + index * 76;
      ctx.fillStyle = GUIDE_COLORS[index];
      ctx.fillRect(swatchX, swatchY, 10, 10);
      ctx.fillStyle = '#F4F0EA';
      ctx.font = '800 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`P${index + 1}`, swatchX + 14, swatchY + 5);
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#F4F0EA';
    ctx.font = '800 9px "JetBrains Mono", monospace';
    ctx.fillText('4P İÇİN TELEFONU YATIR', viewportWidth / 2, footerY + footerHeight - 11);
  }

  ctx.restore();
}

export function renderPlayerLegend(ctx, arena, players, labels) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isPortrait = arena.height > arena.width;
  const y = isPortrait ? Math.max(arena.bottom + 8, viewportHeight - 26) : 18;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 9px "JetBrains Mono", monospace';
  const text = players
    .filter((player) => player.isJoined || player.isAlive || player.slotType !== 'empty')
    .map((player) => `${labels[player.index]} ${player.name || `P${player.index + 1}`}`)
    .join('  |  ');
  if (text) {
    ctx.fillStyle = '#1A1A1A';
    ctx.fillText(text, viewportWidth / 2, y, Math.max(120, viewportWidth - 24));
  }
  ctx.restore();
}

export function getGuideColor(index) {
  return GUIDE_COLORS[index % GUIDE_COLORS.length];
}
