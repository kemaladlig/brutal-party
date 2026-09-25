// Client-only Curve world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.
// Trail çift katman: yakın segmentler tam çizilir, eski izler 24x24 sahiplik maskesiyle kaba temsil edilir.

import {
  unpackCurveFieldMask,
  unpackCurveGapMask,
  drawCurveFieldMask,
  drawCurveNearSegments,
  drawCurveHeads,
  drawCurvePickups,
  isValidCurveWorldFrame,
} from '../games/curveView.js';
import { drawSquareParticles, drawAlphaTexts } from '../games/worldCore.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const CURVE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

function drawCurveGrid(ctx, arena) {
  const { left, top, right, bottom, width, height, size } = arena;

  ctx.fillStyle = '#FAF7F2';
  ctx.fillRect(left, top, width, height);

  ctx.strokeStyle = '#E2DDD4';
  ctx.lineWidth = 1.5;
  const gridStep = size / 6;
  for (let x = left + gridStep; x < right; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let y = top + gridStep; y < bottom; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  const bLen = Math.max(16, Math.round(size * 0.05));
  ctx.strokeStyle = '#2B2B28';
  ctx.lineWidth = 3;
  const cornerPlates = [
    [[left, top + bLen], [left, top], [left + bLen, top]],
    [[right - bLen, top], [right, top], [right, top + bLen]],
    [[left, bottom - bLen], [left, bottom], [left + bLen, bottom]],
    [[right - bLen, bottom], [right, bottom], [right, bottom - bLen]],
  ];
  for (const [[x1, y1], [x2, y2], [x3, y3]] of cornerPlates) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
  }

  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(right, top + 6, 6, height);
  ctx.fillRect(left + 6, bottom, width, 6);
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 6;
  ctx.strokeRect(left, top, width, height);
}

export function createWorldViewRenderer() {
  return {
    validate: isValidCurveWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.size = Math.min(arena.width, arena.height);

      ctx.save();
      ctx.fillStyle = '#F4F4F0';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || CURVE_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        const colors = players.map((p) => p.color);

        drawCurveGrid(ctx, arena);
        drawCurveFieldMask(ctx, { x: left, y: top, s: arena.size }, unpackCurveFieldMask(frame.field), colors, unpackCurveGapMask(frame.gaps));
        drawCurveNearSegments(ctx, frame.near || [], colors);
        drawCurvePickups(ctx, frame.pickups || []);
        drawAlphaTexts(ctx, frame.texts || [], { size: 12, outline: true });
        drawSquareParticles(ctx, frame.particles || []);
        drawCurveHeads(ctx, players);
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        const winner = slots?.[frame.roundWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.roundOver'), winner || '');
      } else if (frame.gameState === 'MATCH_OVER') {
        const winner = slots?.[frame.matchWinner]?.name;
        drawWorldBanner(ctx, width, height, frame.matchDraw ? t('game.draw') : t('game.champWon'), winner || '');
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height, '#F4F4F0');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
