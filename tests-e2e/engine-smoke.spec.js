// Motor duman matrisi — AGENTS.md §3 sözleşmesinin çalışma zamanı gardı.
// Her GAME_ORDER motoru registry üzerinden yüklenir: LOBBY render →
// startNewMatch → 240 sürücü kare (update+render, 16.7 ms saati).
// Amaç oyun kalitesi değil: contract drift/throw yakalama (tip lint'in
// göremediği çalışma zamanı sınıfı). UI seçicisi kullanılmaz — registry
// tek giriş noktasıdır ve akıştan bağımsızdır.

import { test, expect } from '@playwright/test';

test('engine smoke matrix: tüm GAME_ORDER motorları 240 kare hatasız döner', async ({ page }) => {
  test.setTimeout(180_000);
  const asyncErrors = [];
  page.on('pageerror', (err) => asyncErrors.push(String(err).slice(0, 300)));

  // favicon: aynı origin, sıfır script — main.js/SW yönlendirmesi bağlamı yok etmez.
  await page.goto('/favicon.ico');

  const results = await page.evaluate(async () => {
    const { GAME_ORDER, CARTRIDGES } = await import('/src/core/engineRegistry.js');
    const out = [];
    for (const mode of GAME_ORDER) {
      const cart = CARTRIDGES[mode];
      if (!cart) { out.push({ mode, ok: false, error: 'CARTRIDGES kaydı yok (§3)' }); continue; }
      let canvas = null;
      try {
        const Cls = await cart.load();
        canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        canvas.style.width = '1280px';
        canvas.style.height = '720px';
        document.body.appendChild(canvas);
        const game = new Cls(canvas);
        if (typeof game.resize === 'function') game.resize(1280, 720);
        if (typeof game.render !== 'function') throw new Error('render yok (§3 sözleşmesi)');
        game.render(); // LOBBY
        if (typeof game.startNewMatch !== 'function') throw new Error('startNewMatch yok (§3 sözleşmesi)');
        game.startNewMatch();
        let now = performance.now();
        game.lastTime = now;
        for (let i = 0; i < 240; i++) {
          now += 16.7;
          game.update(now);
          game.render();
        }
        out.push({ mode, ok: true, state: game.state });
      } catch (e) {
        out.push({ mode, ok: false, error: String((e && e.stack) || e).slice(0, 400) });
      } finally {
        if (canvas) canvas.remove();
      }
    }
    return out;
  });

  const failures = results
    .filter((r) => !r.ok)
    .map((r) => `${r.mode}: ${r.error}`)
    .join('\n');
  expect(failures, `motor duman matrisi kırık:\n${failures}`).toBe('');
  expect(asyncErrors, `sayfa geneli yakalanmamış hata: ${asyncErrors.join(' | ')}`).toEqual([]);
});
