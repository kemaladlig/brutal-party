// Client-only Zone world renderer. Simülasyon/fizik çalıştırmaz; yalnız host'un
// yayınladığı WORLD_FRAME snapshot'ını doğrular ve çizer.
// 64x64 bölge grid'i RLE'den unpack edilip offscreen katmana yeniden kurulur.

import {
  unpackZoneGridRle,
  drawZoneField,
  drawZonePlayers,
  drawZoneWaves,
  isValidZoneWorldFrame,
  ZONE_GRID,
} from '../games/zoneView.js';
import { drawSquareParticles, drawAlphaTexts } from '../games/worldCore.js';
import { fitWorld, drawWorldBanner, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const ZONE_FALLBACK = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export function createWorldViewRenderer() {
  return {
    validate: isValidZoneWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now()) {
      const [left, top, right, bottom] = frame.arena;
      const arena = { left, top, right, bottom, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
      arena.cx = (left + right) / 2;
      arena.cy = (top + bottom) / 2;
      const withFx = frame.gameState === 'PLAYING';
      const nowSec = now / 1000;

      ctx.save();
      ctx.fillStyle = '#F4F4F0';
      ctx.fillRect(0, 0, width, height);
      fitWorld(ctx, width, height, frame.arena, () => {
        ctx.fillStyle = '#FAF7F2';
        ctx.fillRect(left, top, arena.width, arena.height);

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
        );
        drawZoneWaves(ctx, frame.waves || [], frame.cell);
        drawZonePlayers(ctx, players, { cell: frame.cell, leaderIndex: frame.leader, withFx });
        drawSquareParticles(ctx, frame.particles || []);
        drawAlphaTexts(ctx, (frame.texts || []).map((ft) => ({
          x: ft.x, y: ft.y, text: ft.text, alpha: ft.maxLife > 0 ? ft.life / ft.maxLife : 0, color: ft.color,
        })));
      });
      ctx.restore();

      if (frame.gameState === 'ROUND_OVER') {
        const winner = slots?.[frame.roundWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.roundOver'), winner || '');
      } else if (frame.gameState === 'MATCH_OVER') {
        const winner = slots?.[frame.matchWinner]?.name;
        drawWorldBanner(ctx, width, height, t('game.champWon'), winner || '');
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
