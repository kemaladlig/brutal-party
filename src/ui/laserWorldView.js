// Client-only Laser world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawLaserArena,
  drawLaserPickups,
  drawLaserAims,
  drawLaserShots,
  drawLaserPlayers,
  isValidLaserWorldFrame,
} from '../games/laserView.js';
import { drawCircleParticles, drawAlphaTexts } from '../games/worldCore.js';
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const LASER_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidLaserWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      const withFx = frame.gameState === 'PLAYING';

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'LASER' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawLaserArena(
          ctx,
          arena,
          frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h })),
          frame.walls || [],
          { roundId: frame.roundId },
        );
        drawLaserPickups(ctx, frame.pickups.map(([x, y, type, anim, size]) => ({ x, y, type, anim, size })));
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || LASER_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        if (withFx) drawLaserAims(ctx, players);
        drawLaserShots(ctx, frame.lasers || []);
        drawLaserPlayers(ctx, players, { arena, withFx });
        drawCircleParticles(ctx, frame.particles || []);
        drawAlphaTexts(ctx, frame.texts || [], { size: 16, outline: true });
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        drawWorldRoundBanner(ctx, width, height, frame, slots, context);
      } else if (frame.gameState === 'MATCH_OVER') {
        drawWorldMatchOver(ctx, width, height, frame, slots);
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
