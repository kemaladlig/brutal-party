// Client-only Snake world renderer. It never imports or runs SnakeGame/AI.

import {
  drawSnakeArena,
  drawSnakeFoods,
  drawSnakeParticles,
  drawSnakePlayers,
  isValidSnakeWorldFrame,
} from '../games/snakeView.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';

export function createSnakeWorldViewRenderer() {
  return {
    validate: isValidSnakeWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };

      ctx.save();
      ctx.fillStyle = '#F4F4F0';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        const walls = frame.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
        const foods = frame.foods.map(([x, y, type, size]) => ({ x, y, type, size, pulse: 0 }));
        const players = frame.players.map((player) => ({
          ...player,
          index: player.slot,
          color: slots?.[player.slot]?.color || UI_COLORS.players[player.slot] || '#D84727',
          avatar: slots?.[player.slot]?.avatar || null,
          boostEnergy: player.energy,
        }));
        const particles = (frame.particles || []).map((particle) => ({ ...particle }));

        drawSnakeArena(ctx, arena, walls);
        drawSnakeFoods(ctx, foods, now);
        drawSnakePlayers(ctx, players, now);
        drawSnakeParticles(ctx, particles);
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        const winner = slots?.[frame.roundWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.roundOver'), winner || '');
      } else if (frame.gameState === 'MATCH_OVER') {
        const winner = slots?.[frame.matchWinner]?.name;
        drawWorldBanner(ctx, width, height, t('snake.champ'), winner || '');
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

// Generik mount adı: gamepad.js tüm world renderer'lardan bunu çağırır.
// (Eski isim geriye uyumluluk için korunur.)
export const createWorldViewRenderer = createSnakeWorldViewRenderer;
