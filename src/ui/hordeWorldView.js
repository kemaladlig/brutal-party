// Client-only Horde world renderer. Simülasyon/fizik/AI çalıştırmaz.

import {
  drawHordeFxLayer,
  drawHordeWorld,
  hordeHeaderStatus,
  hordeSceneFromFrame,
  isValidHordeWorldFrame,
} from '../games/hordeView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { renderMatchHeader } from './hud.js';
import { t } from '../i18n.js';
import { drawWorldMatchOver, fitWorld, worldScreenBox, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';

const HORDE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2D6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidHordeWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): olay playback'i (`context.fx`) varsa O
      // çizer ve frame.fx/frame.particles YOK SAYILIR (tanks deseni). Yoksa
      // v1 host'un paketlediği anlık görüntü (yedek kanal).
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
      };
      const scene = hordeSceneFromFrame(frame);
      scene.players = scene.players.map((player) => ({
        ...player,
        color: slots?.[player.slot]?.color || slots?.[player.slot]?.displayColor || UI_COLORS.players?.[player.slot] || HORDE_FALLBACK[player.slot],
        expression: slots?.[player.slot]?.avatar?.expression || player.expression,
      }));

      ctx.save();
      // Sahanın dışı EKRAN uzayında çizilir; arenanın ekran kutusu `worldScreenBox`
      // ile çözülür — dünya koordinatlarıyla çağrılırsa gölge sahadan kayar.
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { theme: scene.theme });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawHordeWorld(ctx, arena, scene, { withFx: frame.gameState === 'PLAYING', now });
        const header = hordeHeaderStatus({ ...scene, state: scene.phase, hasPortal: scene.portal != null });
        const headerPlayers = [0, 1, 2, 3].map((i) => {
          const sp = scene.players.find((player) => player.slot === i);
          const s = slots?.[i];
          const joined = sp ? sp.joined !== false : !!s;
          if (!joined) return null;
          return {
            index: i,
            name: s?.name || `P${i + 1}`,
            color: s?.color || s?.displayColor || sp?.color || HORDE_FALLBACK[i],
            isJoined: true,
          };
        });
        renderMatchHeader(ctx, {
          arena,
          players: headerPlayers,
          scores: frame.scores || [0, 0, 0, 0],
          statusText: header.text,
          statusTone: header.tone,
        });
        // FX katmanı: olay playback'i (`context.fx`) ya da paket yükü.
        drawHordeFxLayer(ctx, fxLive
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

      if (frame.gameState === 'MATCH_OVER') {
        drawWorldMatchOver(ctx, width, height, frame, slots, {
          headline: scene.matchResult === 'win' ? t('horde.victory') : t('horde.defeat'),
          enter: context.matchOverEnter,
        });
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
