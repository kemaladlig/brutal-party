// SUMO kumanda/TV yüzey çizici — simülasyon çalıştırmaz, host WORLD_FRAME'ini
// doğrular ve çizer. Çiziciler host ile AYNI fonksiyonlardır (sumoView.js).

import {
  isValidSumoWorldFrame,
  drawSumoArena,
  drawSumoPlayers,
  drawSumoFxLayer,
} from '../games/sumoView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import {
  fitWorld,
  worldScreenBox,
  drawWorldRoundBanner,
  drawWorldMatchOver,
  renderWorldPlaceholder,
  renderWorldStale,
} from './worldViewKit.js';
import { drawFloatingTextSnapshotList } from './hud.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  return {
    validate: isValidSumoWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      const [left, top, right, bottom] = frame.arena;
      const arena = {
        left, top, right, bottom,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      arena.size = Math.min(arena.width, arena.height);
      arena.unit = arena.size / 952;

      const [rcx, rcy, rr] = frame.ring;
      const ring = { cx: rcx, cy: rcy, r: rr, r0: rr };
      const fxLive = !!context.fx;

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'SUMO' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawSumoArena(ctx, arena, ring, { roundId: frame.roundId });
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawSumoPlayers(ctx, players, {
          ring,
          now,
          withFx: frame.gameState === 'PLAYING',
          selfSlot: context.selfSlot ?? -1,
        });
        drawSumoFxLayer(ctx, fxLive
          ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
          : {
              pops: frame.fx?.pops,
              rings: frame.fx?.rings,
              particles: frame.particles || [],
            });
        drawFloatingTextSnapshotList(ctx, frame.texts);
      });
      ctx.restore();

      const fxSrc = fxLive ? context.fx : frame.fx;
      const flashAlpha = fxFlashAlpha(fxSrc?.flash, fxSrc?.flashPeak);
      if (flashAlpha > 0) drawFxFlash(ctx, width, height, flashAlpha);

      if (frame.gameState === 'ROUND_OVER') {
        drawWorldRoundBanner(ctx, width, height, frame, slots, context);
      } else if (frame.gameState === 'MATCH_OVER') {
        drawWorldMatchOver(ctx, width, height, frame, slots, {
          headline: frame.matchDraw ? t('game.draw') : t('game.champWon'),
          enter: context.matchOverEnter,
        });
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height);
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
