import { UI_COLORS, UI_SIZES, uiFont } from './ui/tokens.js';
import { drawBrutalAvatar } from './ui/characterRenderer.js';
import { getBotPersona } from './core/customizationManager.js';
import { t } from './i18n.js';

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
    ctx.fillText(t('canvas.zones'), viewportWidth / 2, footerY + 16);

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
 * 1. EMPTY  -> Soft dashed border, clean seat marker
 * 2. HUMAN  -> Avatar prominence, clean name pill or clean seat number
 * 3. BOT    -> Antracite card with cyber robot avatar
 */
// Koltuk renk noktası kutusu: kartın sağ-üst köşesi (tap hedefi, 44px dokunmatik).
export function getSeatColorDotRect(seatRect) {
  const s = 40;
  return {
    x: seatRect.x + seatRect.w - s - 8,
    y: seatRect.y + 8,
    w: s,
    h: s,
  };
}

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
  seatColor = null,
  showColorDot = false,
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
  let drawColorDotAfter = false;
  let colorDotFill = playerColor;

  if (isEmpty) {
    // 1. BOŞ KOLTUK
    ctx.fillStyle = UI_COLORS.card;
    ctx.fillRect(-halfW, -halfH, w, h);

    ctx.strokeStyle = UI_COLORS.faint;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(-halfW, -halfH, w, h);
    ctx.setLineDash([]);

    // Koltuk rozeti (P1..P4 sembolü)
    ctx.fillStyle = 'rgba(26, 26, 26, 0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(22, halfW * 0.45), 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_COLORS.muted;
    ctx.font = uiFont('seatEmpty');
    ctx.fillText(`${slotIndex + 1}`, 0, 1);

  } else if (isHuman) {
    // 2. OYUNCU (HUMAN)
    const effectiveColor = seatColor || playerColor;
    // Solid 4px Shadow
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillRect(-halfW + 4, -halfH + 4, w, h);

    // Card Face: Krem
    ctx.fillStyle = UI_COLORS.card;
    ctx.fillRect(-halfW, -halfH, w, h);

    // Bold Color Border
    ctx.strokeStyle = effectiveColor;
    ctx.lineWidth = 3.5;
    ctx.strokeRect(-halfW, -halfH, w, h);

    const avatarR = Math.min(24, Math.round(Math.min(w, h) * 0.26));
    const avatarY = playerName ? -halfH + avatarR + 10 : 0;

    drawBrutalAvatar(ctx, 0, avatarY, avatarR, {
      slotIndex: slotIndex,
      color: effectiveColor,
      expression: 'normal',
      showPointer: false,
      borderWidth: 2.5,
      shadowOffset: 2,
    });

    // LOCAL hızlı renk noktası bayrağı: kart dönüşünden etkilenmemesi için
    // mutlak koordinatta (restore sonrası) çizilir — tap kutusuyla birebir eşleşir.
    drawColorDotAfter = showColorDot;
    colorDotFill = effectiveColor;

    // Sadece özel oyuncu ismi varsa minimal etiket çiz
    if (playerName) {
      ctx.fillStyle = UI_COLORS.ink;
      ctx.font = uiFont('nameTag');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const displayName = playerName.length > 8 ? playerName.slice(0, 7) + '…' : playerName;
      ctx.fillText(displayName.toUpperCase(), 0, halfH - 12);
    }

  } else if (isBot) {
    // 3. BOT (ÖZGÜN BOT PERSONA & KARAKTER KİMLİĞİ)
    const persona = getBotPersona(slotIndex, isBotGod);

    // Solid Shadow
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fillRect(-halfW + 4, -halfH + 4, w, h);

    // Dark Charcoal Face
    ctx.fillStyle = UI_COLORS.botFace;
    ctx.fillRect(-halfW, -halfH, w, h);

    // High Contrast Border
    ctx.strokeStyle = persona.color;
    ctx.lineWidth = isBotGod ? 3.5 : 2.5;
    ctx.strokeRect(-halfW, -halfH, w, h);

    const avatarR = Math.min(24, Math.round(Math.min(w, h) * 0.26));
    const avatarY = -halfH + avatarR + 10;

    drawBrutalAvatar(ctx, 0, avatarY, avatarR, {
      slotIndex: slotIndex,
      isBot: true,
      isGodBot: isBotGod,
      color: persona.color,
      expression: persona.expression,
      accessory: persona.accessory,
      pattern: persona.pattern,
      showPointer: false,
      borderWidth: 2,
      shadowOffset: 2,
    });

    // Bot İsim & Rozet
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = persona.color;
    ctx.font = uiFont('tag');
    ctx.fillText(persona.name, 0, halfH - 12);
  }

  ctx.restore();

  // LOCAL hızlı renk noktası (kartın sağ-üstü, mutlak koordinat — tap kutusuyla eşleşir)
  if (drawColorDotAfter) {
    const dotR = 11;
    const dotX = x + w - 28;
    const dotY = y + 28;
    ctx.save();
    ctx.beginPath();
    ctx.arc(dotX + 2, dotY + 2, dotR, 0, Math.PI * 2);
    ctx.fillStyle = UI_COLORS.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = colorDotFill;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fill();
    ctx.restore();
  }
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
// dockRect verilirse (viewport), kartlar ekran kenarlarına kenetlenir (responsive docking).
export function getStandardSeatRects(arena, inset = LOBBY_SEAT_INSET, dockRect = null) {
  const bounds = dockRect || arena;
  const s = getStandardSeatSize(arena || bounds);
  return [
    { x: bounds.left + inset, y: bounds.bottom - s - inset, w: s, h: s },
    { x: bounds.left + inset, y: bounds.top + inset, w: s, h: s },
    { x: bounds.right - s - inset, y: bounds.top + inset, w: s, h: s },
    { x: bounds.right - s - inset, y: bounds.bottom - s - inset, w: s, h: s },
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
  minJoined = 2,
  centerYOffset = 0,
  hidden = false,
}) {
  if (hidden) return null;
  const btnW = Math.min(UI_SIZES.startW, arena.width * 0.45);
  const btnH = UI_SIZES.startH;
  const btnX = arena.cx - btnW / 2;
  const btnY = arena.cy - btnH / 2 + centerYOffset;
  const ready = joinedCount >= minJoined;

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
  ctx.fillText(ready ? t('pause.resume') : t('canvas.need2'), arena.cx, btnY + btnH / 2);
  ctx.restore();

  if (ready) {
    uiButtons.push({
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      onClick: () => {
        if (typeof onStart === 'function') onStart();
      },
    });
  }
  return { x: btnX, y: btnY, w: btnW, h: btnH };
}

