/**
 * avatarInGame.js — Unified wrapper for drawing character avatars in games.
 * Part of Phase 7 Architecture Refactor.
 *
 * OYUN İÇİ AVATAR SÖZLEŞMESİ
 * Sahadaki karakter dekor değil, birimdir. Buradan geçen her avatar:
 *   - düz renk + kalın çerçeve + disk İÇİ hacim (sol üst ışık / sağ alt gölge)
 *   - büyütülmüş gözler, oyun durumundan gelen yüz ifadesi
 *   - koltuk fazına kaydırılmış göz kırpma
 *   - ASLA aksesuar / gövde deseni taşımaz
 * Aksesuar ve desen yalnız `drawBrutalAvatar`'ın doğrudan çağıranlarında
 * (lobi koltuk kartı, kişiselleştirme, kumanda önizlemesi) yaşar.
 */

import { drawBrutalAvatar } from '../ui/characterRenderer.js';

/**
 * Göz kırpma ritmi. Menü önizlemesinden (sabit 3.2s) ayrı: oyun içi hızlı ve
 * kısa — sahada uzun kapalı göz, oyuncunun "baktı mı" sorusunu uzatıyordu.
 * Süreler `drawBrutalAvatar`'ın opt-in `blinkProgress` değerine gider; yüz
 * dalları yalnız `> 0.5`'e baktığı için 0/1 durumları yeterli.
 */
const BLINK_PERIOD_MS = 2600;
const BLINK_CLOSED_MS = 110;

/**
 * Belirli bir koltuk için kırpma durumu.
 * @param {number} now - performance.now() tabanlı zaman (ms)
 * @param {number} slotIndex - Koltuk (faz kaydırması için)
 * @returns {number} 0 = açık, 1 = kapalı
 */
export function blinkState(now, slotIndex = 0) {
  if (!Number.isFinite(now)) return 0;
  // Koltuk başına 0.31 ofset: dört oyuncu asla senkr kırpmıyor, "bütün saha
  // birden kırpıp kırpmıyor" gibi mekanik bir görüntü oluşuyordu.
  const phase = ((now / 1000 + slotIndex * 0.31) % (BLINK_PERIOD_MS / 1000)) / (BLINK_PERIOD_MS / 1000);
  return phase > 1 - (BLINK_CLOSED_MS / BLINK_PERIOD_MS) ? 1 : 0;
}

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
  const defaultNames = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];
  const isDefaultName = !player.name || defaultNames.some((d) => player.name.startsWith(d));
  const customName = (player.name && !isDefaultName)
    ? ` • ${player.name.slice(0, 6)}`
    : '';
  const slotIndex = player.index !== undefined ? player.index : 0;
  const defaultLabel = `P${slotIndex + 1}${customName}`;

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
    slotIndex,
    facingAngle: opts.facingAngle !== undefined ? opts.facingAngle : player.facingAngle || player.angle || 0,
    label: opts.label !== undefined ? opts.label : defaultLabel,
    expression: expression,
    // Saha içi kip: dekor katmanları kapalı, gözler büyük, disk içi hacim var.
    faceMode: 'play',
    lookAngle: opts.lookAngle,
    // `now` view/oyun tarafından verilir; yoksa kırpma donuk kalır (deterministik
    // test/harness yolu zaman bağımlı olmaz).
    blinkProgress: opts.isBlinking ? 1 : blinkState(opts.now, slotIndex),
    showPointer: opts.showPointer !== undefined ? opts.showPointer : true,
    borderColor: opts.borderColor || '#1C1C1A',
    borderWidth,
  });
}
