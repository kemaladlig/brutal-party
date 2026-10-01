// Client-only Curve world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.
// Trail çift katman: yakın segmentler tam çizilir, eski izler 24x24 sahiplik maskesiyle kaba temsil edilir.

import {
  unpackCurveFieldMask,
  unpackCurveGapMask,
  drawCurveArena,
  drawCurveFieldMask,
  drawCurveNearSegments,
  drawCurveHeads,
  drawCurvePickups,
  drawCurveFxLayer,
  isValidCurveWorldFrame,
} from '../games/curveView.js';
import { drawAlphaTexts, drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { arenaUnit, paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const CURVE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidCurveWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (çift çizim).
      const fxLive = !!context.fx;
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.size = Math.min(arena.width, arena.height);

      ctx.save();
      // Sahanın dışı (masa) — `fieldKit` tek sahibi, tema tonundan türer.
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'CURVE' });
      fitWorld(ctx, width, height, frame.arena, () => {
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || CURVE_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        const colors = players.map((p) => p.color);

        drawCurveArena(ctx, arena, { roundId: frame.roundId });
        drawCurveFieldMask(ctx, { x: left, y: top, s: arena.size }, unpackCurveFieldMask(frame.field), colors, unpackCurveGapMask(frame.gaps));
        // Birim host'la Aynı yoldan: `arena.unit` pakette yok, `fieldKit`'in
        // tek otoritesi `arenaUnit` bunu kırpılmış `size/952` olarak türetir.
        // Ham `size / 952` yazmak küçük sahada host'un altına düşüyordu.
        drawCurveNearSegments(ctx, frame.near || [], colors, arenaUnit(arena));
        drawCurvePickups(ctx, frame.pickups || []);
        drawAlphaTexts(ctx, frame.texts || [], { size: 12, outline: true });
        drawCurveFxLayer(ctx, fxLive
          ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
          : {
              pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
              rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
              particles: frame.particles || [],
            });
        drawCurveHeads(ctx, players);
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
      renderWorldPlaceholder(ctx, width, height, '#F4F4F0');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
