// tests/hudBand.test.mjs
// Faz 3.4 — HUD bandı ↔ oyun alanı dokunmazlığı (geniş viewport) ve kenar
// sayacı `inset`inin HALKA YARIÇAPINDAN türemesi (yalnız metin yüksekliğinden
// DEĞİL) kilidi. Bilinen tuzak: inset metin yüksekliğine bağlanırsa halka
// arenanın üst bandına taşar. Kilit, üretimdeki `computeArenaTimerLayout`u
// doğrudan yükler (formülü testte yeniden yazmaz).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Geniş/uzun viewport seti: masaüstü, ultrawide, 16:10 tablet, 21:9.
const WIDE = [
  [1280, 720], [1366, 768], [1600, 900], [1180, 820],
  [1920, 1080], [2560, 1080], [3440, 1440], [3840, 2160], [5120, 1440],
];

let server;
let computePlayfield;
let getUiScale;
let computeArenaTimerLayout;

test.before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  ({ computePlayfield } = await server.ssrLoadModule('/src/core/playfield.js'));
  ({ getUiScale } = await server.ssrLoadModule('/src/ui/tokens.js'));
  ({ computeArenaTimerLayout } = await server.ssrLoadModule('/src/ui/hud.js'));
});

test.after(async () => {
  await server?.close();
});

test('kenar sayacı inset halka yarıçapından türer ve halka arenada kalır (geniş viewport)', () => {
  for (const [w, h] of WIDE) {
    const arena = computePlayfield(w, h, 'standard');
    const scale = getUiScale(arena);
    const minDim = Math.min(arena.width, arena.height);
    for (const sizeScale of [1, 0.72]) {
      const { mainFontSize, ringR, inset } = computeArenaTimerLayout({ scale, minDim, sizeScale });
      assert.ok(
        inset >= ringR - 1e-9,
        `${w}x${h} ss=${sizeScale}: inset ${inset} < ringR ${ringR} — halka sahaya taşar`,
      );
      // Halkanın üst kenarı (inset - ringR) arena üstünün dışına çıkmaz.
      assert.ok(
        arena.top + inset - ringR >= arena.top - 1e-9,
        `${w}x${h}: halka arena üstünü aşıyor`,
      );
      // Bant oyun alanını yutmasın.
      assert.ok(
        inset <= arena.height * 0.5,
        `${w}x${h}: inset ${inset} sahanın yarısından büyük`,
      );
      // Tuzak kanıtı: bu viewportlarda metin-yüksekliği türevi ringR'yi geçemez,
      // yani "metin yüksekliğinden inset" formülü yukarıdaki kilidi kırar.
      if (minDim >= 720) {
        assert.ok(
          ringR > mainFontSize,
          `${w}x${h}: ringR ${ringR} metin yüksekliği ${mainFontSize}den büyük olmalı (kilidin dişi)`,
        );
      }
    }
  }
});

test('inset geometriyle (minDim) ölçeklenir, metinle sabitlenmez', () => {
  const small = computeArenaTimerLayout({ scale: 1, minDim: 540, sizeScale: 0.72 });
  const large = computeArenaTimerLayout({ scale: 1, minDim: 1080, sizeScale: 0.72 });
  assert.ok(large.inset > small.inset, 'inset minDim ile büyümeli');
  const ratio = large.inset / small.inset;
  assert.ok(
    Math.abs(ratio - 2) < 0.05,
    `inset minDim ile ~2x ölçeklenmeli, ölçülen ${ratio.toFixed(3)}`,
  );
});
