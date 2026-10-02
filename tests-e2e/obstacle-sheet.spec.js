// Engel malzeme çarşafı — engel görünüşünün GÖRSEL doğrulaması.
//
// `render-harness.html?probe=obstacles` GERÇEK çizim yolunu (createProjector +
// drawObstacle25dShadow/Mass) çalıştırır. Doku tuvalleri yalnız DOM varken
// üretildiği için (Node'da `obstacleGrain` null döner) bu çarşaf, doku yolunun
// tek görsel/çalışma kanıtıdır — saf birim testler hep prosedürel düşüşe bakar.
//
// Bu test "güzel" iddia etmez; kanıt ÜRETİR ve yolun çalıştığını kilitler.
// Kareler gitignored `test-results/` altına yazılır (kaynak değil, artık).

import { test, expect } from '@playwright/test';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve('test-results', 'obstacle-sheet');
const THEMES = ['wood', 'marble', 'arcade', 'picnic', 'night', 'garden'];

test('engel malzeme çarşafı üretilir (doku yolu + eski referans)', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT_DIR, { recursive: true });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

  await page.goto('/tests/helpers/render-harness.html?probe=obstacles&legacy=1&dpr=2');
  const sheet = page.locator('#obstacle-sheet');
  await expect(sheet).toBeVisible();

  // 6 tema satırı + 1 "ESKİ" referans satırı.
  const canvases = sheet.locator('canvas');
  await expect(canvases).toHaveCount(THEMES.length + 1);

  for (let i = 0; i < THEMES.length; i += 1) {
    const path = resolve(OUT_DIR, `theme-${THEMES[i]}.png`);
    await canvases.nth(i).screenshot({ path });
    expect(statSync(path).size, `boş kare: ${path}`).toBeGreaterThan(1000);
  }
  const legacyPath = resolve(OUT_DIR, 'legacy-reference.png');
  await canvases.nth(THEMES.length).screenshot({ path: legacyPath });
  expect(statSync(legacyPath).size).toBeGreaterThan(1000);

  // Tek parça çarşaf (başlıklar + etiketler dahil) — kullanıcıya gösterilen
  // asıl kanıt budur: altı tema + "ESKİ" referansı yan yana.
  const sheetPath = resolve(OUT_DIR, 'sheet-all.png');
  await sheet.screenshot({ path: sheetPath });
  expect(statSync(sheetPath).size).toBeGreaterThan(10_000);

  // Satırlar gerçekten ÇİZİLMİŞ olmalı: düz bir tuval 1-2 renk verir; mat +
  // 4 engel + mürekkep konturu + doku onlarca ton üretir.
  const distinct = await page.evaluate(() => {
    const list = [...document.querySelectorAll('#obstacle-sheet canvas')];
    return list.map((c) => {
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 13) {
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      }
      return seen.size;
    });
  });
  for (const [i, n] of distinct.entries()) {
    expect(n, `satır ${i}: yalnız ${n} ayrı ton — çizim boş görünüyor`).toBeGreaterThan(40);
  }

  // Temalar birbirinden ayrı görünmeli: satır başına ortalama ton farklı.
  expect(new Set(distinct).size, 'tüm satırlar aynı ton dağılımını veriyor').toBeGreaterThan(1);

  expect(pageErrors, `sayfa geneli hata: ${pageErrors.join(' | ')}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// Gerçek sahada (bağlam) kontrol: prizma değişikliği KENAR TAMPONLARINI da
// çizer (`drawFieldRail` aynı `drawPrism`'i kullanır) — çarşaf bunu göstermez.
// ---------------------------------------------------------------------------
test('gerçek 2.5D saha kareleri kenar tamponlarıyla birlikte üretilir', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

  for (const game of ['BOMB', 'SNAKE']) {
    await page.goto(`/tests/helpers/render-harness.html?game=${game}&w=1180&h=820&t=4000&dpr=2`);
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    const path = resolve(OUT_DIR, `arena-${game.toLowerCase()}.png`);
    await canvas.screenshot({ path });
    expect(statSync(path).size, `boş kare: ${path}`).toBeGreaterThan(5000);
  }

  expect(pageErrors, `sayfa geneli hata: ${pageErrors.join(' | ')}`).toEqual([]);
});
