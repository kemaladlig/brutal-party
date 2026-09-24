// Client-only Bomb world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawBombArena,
  drawBombInk,
  drawBombPickups,
  drawBombPlayers,
  drawBombParticles,
  isValidBombWorldFrame,
} from '../games/bombView.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  return {
    validate: isValidBombWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };

      ctx.save();
      ctx.fillStyle = '#F4F0EA';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        const pillars = frame.pillars.map(([x, y, w, h]) => ({ x, y, w, h }));
        const carrierIndex = frame.carrier;
        const carrier = frame.players.find((p) => p.slot === carrierIndex) || null;
        drawBombArena(ctx, arena, pillars, {
          carrier: carrier ? { ...carrier, alive: carrier.alive } : null,
          bombTimer: frame.bombTimer,
          bombMaxTime: frame.bombMaxTime,
        });
        drawBombInk(ctx, frame.ink.map(([x, y, radius]) => ({ x, y, radius })));
        drawBombPickups(ctx, frame.pickups.map(([x, y, type, animTime, size]) => ({ x, y, type, animTime, size })));
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          carrier: p.slot === frame.carrier,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || '#D84727',
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawBombPlayers(ctx, players, {
          bombTimer: frame.bombTimer,
          bombMaxTime: frame.bombMaxTime,
          withFx: frame.gameState === 'PLAYING',
        });
        drawBombParticles(ctx, frame.particles || []);
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
      renderWorldPlaceholder(ctx, width, height, '#F4F0EA');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
