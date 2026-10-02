// Client-only Zone world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.
// 64x64 bölge grid'i RLE'den unpack edilip offscreen katmana yeniden kurulur.

import {
  unpackZoneGridRle,
  drawZoneField,
  drawZonePlayers,
  drawZoneWaves,
  drawZoneFxLayer,
  isValidZoneWorldFrame,
  ZONE_GRID,
  ZONE_THEME_25D,
} from '../games/zoneView.js';
import { drawAlphaTexts, drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const ZONE_FALLBACK = UI_COLORS.players;

export function createWorldViewRenderer() {
  // 2.5D sahne zarfı renderer ömrü boyunca yaşar (proj kalıcı). Host ile AYNI
  // girdileri verir (arena + viewport + sabit tema) → sahne birebir eşleşir.
  const scene = createTiltedScene({ camera: TILTED_25D_CAMERA.zone });
  return {
    validate: isValidZoneWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (çift çizim).
      const fxLive = !!context.fx;
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      const withFx = frame.gameState === 'PLAYING';
      const nowSec = now / 1000;

      ctx.save();
      // 2.5D eğik kamera: host ile AYNI girdilerden kurulur. Bölge ızgarası
      // zemin uzayında (afin) çizilir; masa zemini `drawField25d` içinde.
      const proj = scene.open(ctx, {
        viewport: { width, height },
        arena,
        theme: ZONE_THEME_25D,
      });

      const players = frame.players.map((p) => ({
        ...p,
        index: p.slot,
        color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || ZONE_FALLBACK[p.slot],
        avatar: slots?.[p.slot]?.avatar || null,
      }));

      drawZoneField(
        ctx,
        frame.field,
        frame.cell,
        unpackZoneGridRle(frame.rle),
        players.map((p) => p.color),
        players,
        frame.relics || [],
        nowSec,
        null,
        frame.gridV,
        { roundId: frame.roundId, proj },
      );
      drawZoneWaves(ctx, frame.waves || [], frame.cell, proj);
      drawZonePlayers(ctx, players, { cell: frame.cell, leaderIndex: frame.leader, withFx, selfSlot: context.selfSlot ?? -1, proj });
      scene.close(ctx);
      drawZoneFxLayer(ctx, fxLive
        ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
        : {
            pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
            rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
            particles: frame.particles || [],
          }, proj);
      drawAlphaTexts(ctx, (frame.texts || []).map((ft) => {
        const sp = proj.proj(ft.x, ft.y, 20);
        return {
          x: sp.x, y: sp.y, text: ft.text, alpha: ft.maxLife > 0 ? ft.life / ft.maxLife : 0, color: ft.color,
        };
      }));
      ctx.restore();

      // Kesilme flaşı ekran-space: playback mandalı açıkken oynatıcıdan, değilse
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
