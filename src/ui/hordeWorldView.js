// Client-only Horde world renderer. Simülasyon/fizik/AI çalıştırmaz.

import {
  drawHordeParticles,
  drawHordeWorld,
  hordeHeaderStatus,
  hordeSceneFromFrame,
  isValidHordeWorldFrame,
} from '../games/hordeView.js';
import { renderMatchHeader } from './hud.js';
import { t } from '../i18n.js';
import { drawWorldMatchOver, fitWorld, worldScreenBox, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';

const HORDE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2D6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidHordeWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
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
        drawHordeParticles(ctx, frame.particles || []);
      });
      ctx.restore();

      if (frame.gameState === 'MATCH_OVER') {
        drawWorldMatchOver(ctx, width, height, frame, slots, {
          headline: scene.matchResult === 'win' ? t('horde.victory') : t('horde.defeat'),
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
