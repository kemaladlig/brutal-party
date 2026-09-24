// Client-only Archer world renderer. Simülasyon/fizik çalıştırmaz; yalnız
// host'un yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawArcherArena,
  drawArcherPickups,
  drawArcherArrows,
  drawArcherPlayers,
  drawArcherParticles,
  isValidArcherWorldFrame,
} from '../games/archerView.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  return {
    validate: isValidArcherWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };

      ctx.save();
      ctx.fillStyle = '#D6D3CD';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        drawArcherArena(
          ctx,
          arena,
          frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h }))
        );
        drawArcherPickups(
          ctx,
          frame.pickups.map(([x, y, type, animTime, size]) => ({ x, y, type, animTime, size }))
        );
        drawArcherArrows(
          ctx,
          frame.arrows.map(([x, y, vx, vy, color]) => ({ x, y, vx, vy, color }))
        );
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || '#D84727',
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawArcherPlayers(ctx, players, { showFx: frame.gameState === 'PLAYING' });
        drawArcherParticles(ctx, frame.particles || []);
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        const winner = slots?.[frame.roundWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.roundOver'), winner || '');
      } else if (frame.gameState === 'MATCH_OVER') {
        const winner = slots?.[frame.matchWinner]?.name;
        drawWorldBanner(ctx, width, height, t('archer.champ'), winner || '');
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height, '#D6D3CD');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
