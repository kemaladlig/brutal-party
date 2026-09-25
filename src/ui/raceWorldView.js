// Client-only RACE world renderer. It never imports or runs RaceGame/AI.

import {
  drawRaceWorld,
  isValidRaceWorldFrame,
} from '../games/raceView.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { t } from '../i18n.js';

const PLAYER_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidRaceWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = {
        left,
        top,
        right,
        bottom,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
        cx: (left + right) / 2,
        cy: (top + bottom) / 2,
        size: Math.min(right - left, bottom - top),
      };
      const colors = frame.players.map((player) => (
        slots?.[player.slot]?.color || PLAYER_FALLBACK[player.slot] || PLAYER_FALLBACK[0]
      ));

      ctx.save();
      ctx.fillStyle = '#F4F0EA';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        drawRaceWorld(ctx, frame, arena, colors, now);
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

export const createRaceWorldViewRenderer = createWorldViewRenderer;
