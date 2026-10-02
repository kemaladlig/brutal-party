// Client-only CROWN world renderer. It never imports or runs CrownGame/AI.

import { drawCrownWorld, drawCrownFxLayer, isValidCrownWorldFrame, CROWN_THEME_25D } from '../games/crownView.js';
import { drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { arenaFromRect, TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { CROWN_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const PLAYER_FALLBACK = CROWN_COLORS;

export function createWorldViewRenderer() {
  // 2.5D sahne zarfı renderer ömrü boyunca yaşar (proj kalıcı; kare başına
  // tahsis yok). Host ile AYNI girdileri verir → sahne birebir eşleşir.
  const scene = createTiltedScene({ camera: TILTED_25D_CAMERA.crown });
  return {
    validate: isValidCrownWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (tanks deseni). Yoksa
      // v1 host'un paketlediği anlık görüntü (yedek kanal).
      const fxLive = !!context.fx;
      const arena = arenaFromRect(frame.arena);
      const colors = frame.players.map((player) => (
        slots?.[player.slot]?.color || PLAYER_FALLBACK[player.slot] || PLAYER_FALLBACK[0]
      ));
      ctx.save();
      // 2.5D eğik kamera: host ile AYNI girdilerden (arena + viewport + sabit
      // tema) kurulur; masa zemini `drawField25d` içinde boyanır.
      const proj = scene.open(ctx, { viewport: { width, height }, arena, theme: CROWN_THEME_25D });
      drawCrownWorld(ctx, frame, arena, colors, now, undefined, context.selfSlot ?? -1, { roundId: frame.roundId, proj });
      scene.close(ctx);
      // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
      drawCrownFxLayer(ctx, fxLive
        ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
        : {
            pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
            rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
            particles: frame.particles || [],
          }, proj);
      ctx.restore();
      if (frame.gameState === 'ROUND_OVER') {
        drawWorldRoundBanner(ctx, width, height, frame, slots, context);
      } else if (frame.gameState === 'MATCH_OVER') {
        drawWorldMatchOver(ctx, width, height, frame, slots, { enter: context.matchOverEnter });
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
