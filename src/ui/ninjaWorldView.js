// Client-only Ninja world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.
// Görünmezlik karşılıklıdır: rakip hayaletler çizilmez, yalnız kendi koltuğuna
// (selfSlot) hayalet kontur gösterilir.

import {
  drawNinjaArena,
  drawNinjaFrame,
  drawNinjaSteps,
  drawNinjaDecals,
  drawNinjaLanterns,
  drawNinjaGhosts,
  drawNinjaPlayers,
  drawNinjaSlashes,
  drawNinjaImpacts,
  drawNinjaFxLayer,
  isValidNinjaWorldFrame,
} from '../games/ninjaView.js';
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const NINJA_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidNinjaWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (çift çizim).
      const fxLive = !!context.fx;
      const [left, top, right, bottom] = frame.arena;
      const arenaW = Math.max(1, right - left);
      const arenaH = Math.max(1, bottom - top);
      // `size`/`unit`: client tarafında da hamle ölçeği. Kesik animasyonunun
      // kademe/aura px'leri bu ölçekle çizilir, yoksa telefonda kılıç
      // menzilden uzun görünür.
      const size = Math.min(arenaW, arenaH);
      const arena = {
        left, top, right, bottom, width: arenaW, height: arenaH,
        size, unit: Math.max(0.3, Math.min(1.6, size / 952)),
      };
      const withFx = frame.gameState === 'PLAYING';

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'NINJA' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawNinjaArena(ctx, arena, { roundId: frame.roundId });
        drawNinjaSteps(ctx, frame.steps || []);
        drawNinjaDecals(ctx, frame.decals || []);
        drawNinjaLanterns(ctx, frame.lanterns || [], now);
        drawNinjaFrame(ctx, arena, frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h })));
        drawNinjaGhosts(ctx, frame.ghosts || []);
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || NINJA_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawNinjaPlayers(ctx, players, { ghostSlots: Number.isInteger(context?.selfSlot) && context.selfSlot >= 0 ? [context.selfSlot] : [], withFx, selfSlot: context.selfSlot ?? -1 });
        drawNinjaSlashes(ctx, frame.slashes || [], arena);
        drawNinjaImpacts(ctx, frame.impacts || []);
        drawNinjaFxLayer(ctx, fxLive
          ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
          : {
              pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
              rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
              particles: frame.particles || [],
            });
      });
      ctx.restore();

      // Eleme flaşı ekran-space: playback mandalı açıkken oynatıcıdan, değilse
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
