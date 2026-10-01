// Client-only PONG world renderer. It never imports or runs the PONG engine/AI.

import {
  drawPongArena,
  drawPongBall,
  drawPongServeTelegraph,
  drawPongPaddles,
  drawPongShockwaves,
  drawPongFxLayer,
  isValidPongWorldFrame,
} from '../games/pongView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { hashFieldSeed, paintBackdrop } from '../core/fieldKit.js';
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { t } from '../i18n.js';

const PLAYER_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidPongWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx YOK SAYILIR (çift çizim = çift partikül).
      const fxLive = !!context.fx;
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
      const colors = frame.players.map((player) => (
        slots?.[player.slot]?.color || PLAYER_FALLBACK[player.slot] || PLAYER_FALLBACK[0]
      ));

      ctx.save();
      // Sahanın dışı EKRAN uzayında çizilir; arenanın ekran kutusu `worldScreenBox`
      // ile çözülür — dünya koordinatlarıyla çağrılırsa gölge sahadan kayar.
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'PONG' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawPongArena(ctx, arena, frame.goals, { seed: hashFieldSeed('PONG', frame.roundId) });
        drawPongShockwaves(ctx, frame.ball?.shockwaves);
        drawPongPaddles(ctx, frame.players, arena, colors);
        // Host ile aynı servis telegrafı: raunt öncesi yön oku + arkadaki iz.
        if (frame.gameState === 'ROUND_PAUSE') drawPongServeTelegraph(ctx, frame.ball, arena);
        drawPongBall(ctx, frame.ball);
        drawPongFxLayer(ctx, fxLive
          ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
          : {
              pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
              rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
              particles: frame.particles || [],
            });
      });
      ctx.restore();

      // Gol flaşı ekran-space: playback mandalı açıkken oynatıcıdan, değilse
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
