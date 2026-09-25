// Client-only Horde world renderer. Simülasyon/fizik/AI çalıştırmaz.

import {
  drawHordeParticles,
  drawHordeStatus,
  drawHordeWorld,
  hordeSceneFromFrame,
  isValidHordeWorldFrame,
} from '../games/hordeView.js';
import { t } from '../i18n.js';
import { drawWorldBanner, fitWorld, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';

const HORDE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2D6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidHordeWorldFrame,

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
      };
      const scene = hordeSceneFromFrame(frame);
      scene.players = scene.players.map((player) => ({
        ...player,
        color: slots?.[player.slot]?.color || slots?.[player.slot]?.displayColor || UI_COLORS.players?.[player.slot] || HORDE_FALLBACK[player.slot],
        expression: slots?.[player.slot]?.avatar?.expression || player.expression,
        accessory: slots?.[player.slot]?.avatar?.accessory || player.accessory,
        pattern: slots?.[player.slot]?.avatar?.pattern || player.pattern,
      }));

      ctx.save();
      ctx.fillStyle = '#F4F4F0';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        drawHordeWorld(ctx, arena, scene, { withFx: frame.gameState === 'PLAYING', now });
        drawHordeStatus(ctx, arena, scene);
        drawHordeParticles(ctx, frame.particles || []);
      });
      ctx.restore();

      if (frame.gameState === 'MATCH_OVER') {
        drawWorldBanner(
          ctx,
          width,
          height,
          scene.matchResult === 'win' ? t('horde.victory') : t('horde.defeat'),
          t('horde.finalScore', frame.scores.join(' - ')),
        );
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
