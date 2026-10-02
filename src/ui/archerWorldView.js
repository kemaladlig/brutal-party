// Client-only Archer world renderer. Simülasyon/fizik çalıştırmaz; yalnız
// host'un yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawArcherArena,
  drawArcherPickups,
  drawArcherArrows,
  drawArcherPlayers,
  drawArcherFxLayer,
  isValidArcherWorldFrame,
  ARCHER_THEME_25D,
} from '../games/archerView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { arenaFromRect, TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  // 2.5D sahne zarfı renderer ömrü boyunca yaşar (proj kalıcı; kare başına
  // tahsis yok). Host ile AYNI girdileri verir → sahne birebir eşleşir.
  const scene = createTiltedScene({ camera: TILTED_25D_CAMERA.archer });
  return {
    validate: isValidArcherWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (tanks deseni). Yoksa
      // v1 host'un paketlediği anlık görüntü (yedek kanal).
      const fxLive = !!context.fx;
      const arena = arenaFromRect(frame.arena);

      ctx.save();

      // 2.5D eğik kamera: host ile AYNI girdilerden (arena + viewport + sabit
      // tema) kurulur, bu yüzden sahne birebir eşleşir. Masa zemini `drawField25d`.
      const proj = scene.open(ctx, {
        viewport: { width, height },
        arena,
        theme: ARCHER_THEME_25D,
      });

      drawArcherArena(
        ctx,
        arena,
        frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h })),
        { roundId: frame.roundId, proj },
      );
      drawArcherPickups(
        ctx,
        frame.pickups.map(([x, y, type, animTime, size]) => ({ x, y, type, animTime, size })),
        proj,
      );
      drawArcherArrows(
        ctx,
        frame.arrows.map(([x, y, vx, vy, color]) => ({ x, y, vx, vy, color })),
        arena,
        proj,
      );
      const players = frame.players.map((p) => ({
        ...p,
        index: p.slot,
        color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || '#D84727',
        avatar: slots?.[p.slot]?.avatar || null,
      }));
      drawArcherPlayers(ctx, players, {
        showFx: frame.gameState === 'PLAYING',
        selfSlot: context.selfSlot ?? -1,
        proj,
      });
      scene.close(ctx);

      // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
      drawArcherFxLayer(ctx, fxLive
        ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
        : {
            pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
            rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
            particles: (frame.particles || []).map((pt) => ({
              x: pt.x, y: pt.y, vx: 0, vy: 0,
              life: (pt.alpha ?? 0), maxLife: 1,
              size: pt.radius ?? 3, color: pt.color,
            })),
          }, proj);
      ctx.restore();

      // Kill flaşı ekran-space: playback mandalı açıkken oynatıcıdan, değilse
      // host paketinden okunur (tek kaynak kuralı).
      const fxSrc = fxLive ? context.fx : frame.fx;
      const flashAlpha = fxFlashAlpha(fxSrc?.flash, fxSrc?.flashPeak);
      if (flashAlpha > 0) drawFxFlash(ctx, width, height, flashAlpha);

      if (frame.gameState === 'ROUND_OVER') {
        drawWorldRoundBanner(ctx, width, height, frame, slots, context);
      } else if (frame.gameState === 'MATCH_OVER') {
        drawWorldMatchOver(ctx, width, height, frame, slots, {
          headline: frame.matchDraw ? t('game.draw') : t('archer.champ'),
          enter: context.matchOverEnter,
        });
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height, '#D6D3CD');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
