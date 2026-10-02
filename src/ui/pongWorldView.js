// Client-only PONG world renderer. It never imports or runs the PONG engine/AI.

import {
  drawPongArena,
  drawPongBall,
  drawPongServeTelegraph,
  drawPongPaddles,
  drawPongShockwaves,
  drawPongFxLayer,
  isValidPongWorldFrame,
  pongPaddleBounds,
  PONG_THEME_25D,
} from '../games/pongView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { hashFieldSeed } from '../core/fieldKit.js';
import { TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { groundSpace } from '../core/sceneKit.js';
import { sceneDraw } from '../core/arenaKit.js';
import { drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { t } from '../i18n.js';

const PLAYER_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  // 2.5D sahne zarfı renderer ömrü boyunca yaşar (proj kalıcı). Host ile AYNI
  // girdileri verir (arena + viewport + sabit tema) → sahne birebir eşleşir.
  const scene = createTiltedScene({ camera: TILTED_25D_CAMERA.pong });
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
      // 2.5D eğik kamera: host ile AYNI girdilerden (arena + viewport + sabit
      // tema) kurulur → sahne birebir eşleşir. Masa zemini `drawField25d`
      // içinde boyanır, bu yüzden `paintBackdrop` çağrılmaz.
      const proj = scene.open(ctx, { viewport: { width, height }, arena, theme: PONG_THEME_25D });
      drawPongArena(ctx, arena, frame.goals, { seed: hashFieldSeed('PONG', frame.roundId), proj });
      // Canlı katman zemin düzleminde, derinlik kuyruğuyla (taban-Y sırası):
      // raketler ray hizasında olduğundan sıralama alt rayın örtmesini engeller.
      groundSpace(ctx, proj, (c) => drawPongShockwaves(c, frame.ball?.shockwaves));
      for (const pd of frame.players || []) {
        const pb = pd?.joined && pd?.alive ? pongPaddleBounds(pd) : null;
        if (!pb) { groundSpace(ctx, proj, (c) => drawPongPaddles(c, [pd], arena, colors)); continue; }
        sceneDraw(ctx, pb.y + pb.h, (c, p) => groundSpace(c, p, (g2) => drawPongPaddles(g2, [pd], arena, colors)), proj);
      }
      {
        const b = frame.ball;
        const br = Math.max(1, Number(b?.radius) || 11);
        sceneDraw(ctx, (Number(b?.y) || arena.cy) + br, (c, p) => groundSpace(c, p, (g2) => {
          // Host ile aynı servis telegrafı: raunt öncesi yön oku + arkadaki iz.
          if (frame.gameState === 'ROUND_PAUSE') drawPongServeTelegraph(g2, b, arena);
          drawPongBall(g2, b);
        }), proj);
      }
      drawPongFxLayer(ctx, fxLive
        ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
        : {
            pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
            rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
            particles: frame.particles || [],
          }, proj);
      scene.close(ctx);
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
