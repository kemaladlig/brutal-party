// Client-only Tanks world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawTanksArena,
  drawTanksBullets,
  drawTanksTracers,
  drawTanksCrates,
  drawTanksTanks,
  isValidTanksWorldFrame,
} from '../games/tanksView.js';
import { drawSquareParticles } from '../games/worldCore.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const TANK_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidTanksWorldFrame,

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
        drawTanksArena(ctx, arena, frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h })));
        const ownerColors = frame.players.map((p) => slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || TANK_FALLBACK[p.slot]);
        drawTanksBullets(ctx, frame.bullets.map(([x, y, radius, owner]) => ({ x, y, radius, owner })), ownerColors);
        drawTanksTracers(ctx, frame.tracers || []);
        drawTanksCrates(ctx, frame.crates.map(([x, y, size, type]) => ({ x, y, size, type })));
        const tanks = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || TANK_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawTanksTanks(ctx, tanks, { arena, withFx: frame.gameState === 'PLAYING' });
        drawSquareParticles(ctx, frame.particles || []);
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
