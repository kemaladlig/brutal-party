// Client-only Snake world renderer. It never imports or runs SnakeGame/AI.

import {
  drawSnakeArena,
  drawSnakeFoods,
  drawSnakePlayers,
  isValidSnakeWorldFrame,
} from '../games/snakeView.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

function drawBanner(ctx, width, height, title, subtitle = '') {
  const boxWidth = Math.min(width - 32, 420);
  const boxHeight = subtitle ? 92 : 64;
  const x = (width - boxWidth) / 2;
  const y = (height - boxHeight) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(20, 20, 20, 0.78)';
  ctx.fillRect(x + 5, y + 5, boxWidth, boxHeight);
  ctx.fillStyle = '#D84727';
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 24px "Space Grotesk", sans-serif';
  ctx.fillText(title, width / 2, y + (subtitle ? 30 : boxHeight / 2));
  if (subtitle) {
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.fillText(subtitle, width / 2, y + 64);
  }
  ctx.restore();
}

export function createSnakeWorldViewRenderer() {
  return {
    validate: isValidSnakeWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const worldWidth = Math.max(1, right - left);
      const worldHeight = Math.max(1, bottom - top);
      const scale = Math.min(width / worldWidth, height / worldHeight);
      const offsetX = (width - worldWidth * scale) / 2;
      const offsetY = (height - worldHeight * scale) / 2;

      ctx.save();
      ctx.fillStyle = '#F4F4F0';
      ctx.fillRect(0, 0, width, height);
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.translate(-left, -top);

      const arena = { left, top, width: worldWidth, height: worldHeight };
      const walls = frame.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
      const foods = frame.foods.map(([x, y, type, size]) => ({ x, y, type, size, pulse: 0 }));
      const players = frame.players.map((player) => ({
        ...player,
        index: player.slot,
        color: slots?.[player.slot]?.color || UI_COLORS.players[player.slot] || '#D84727',
        avatar: slots?.[player.slot]?.avatar || null,
        boostEnergy: player.energy,
      }));

      drawSnakeArena(ctx, arena, walls);
      drawSnakeFoods(ctx, foods, now);
      drawSnakePlayers(ctx, players, now);
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        const winner = slots?.[frame.roundWinner]?.name;
        drawBanner(ctx, width, height, t('game.roundOver'), winner || '');
      } else if (frame.gameState === 'MATCH_OVER') {
        const winner = slots?.[frame.matchWinner]?.name;
        drawBanner(ctx, width, height, t('snake.champ'), winner || '');
      }
    },

    renderPlaceholder(ctx, width, height) {
      ctx.save();
      ctx.fillStyle = '#F4F4F0';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#1A1A1A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 18px "Space Grotesk", sans-serif';
      ctx.fillText(t('pad.waiting'), width / 2, height / 2);
      ctx.restore();
    },

    renderStale(ctx, width, height) {
      ctx.save();
      ctx.fillStyle = 'rgba(20, 20, 20, 0.72)';
      ctx.fillRect(0, height / 2 - 34, width, 68);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 15px "JetBrains Mono", monospace';
      ctx.fillText(t('net.hostGoneRetry'), width / 2, height / 2);
      ctx.restore();
    },
  };
}
