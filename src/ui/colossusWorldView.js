// Client-only COLOSSUS world renderer. Simülasyon/fizik/AI çalıştırmaz.

import {
  drawColossusWorld,
  isValidColossusWorldFrame,
  colossusSceneFromFrame,
} from '../games/colossusView.js';
import { fitWorld, worldScreenBox, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';

const PLAYER_FALLBACK = ['#F0483C', '#2B7FC4', '#FFD24A', '#35B36A'];

export function createWorldViewRenderer() {
  return {
    validate: isValidColossusWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
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

      const scene = colossusSceneFromFrame(frame);
      scene.players = scene.players.map((player) => ({
        ...player,
        color: slots?.[player.slot]?.color || slots?.[player.slot]?.displayColor || UI_COLORS.players?.[player.slot] || PLAYER_FALLBACK[player.slot],
      }));

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'COLOSSUS' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawColossusWorld(ctx, arena, scene, { now, selfSlot: context.selfSlot ?? -1 });
      });
      ctx.restore();

      if (scene.matchOver) {
        drawWorldMatchOver(ctx, width, height, frame, slots, { enter: context.matchOverEnter });
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height, '#1E293B');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
