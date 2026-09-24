// Client-only Collapse world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawCollapseFalling,
  drawCollapseGrid,
  drawCollapseWaves,
  drawCollapsePickups,
  drawCollapsePlayers,
  isValidCollapseWorldFrame,
} from '../games/collapseView.js';
import { drawCircleParticles } from '../games/worldCore.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const COLLAPSE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

function drawAbyss(ctx, width, height) {
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#1F1F1F';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
}

export function createWorldViewRenderer() {
  return {
    validate: isValidCollapseWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      arena.size = Math.min(arena.width, arena.height);
      const withFx = frame.gameState === 'PLAYING';

      ctx.save();
      drawAbyss(ctx, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        drawCollapseFalling(ctx, frame.falling || []);
        drawCollapseGrid(ctx, arena, frame.cell, frame.grid, frame.warn, { withFx, now });
        drawCollapseWaves(ctx, frame.waves || []);
        drawCollapsePickups(ctx, frame.pickups || [], now);
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || COLLAPSE_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawCollapsePlayers(ctx, players);
        drawCircleParticles(ctx, frame.particles || []);
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        const winner = slots?.[frame.roundWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.roundOver'), winner || '');
      } else if (frame.gameState === 'MATCH_OVER') {
        const winner = slots?.[frame.matchWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.champWon'), winner || '');
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height, '#141414');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
