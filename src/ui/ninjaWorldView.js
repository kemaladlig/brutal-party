// Client-only Ninja world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.
// Görünmezlik karşılıklıdır: rakip hayaletler çizilmez, yalnız kendi koltuğuna
// (selfSlot) hayalet kontur gösterilir.

import {
  drawNinjaArena,
  drawNinjaFrame,
  drawNinjaSteps,
  drawNinjaDecals,
  drawNinjaLanterns,
  drawNinjaGhosts,
  drawNinjaPlayers,
  drawNinjaSlashes,
  drawNinjaImpacts,
  drawNinjaFx,
  isValidNinjaWorldFrame,
} from '../games/ninjaView.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const NINJA_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidNinjaWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), selfSlot = -1) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      const withFx = frame.gameState === 'PLAYING';

      ctx.save();
      ctx.fillStyle = '#F4F0EA';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        drawNinjaArena(ctx, arena);
        drawNinjaSteps(ctx, frame.steps || []);
        drawNinjaDecals(ctx, frame.decals || []);
        drawNinjaLanterns(ctx, frame.lanterns || [], now);
        drawNinjaFrame(ctx, arena, frame.obstacles.map(([x, y, w, h]) => ({ x, y, w, h })));
        drawNinjaGhosts(ctx, frame.ghosts || []);
        const players = frame.players.map((p) => ({
          ...p,
          index: p.slot,
          color: slots?.[p.slot]?.color || UI_COLORS.players[p.slot] || NINJA_FALLBACK[p.slot],
          avatar: slots?.[p.slot]?.avatar || null,
        }));
        drawNinjaPlayers(ctx, players, { ghostSlots: Number.isInteger(selfSlot) && selfSlot >= 0 ? [selfSlot] : [], withFx });
        drawNinjaSlashes(ctx, frame.slashes || []);
        drawNinjaImpacts(ctx, frame.impacts || []);
        drawNinjaFx(ctx, frame.fx || []);
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        const winner = slots?.[frame.roundWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.roundOver'), winner || '');
      } else if (frame.gameState === 'MATCH_OVER') {
        const winner = slots?.[frame.matchWinner]?.name;
        drawWorldBanner(ctx, width, height, frame.matchDraw ? t('game.draw') : t('game.champWon'), winner || '');
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
