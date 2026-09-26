/**
 * avatarInGame.js — Unified wrapper for drawing character avatars in games.
 * Part of Phase 7 Architecture Refactor.
 */

import { drawBrutalAvatar } from '../ui/characterRenderer.js';

/**
 * Normalizes expression alias strings (e.g. 'angry' -> 'ANGRY')
 * @param {string} exp - Input expression
 * @returns {string} Normalized expression
 */
export function normalizeExpression(exp) {
  if (!exp) return 'NORMAL';
  const upper = exp.toUpperCase();
  const aliasMap = {
    ANGRY: 'ANGRY',
    PANIC: 'PANIC',
    EXCITED: 'EXCITED',
    DIZZY: 'DIZZY',
    WINK: 'WINK',
    SMIRK: 'SMIRK',
    DEAD: 'DEAD',
    NORMAL: 'NORMAL',
  };
  return aliasMap[upper] || upper;
}

/**
 * Draws character avatar for in-game entities.
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X
 * @param {number} y - Center Y
 * @param {number} radius - Avatar radius
 * @param {Object} player - Player entity object
 * @param {Object} [opts] - Overrides and rendering options
 */
export function drawGameAvatar(ctx, x, y, radius, player, opts = {}) {
  const isBot = player.slotType === 'bot_normal' || player.slotType === 'bot_god';
  const defaultNames = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];
  const isDefaultName = !player.name || defaultNames.some((d) => player.name.startsWith(d));
  const customName = (player.name && !isDefaultName)
    ? ` • ${player.name.slice(0, 6)}`
    : '';
  const defaultLabel = `P${(player.index !== undefined ? player.index : 0) + 1}${customName}`;

  const expression = normalizeExpression(opts.expression || player.expression);

  // Avatar kromu yarıçapla ölçeklenir. Sabit 3px çerçeve, masaüstündeki 36px
  // bir avatarın yarıçapının %8'i iken telefondaki 12px avatarın %25'idir —
  // yani küçük ekranda varlığın silueti kromla yiyordu, "iri ve bulanık"
  // hissi tam olarak buradan geliyordu. `radius * 0.12` her boyutta aynı görsel
  // oranı verir; taban, çok küçük avatarın çerçevesiz kaybolmaması için.
  const borderWidth = opts.borderWidth
    ?? Math.max(1.2, Number(radius) * 0.12);

  drawBrutalAvatar(ctx, x, y, radius, {
    color: opts.color || player.color,
    slotIndex: player.index !== undefined ? player.index : 0,
    facingAngle: opts.facingAngle !== undefined ? opts.facingAngle : player.facingAngle || player.angle || 0,
    label: opts.label !== undefined ? opts.label : defaultLabel,
    expression: expression,
    accessory: opts.gameAccessory || opts.accessory || (isBot ? 'BOT' : undefined),
    // Silüeti gövde dışına taşıran aksesuarı (halo, kanat) bastır. Ölçülen
    // etki yarıçap 16'da 36x45 -> 36x37; çarpışma yarıçapı değişmez.
    compactSilhouette: opts.compactSilhouette === true,
    pattern: opts.pattern,
    showPointer: opts.showPointer !== undefined ? opts.showPointer : true,
    borderColor: opts.borderColor || '#1C1C1A',
    borderWidth,
  });
}
