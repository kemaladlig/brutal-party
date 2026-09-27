// Görsel taban çizgisi — motor başına saha kırpımı ekran görüntüsü.
// Determinizm: seeded PRNG + kontrollü saat (update/render'a kendi `now`'umuz
// verilir, performance.now da aynı sayaça bağlanır). DOM seçicisi YOK —
// yalnız canvas; akış katmanı refactor'larından etkilenmez.
// Baseline üretimi: npx playwright test --update-snapshots

import { test, expect } from '@playwright/test';

test('engine visual baselines: her GAME_ORDER motoru kare 60ta sahaya çizer', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    let s = 987654321;
    Math.random = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return (s & 0x7fffffff) / 0x7fffffff;
    };
    let fake = 1000;
    window.__setNow = (v) => { fake = v; };
    const realNow = performance.now.bind(performance);
    performance.now = () => fake ?? realNow();
  });

  await page.goto('/favicon.ico');

  const modes = await page.evaluate(async () => {
    const { GAME_ORDER } = await import('/src/core/engineRegistry.js');
    return GAME_ORDER;
  });

  for (const mode of modes) {
    await page.evaluate(async (m) => {
      const { CARTRIDGES } = await import('/src/core/engineRegistry.js');
      const Cls = await CARTRIDGES[m].load();
      document.querySelectorAll('canvas[data-baseline]').forEach((c) => c.remove());
      const canvas = document.createElement('canvas');
      canvas.setAttribute('data-baseline', m);
      canvas.width = 1280;
      canvas.height = 720;
      canvas.style.width = '1280px';
      canvas.style.height = '720px';
      document.body.appendChild(canvas);
      document.body.style.margin = '0';
      const game = new Cls(canvas);
      game.resize(1280, 720);
      game.startNewMatch();
      let now = 1000;
      for (let i = 0; i < 60; i++) {
        now += 16.7;
        window.__setNow(now);
        game.update(now);
        game.render();
      }
    }, mode);

    await expect(page.locator(`canvas[data-baseline="${mode}"]`)).toHaveScreenshot(`${mode}.png`, {
      maxDiffPixelRatio: 0.02,
      timeout: 30_000,
    });
  }
});
