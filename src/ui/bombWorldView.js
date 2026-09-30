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
} from '../games/bombView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { hashFieldSeed, paintBackdrop } from '../core/fieldKit.js';
import { fitWorld, worldScreenBox, drawWorldRoundBanner, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

export function createWorldViewRenderer() {
  return {
    validate: isValidBombWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (tanks deseni). Yoksa
      // v1 host'un paketlediği anlık görüntü (yedek kanal).
      const fxLive = !!context.fx;
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };

      ctx.save();
      // Sahanın dışı EKRAN uzayında çizilir; arenanın ekran kutusu `worldScreenBox`
      // ile çözülür — dünya koordinatlarıyla çağrılırsa gölge sahadan kayar.
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'BOMB' });
      fitWorld(ctx, width, height, frame.arena, () => {
        const pillars = frame.pillars.map(([x, y, w, h]) => ({ x, y, w, h }));
        const carrierIndex = frame.carrier;
        const carrier = frame.players.find((p) => p.slot === carrierIndex) || null;
        drawBombArena(ctx, arena, pillars, /** @type {any} */ ({
          carrier: carrier ? { ...carrier, alive: carrier.alive } : null,
          bombTimer: frame.bombTimer,
          bombMaxTime: frame.bombMaxTime,
          // Host ile aynı dekor: seed `(BOMB, roundId)`'den türer, `roundId`
          // zaten pakette. Ek alan gönderilmez.
          seed: hashFieldSeed('BOMB', frame.roundId),
        }));
        drawBombInk(ctx, frame.ink.map(([x, y, radius]) => ({ x, y, radius })));
        drawBombPickups(ctx, frame.pickups.map(([x, y, type, animTime, size]) => ({ x, y, type, animTime, size })));
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          carrier: p.slot === frame.carrier,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || '#D84727',
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawBombPlayers(ctx, players, {
          bombTimer: frame.bombTimer,
          bombMaxTime: frame.bombMaxTime,
          withFx: frame.gameState === 'PLAYING',
          arena,
        });
        drawBombBlast(ctx, frame.blast, arena);
        // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
        drawBombFxLayer(ctx, fxLive
          ? { pops: context.fx.pops, rings: context.fx.rings, particles: context.fx.particles }
          : {
              pops: (frame.fx?.pops || []).map(([x, y, size, angle, life, maxLife, color]) => ({ x, y, size, angle, life, maxLife, color })),
              rings: (frame.fx?.rings || []).map(([x, y, r0, r1, life, maxLife, width, color]) => ({ x, y, r0, r1, life, maxLife, width, color })),
              particles: (frame.particles || []).map((pt) => ({
                x: pt.x, y: pt.y, vx: 0, vy: 0,
                life: pt.life ?? 0, maxLife: pt.maxLife ?? 1,
                size: pt.size ?? 3, color: pt.color,
              })),
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
      renderWorldPlaceholder(ctx, width, height, '#F4F0EA');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
