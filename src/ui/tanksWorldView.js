// Client-only Tanks world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.

import {
  drawTanksArena,
  drawTanksBullets,
  drawTanksTracers,
  drawTanksCrates,
  drawTanksTanks,
  drawTanksFxLayer,
  TANKS_THEME_25D,
  isValidTanksWorldFrame,
} from '../games/tanksView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const TANK_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  // 2.5D sahne zarfı renderer ömrü boyunca yaşar (proj kalıcı). Host ile AYNI
  // girdileri verir (arena + viewport + sabit tema) → sahne birebir eşleşir.
  const scene = createTiltedScene({ camera: TILTED_25D_CAMERA.tanks });
  return {
    validate: isValidTanksWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (çift çizim = çift
      // partikül). Yoksa v1 host'un paketlediği anlık görüntü (yedek kanal).
      const fxLive = !!context.fx;
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      arena.size = Math.min(arena.width, arena.height);

      ctx.save();
      // 2.5D eğik kamera: host ile AYNI girdilerden kurulur.
      const proj = scene.open(ctx, {
        viewport: { width, height },
        arena,
        theme: TANKS_THEME_25D,
      });
      drawTanksArena(
        ctx,
        arena,
        frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h })),
        frame.suddenDeath,
        { roundId: frame.roundId, proj },
      );
      const ownerColors = frame.players.map((p) => slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || TANK_FALLBACK[p.slot]);
      drawTanksBullets(ctx, frame.bullets.map(([x, y, radius, owner, vx, vy]) => ({ x, y, radius, owner, vx, vy })), ownerColors, proj);
      drawTanksTracers(ctx, frame.tracers || [], arena, proj);
      drawTanksCrates(ctx, frame.crates.map(([x, y, size, type]) => ({ x, y, size, type })), proj);
      const tanks = frame.players.map((p) => ({
        ...p,
        index: p.slot,
        color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || TANK_FALLBACK[p.slot],
        avatar: slots?.[p.slot]?.avatar || null,
      }));
      drawTanksTanks(ctx, tanks, { arena, withFx: frame.gameState === 'PLAYING', selfSlot: context.selfSlot ?? -1, proj });
      scene.close(ctx);
      // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
      drawTanksFxLayer(ctx, fxLive
        ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
        : {
            pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
            rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
            particles: frame.particles || [],
          }, proj);
      if (frame.intro?.active) {
        // Geri sayım metni ekran-uzayı: projekte merkezde dik okunur.
        const ctr = proj.proj(arena.cx, arena.cy, 0);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1A1A1A';
        ctx.font = '900 34px "Space Grotesk", sans-serif';
        ctx.fillText(String(Math.max(1, Math.ceil(frame.intro.time))), ctr.x, ctr.y);
        ctx.restore();
      }
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
