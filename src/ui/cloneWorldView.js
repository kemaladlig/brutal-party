// Client-only Clone world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawCloneArena,
  drawCloneStations,
  drawCloneWalls,
  drawCloneCharacter,
  drawCloneTexts,
  isValidCloneWorldFrame,
} from '../games/cloneView.js';
import { drawCircleParticles } from '../games/worldCore.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const CLONE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidCloneWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      arena.size = Math.min(arena.width, arena.height);
      const withFx = frame.gameState === 'PLAYING';

      ctx.save();
      ctx.fillStyle = '#151515';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        drawCloneArena(ctx, arena);
        drawCloneStations(ctx, frame.stations || []);
        drawCloneWalls(ctx, frame.walls.map(([x, y, w, h]) => ({ x, y, w, h })));
        for (const c of frame.clones || []) {
          drawCloneCharacter(ctx, c.x, c.y, c.angle, c.color, { task: c.task, withFx });
        }
        for (const p of frame.players) {
          if (p.joined === false || p.alive === false) continue;
          drawCloneCharacter(ctx, p.x, p.y, p.angle,
            slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || CLONE_FALLBACK[p.slot],
            { dashing: p.dash, slowed: p.slow, task: p.task, withFx });
        }
        drawCircleParticles(ctx, frame.particles || []);
        drawCloneTexts(ctx, frame.texts || []);
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
      renderWorldPlaceholder(ctx, width, height, '#151515');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
