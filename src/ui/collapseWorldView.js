// Client-only Collapse world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawCollapseFalling,
  drawCollapseGrid,
  drawCollapseWaves,
  drawCollapsePickups,
  drawCollapsePlayers,
  drawCollapseFxLayer,
  isValidCollapseWorldFrame,
} from '../games/collapseView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { drawFloatingTextSnapshotList } from './hud.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const COLLAPSE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidCollapseWorldFrame,

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
      const withFx = frame.gameState === 'PLAYING';

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'COLLAPSE' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawCollapseFalling(ctx, frame.falling || []);
        drawCollapseGrid(ctx, arena, frame.cell, frame.grid, frame.warn, { withFx, now });
        drawCollapseWaves(ctx, frame.waves || []);
        drawCollapsePickups(ctx, frame.pickups || [], now);
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || COLLAPSE_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        // Yüz tehlikesi grid'den türetilir, pakete alan eklenmez.
        const cols = 13;
        const rows = 13;
        const cell = frame.cell || 0;
        drawCollapsePlayers(ctx, players, {
          selfSlot: context.selfSlot ?? -1,
          gridStates: frame.grid,
          warn: frame.warn,
          cell,
          offsetX: arena.cx - (cols * cell) / 2,
          offsetY: arena.cy - (rows * cell) / 2,
        });
        // Yüzen metin (SİSTEM 3): host ilerletip paketlediği için client
        // SAF çizim yapar (listeyi ilerletmek metni iki kez hızlandırırdı).
        drawFloatingTextSnapshotList(ctx, frame.texts);
        // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
        drawCollapseFxLayer(ctx, fxLive
          ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
          : {
              pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
              rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
              particles: frame.particles || [],
            });
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
      renderWorldPlaceholder(ctx, width, height, '#141414');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
