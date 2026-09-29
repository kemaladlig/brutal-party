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
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';

export function createSnakeWorldViewRenderer() {
  return {
    validate: isValidSnakeWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'SNAKE' });
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

        drawSnakeArena(ctx, arena, walls, { roundId: frame.roundId });
        drawSnakeFoods(ctx, foods, now);
        drawSnakePlayers(ctx, players, now);
        drawSnakeParticles(ctx, particles);
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        drawWorldRoundBanner(ctx, width, height, frame, slots, context);
      } else if (frame.gameState === 'MATCH_OVER') {
        drawWorldMatchOver(ctx, width, height, frame, slots, {
          headline: frame.matchDraw ? t('game.draw') : t('snake.champ'),
          enter: context.matchOverEnter,
        });
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
