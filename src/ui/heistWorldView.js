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
} from '../games/heistView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  return {
    validate: isValidHeistWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (tanks deseni). Yoksa
      // v1 host'un paketlediği anlık görüntü (yedek kanal).
      const fxLive = !!context.fx;
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      arena.size = Math.min(arena.width, arena.height);

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'HEIST' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawHeistArena(ctx, arena, frame.pillars.map(([x, y, w, h]) => ({ x, y, w, h })), { roundId: frame.roundId });
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || '#D99B26',
          avatar: slots?.[p.slot]?.avatar || null,
          name: slots?.[p.slot]?.name || `P${p.slot + 1}`,
        }));
        drawHeistVaults(
          ctx,
          frame.vaults.map(([x, y, w, h, playerIndex]) => ({ x, y, w, h, playerIndex })),
          players,
        );
        drawHeistLoot(ctx, frame.loot.map(([x, y, radius, type]) => ({ x, y, radius, type })));
        drawHeistPiggy(ctx, frame.piggy);
        drawHeistPlayers(ctx, players, { withFx: frame.gameState === 'PLAYING', arena });
        // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
        drawHeistFxLayer(ctx, fxLive
          ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
          : {
              pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
              rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
              particles: frame.particles || [],
            });
        drawHeistTexts(ctx, frame.texts || []);
      });
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
