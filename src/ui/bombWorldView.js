// Client-only Bomb world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawBombArena,
  drawBombInk,
  drawBombPickups,
  drawBombPlayers,
  drawBombBlast,
  drawBombFxLayer,
  isValidBombWorldFrame,
  bombThemeForMap,
} from '../games/bombView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { arenaFromRect, TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';

export function createWorldViewRenderer() {
  // 2.5D sahne zarfı renderer ömrü boyunca yaşar (proj kalıcı; kare başına
  // tahsis yok). Host ile AYNI girdileri verir → sahne birebir eşleşir.
  const scene = createTiltedScene({ camera: TILTED_25D_CAMERA.bomb });
  return {
    validate: isValidBombWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (tanks deseni). Yoksa
      // v1 host'un paketlediği anlık görüntü (yedek kanal).
      const fxLive = !!context.fx;
      const arena = arenaFromRect(frame.arena);

      ctx.save();

      // 2.5D eğik kamera: host ile AYNI girdilerden (arena + viewport + tema)
      // kurulur, bu yüzden sahne birebir eşleşir. Tema host paketindeki
      // `mapIndex`ten türetilir; masa zemini `drawField25d` içinde.
      const proj = scene.open(ctx, {
        viewport: { width, height },
        arena,
        theme: bombThemeForMap(frame.mapIndex),
      });

      const pillars = frame.pillars.map(([x, y, w, h]) => ({ x, y, w, h }));
      const carrierIndex = frame.carrier;
      const carrier = frame.players.find((p) => p.slot === carrierIndex) || null;
      // 2.5D derinlik penceresi — host ile birebir aynı (sceneBegin/sceneEnd).
      drawBombArena(ctx, arena, pillars, /** @type {any} */ ({
        carrier: carrier ? { ...carrier, alive: carrier.alive } : null,
        bombTimer: frame.bombTimer,
        bombMaxTime: frame.bombMaxTime,
        proj,
      }));
      drawBombInk(ctx, frame.ink.map(([x, y, radius]) => ({ x, y, radius })), proj);
      drawBombPickups(ctx, frame.pickups.map(([x, y, type, animTime, size2]) => ({ x, y, type, animTime, size: size2 })), proj);
      const players = frame.players.map((p) => ({
        ...p,
        index: p.slot,
        carrier: p.slot === frame.carrier,
        color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || UI_COLORS.crownRed,
        avatar: slots?.[p.slot]?.avatar || null,
      }));
      drawBombPlayers(ctx, players, {
        bombTimer: frame.bombTimer,
        bombMaxTime: frame.bombMaxTime,
        withFx: frame.gameState === 'PLAYING',
        arena,
        selfSlot: context.selfSlot ?? -1,
        proj,
      });
      scene.close(ctx);
      drawBombBlast(ctx, frame.blast, arena, proj);
      // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
      drawBombFxLayer(ctx, fxLive
        ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
        : {
            pops: (frame.fx?.pops || []).map(([x, y, size2, angle, life, maxLife, color]) => ({ x, y, size: size2, angle, life, maxLife, color })),
            rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width2, color]) => ({ x, y, r0, r1, life, maxLife, width: width2, color })),
            particles: (frame.particles || []).map((pt) => ({
              x: pt.x, y: pt.y, vx: 0, vy: 0,
              life: pt.life ?? 0, maxLife: pt.maxLife ?? 1,
              size: pt.size ?? 3, color: pt.color,
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
        drawWorldMatchOver(ctx, width, height, frame, slots, { enter: context.matchOverEnter });
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height, UI_COLORS.crownPaper);
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
