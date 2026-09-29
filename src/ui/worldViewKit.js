// World-view kromu: tüm client world renderer'ların paylaştığı overlay katmanı
// (raunt/maç bandı, placeholder, stale) ve arena hizalama yardımcısı.
// Sadece i18n + çizim import eder; oyun simülasyonu/AI import etmez.

import { t } from '../i18n.js';
import { UI_COLORS } from './tokens.js';
import { renderMatchOver, renderRoundBanner } from './hud.js';

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

/**
 * Raunt sonu bandı — host canvas'ının (`tabletopRenderer.renderStandardRoundBanner`
 * → `hud.renderRoundBanner`) AYNISI. Kumanda eskiden ayrı bir `drawWorldBanner`
 * yazıyordu: panel ölçüsü, başlık rengi ve geri sayım farklıydı; aynı raunt
 * telefonda ve TV'de iki türlü görünüyordu. Artık tek `renderRoundBanner` çizer.
 *
 * Başlık host ile aynı kuraldan türer: kazanan varsa `game.won`, berabere ise
 * `game.draw`; renk kazananın koltuk rengidir. `context.roundGap` raunt
 * boşluğunun kalan saniyesidir (STATE_SYNC'ten gelir) ve host'taki aynı sağ-alt
 * geri sayımı besler.
 */
export function drawWorldRoundBanner(ctx, width, height, frame, slots = [], context = {}) {
  const idx = Number.isInteger(frame?.roundWinner) ? frame.roundWinner : null;
  const seat = idx !== null ? slots?.[idx] : null;
  const name = seat?.name || '';
  renderRoundBanner(ctx, {
    arena: { cx: width / 2, cy: height / 2, width, height },
    title: name ? t('game.won', name) : t('game.draw'),
    titleColor: seat?.color || null,
    countdown: Math.max(0, Number(context?.roundGap) || 0),
  });
}

/**
 * Maç sonu kartı — host canvas'ının (`tabletopRenderer.renderStandardMatchOver`
 * → `hud.renderMatchOver`) AYNISI. Kumanda world-view'ı ayrı bir bant yazınca
 * telefonla TV farklı oyun gibi görünüyordu; tek `layoutMatchOverCard` +
 * `drawResultPanel` burada da çizilir. Eylem butonları YOKtur: yeniden başlatma
 * yetkisi host'tadır, kumanda yalnız sonucu gösterir.
 *
 * `frame`: WORLD_FRAME snapshot'ı (`scores`, `matchWinner`, `matchDraw`).
 * `slots`: `SLOTS_UPDATE` isim/renk/avatar kaynağı — yalnız dolu koltuk çizilir.
 */
export function drawWorldMatchOver(ctx, width, height, frame, slots = [], { headline = null } = {}) {
  const scores = Array.isArray(frame.scores) ? frame.scores : [];
  const rows = [];
  for (let i = 0; i < scores.length; i++) {
    const seat = slots?.[i];
    const name = seat?.name || '';
    if (!name) continue;
    const score = Number(scores[i]) || 0;
    rows.push({ color: seat?.color || UI_COLORS.players[i], name, value: String(score), score });
  }

  const winnerSlot = Number.isInteger(frame.matchWinner) ? frame.matchWinner : null;
  const winnerSeat = winnerSlot !== null ? slots?.[winnerSlot] : null;
  const winnerName = winnerSeat?.name || '';
  const winnerColor = winnerSeat?.color || UI_COLORS.resultGold;

  renderMatchOver(ctx, {
    arena: { cx: width / 2, cy: height / 2, width, height },
    headline: headline || (frame.matchDraw ? t('game.draw') : t('game.champWon')),
    winnerName,
    winnerColor,
    winnerEntity: winnerSeat
      ? { name: winnerName, color: winnerColor, index: winnerSlot, avatar: winnerSeat.avatar || null }
      : null,
    rows,
  });
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
