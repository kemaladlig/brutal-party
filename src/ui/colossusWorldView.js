// Client-only COLOSSUS world renderer. Simülasyon/fizik/AI çalıştırmaz.

import {
  colossusHeaderStatus,
  colossusSceneFromFrame,
  drawColossusWorld,
  isValidColossusWorldFrame,
} from '../games/colossusView.js';
import { drawFxFlash } from '../games/worldCore.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { renderMatchHeader } from './hud.js';
import { t } from '../i18n.js';
import { fitWorld, worldScreenBox, drawWorldMatchOver, renderWorldPlaceholder, renderWorldStale } from './worldViewKit.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { UI_COLORS } from './tokens.js';

const PLAYER_FALLBACK = ['#F0483C', '#2B7FC4', '#FFD24A', '#35B36A'];

export function createWorldViewRenderer() {
  return {
    validate: isValidColossusWorldFrame,

    render(ctx, frame, width, height, slots = [], now = performance.now(), context = {}) {
      // FX kaynağı (MOTION_PLAN 2.2): playback mandalı açıksa `context.fx`, yoksa
      // host'un paketlediği anlık görüntü (tanks deseni) — tek sahip kuralı.
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

      const scene = colossusSceneFromFrame(frame);
      scene.players = scene.players.map((player) => ({
        ...player,
        color: slots?.[player.slot]?.color || slots?.[player.slot]?.displayColor || UI_COLORS.players?.[player.slot] || PLAYER_FALLBACK[player.slot],
      }));

      ctx.save();
      paintBackdrop(ctx, { width, height }, worldScreenBox(width, height, frame.arena), { mode: 'COLOSSUS' });
      fitWorld(ctx, width, height, frame.arena, () => {
        drawColossusWorld(ctx, arena, scene, { now, roundId: frame.roundId, selfSlot: context.selfSlot ?? -1 });
        // Tek skorbordu yüzeyi (AGENTS §5): isimler + skor + faz/sersemleme
        // durumu. Boss HP çubuğu sahnenin içinde çiziliyor, burada tekrarlanmıyor.
        const header = colossusHeaderStatus(scene);
        const headerPlayers = [0, 1, 2, 3].map((i) => {
          const sp = scene.players.find((player) => player.slot === i);
          const s = slots?.[i];
          const joined = sp ? sp.joined !== false : !!s;
          if (!joined) return null;
          return {
            index: i,
            name: s?.name || `P${i + 1}`,
            color: s?.color || s?.displayColor || sp?.color || PLAYER_FALLBACK[i],
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
      });
      ctx.restore();

      // Ekran-uzayı flaşı: playback mandalı açıkken oynatıcıdan, değilse host
      // paketinden okunur.
      const fxSrc = fxLive ? context.fx : frame.fx;
      const flashAlpha = fxFlashAlpha(fxSrc?.flash, fxSrc?.flashPeak);
      if (flashAlpha > 0) drawFxFlash(ctx, width, height, flashAlpha);

      if (scene.matchOver) {
        // Co-op: kazanan tek koltuk değil, takım — jenerik "champ won" yanlış.
        drawWorldMatchOver(ctx, width, height, frame, slots, {
          headline: scene.victory ? t('colossus.victory') : t('colossus.defeat'),
          enter: context.matchOverEnter,
        });
      }
    },

    renderPlaceholder(ctx, width, height) {
      renderWorldPlaceholder(ctx, width, height, '#1E293B');
    },

    renderStale(ctx, width, height) {
      renderWorldStale(ctx, width, height);
    },
  };
}
