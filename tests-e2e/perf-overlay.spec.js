// Debug performans HUD'u — Faz 0 ölçüm katmanının çalışma zamanı gardı.
// HUD yalnız açıkça istendiğinde (`?perf` / `bp.perf=1`) DOM'a girmeli;
// aksi halde üretim yüzeyi temiz kalır.

import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled in e2e'));
    }
  });
}

test('perf HUD mounts only with ?perf and shows host/client readout', async ({ page }) => {
  await boot(page);
  await page.goto('/?perf=1');

  const hud = page.locator('.perf-hud');
  await expect(hud).toHaveCount(1);
  const text = await hud.textContent();
  expect(text).toContain('HOST');
  expect(text).toContain('CLIENT');
});

test('perf HUD is absent without the flag', async ({ page }) => {
  await boot(page);
  await page.goto('/');
  await expect(page.locator('.perf-hud')).toHaveCount(0);
});
