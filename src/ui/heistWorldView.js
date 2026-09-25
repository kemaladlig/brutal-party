// Client-only Heist world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawHeistArena,
  drawHeistVaults,
  drawHeistLoot,
  drawHeistPiggy,
  drawHeistPlayers,
  drawHeistTexts,
  isValidHeistWorldFrame,
} from '../games/heistView.js';
import { drawSquareParticles } from '../games/worldCore.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  return {
    validate: isValidHeistWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      arena.size = Math.min(arena.width, arena.height);

      ctx.save();
      ctx.fillStyle = '#F4F0EA';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        drawHeistArena(ctx, arena, frame.pillars.map(([x, y, w, h]) => ({ x, y, w, h })));
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || '#D99B26',
          avatar: slots?.[p.slot]?.avatar || null,
          name: slots?.[p.slot]?.name || `P${p.slot + 1}`,
        }));
        drawHeistVaults(
          ctx,
          frame.vaults.map(([x, y, w, h, playerIndex]) => ({ x, y, w, h, playerIndex })),
          players,
        );
        drawHeistLoot(ctx, frame.loot.map(([x, y, radius, type]) => ({ x, y, radius, type })));
        drawHeistPiggy(ctx, frame.piggy);
        drawHeistPlayers(ctx, players, { withFx: frame.gameState === 'PLAYING' });
        drawSquareParticles(ctx, frame.particles || []);
        drawHeistTexts(ctx, frame.texts || []);
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
      renderWorldPlaceholder(ctx, width, height, '#F4F0EA');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
