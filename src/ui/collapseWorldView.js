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
import { fitWorld, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const COLLAPSE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

function drawAbyss(ctx, width, height) {
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#1F1F1F';
  ctx.lineWidth = Math.max(1, 1 * (Math.min(width, height) / 952));
  const step = 40;
  for (let x = 0; x < width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
}

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
      drawAbyss(ctx, width, height);
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
        drawCollapsePlayers(ctx, players, { selfSlot: context.selfSlot ?? -1 });
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
