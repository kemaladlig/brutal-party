// Client-only Heist world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawHeistArena,
  drawHeistVaults,
  drawHeistLoot,
  drawHeistPiggy,
  drawHeistPlayers,
  drawHeistTexts,
  drawHeistFxLayer,
  isValidHeistWorldFrame,
  HEIST_THEME_25D,
} from '../games/heistView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { sceneDraw, entitySceneY } from '../core/arenaKit.js';
import { arenaFromRect, TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  // 2.5D sahne zarfı renderer ömrü boyunca yaşar (proj kalıcı; kare başına
  // tahsis yok). Host ile AYNI girdileri verir → sahne birebir eşleşir.
  const scene = createTiltedScene({ camera: TILTED_25D_CAMERA.heist });
  return {
    validate: isValidHeistWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (tanks deseni). Yoksa
      // v1 host'un paketlediği anlık görüntü (yedek kanal).
      const fxLive = !!context.fx;
      const arena = arenaFromRect(frame.arena);

      ctx.save();
      // 2.5D eğik kamera: host ile AYNI girdilerden (arena + viewport + sabit
      // tema) kurulur; masa zemini `drawField25d` içinde boyanır.
      const proj = scene.open(ctx, { viewport: { width, height }, arena, theme: HEIST_THEME_25D });

      drawHeistArena(ctx, arena, frame.pillars.map(([x, y, w, h]) => ({ x, y, w, h })), { roundId: frame.roundId, proj });
      const players = frame.players.map((p) => ({
        ...p,
        index: p.slot,
        color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || UI_COLORS.crownGold,
        avatar: slots?.[p.slot]?.avatar || null,
        name: slots?.[p.slot]?.name || `P${p.slot + 1}`,
      }));
      drawHeistVaults(
        ctx,
        frame.vaults.map(([x, y, w, h, playerIndex]) => ({ x, y, w, h, playerIndex })),
        players,
        proj,
      );
      drawHeistLoot(ctx, frame.loot.map(([x, y, radius, type]) => ({ x, y, radius, type })), proj);
      if (frame.piggy) {
        // Kumbara derinlik kuyruğunda (oyuncu/engelle sıralanır).
        sceneDraw(ctx, entitySceneY(frame.piggy.y, frame.piggy.radius || 18), drawHeistPiggy, frame.piggy, proj);
      }
      drawHeistPlayers(ctx, players, {
        withFx: frame.gameState === 'PLAYING',
        arena,
        selfSlot: context.selfSlot ?? -1,
        proj,
      });
      scene.close(ctx);

      // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
      drawHeistFxLayer(ctx, fxLive
        ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
        : {
            pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
            rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
            particles: frame.particles || [],
          }, proj);
      drawHeistTexts(ctx, frame.texts || [], proj);
      ctx.restore();

      // Kill flaşı ekran-space: playback mandalı açıkken oynatıcıdan, değilse
      // host paketinden okunur (tek kaynak kuralı).
      const fxSrc = fxLive ? context.fx : frame.fx;
      const flashAlpha = fxFlashAlpha(fxSrc?.flash, fxSrc?.flashPeak);
      if (flashAlpha > 0) drawFxFlash(ctx, width, height, flashAlpha);

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
