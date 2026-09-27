// Yerel kontrol yüzeyi — AGENTS.md §3/§4 sözleşmesinin çalışma zamanı gardı.
// Platform modu (`LOCAL`/`TV_CONSOLE`/`ONLINE`) yüzey kararının girdisidir ve
// yalnız `roomFlow`'a CANLI olarak ulaşmalıdır: mod bir kez kopyalanıp donarsa
// (deps destructuring) tek cihazda oynayan dokunmatik oyuncu hiç kontrol
// yüzeyi görmez. Tercih segmenti de aynı karar noktadan geçmelidir.

import { test, expect } from '@playwright/test';

const SURFACE_KEY = 'brutalparty.preferences.v2';

async function bootWithSurface(page, surface) {
  // SW kaydını sustur: `updateManager` controllerchange'te sayfayı yeniliyor ve
  // bu, akış ortasında değerlendirme bağlamını yıkıyordu (test gürültüsü —
  // PWA kabuğu bu testin konusu değil; `register` zaten try/catch içinde).
  await page.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW disabled in e2e'));
    }
  });
  // favicon: origin'yi kurar, main.js boot etmeden localStorage yazar.
  await page.goto('/favicon.ico');
  await page.evaluate(([key, value]) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, controlSurface: value, audioMuted: true }));
  }, [SURFACE_KEY, surface]);
  await page.goto('/');
  // `revealAppShell()` kalıcı boot işareti: kabuk kuruldu ve görünürlük kararı verildi.
  await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'));
}

async function playLocally(page) {
  return page.evaluate(async () => {
    const m = await import('/src/main.js');
    const reg = await import('/src/core/engineRegistry.js');
    const wait = async (fn, ms = 12000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise((r) => setTimeout(r, 120));
      }
      return false;
    };

    // Kart tıklaması LOCAL'e geçer; motor yüklemesi async — sahaya geçiş
    // LOBBY göründükten sonra yapılır (iki setGameMode çakışmasın).
    m.roomFlow.handleGameCardClick('PONG');
    await wait(() => m.roomFlow.getCurrentMode() === 'PONG'
      && reg.getEngine('PONG')?.game?.state === 'LOBBY');
    await m.roomFlow.enterStaging('PONG');
    m.roomFlow.runCountdown();
    await wait(() => reg.getEngine('PONG')?.game?.state === 'PLAYING');
    // Yüzeyi kare döngüsü (`syncLocalMobileControls`) kurar: PLAYING kararı ile
    // aynı karede değil, bir sonraki karelerde doğar.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await wait(() => m.roomFlow.getLocalControlMode().mode !== 'none');

    const overlay = document.getElementById('local-mobile-controls');
    return {
      currentMode: m.roomFlow.getCurrentMode(),
      platformLocal: m.roomFlow.getLocalControlMode(),
      engineFlag: reg.getEngine('PONG')?.game?.localControlMode,
      state: reg.getEngine('PONG')?.game?.state,
      overlayHidden: overlay.classList.contains('hidden'),
      mountedControls: overlay.querySelectorAll('.local-mobile-workspace *').length,
    };
  });
}

test('LOCAL + mobil tercih: tek cihazdaki dokunmatik oyuncu kontrol yüzeyini alır', async ({ page }) => {
  test.setTimeout(90_000);
  await bootWithSurface(page, 'mobile');
  const r = await playLocally(page);

  expect(r.state).toBe('PLAYING');
  expect(r.platformLocal.mode).toBe('dom');
  expect(r.engineFlag).toBe('dom');
  expect(r.overlayHidden).toBe(false);
  expect(r.mountedControls).toBeGreaterThan(0);
});

test('LOCAL + masa-ortası tercih: DOM yüzeyi kapanır, canvas köşe yüzeyi devralır', async ({ page }) => {
  test.setTimeout(90_000);
  await bootWithSurface(page, 'tabletop');
  const r = await playLocally(page);

  expect(r.state).toBe('PLAYING');
  expect(r.platformLocal.mode).toBe('canvas');
  expect(r.engineFlag).toBe('canvas');
  expect(r.overlayHidden).toBe(true);
});

test('Oyun içinde tercih değişimi yüzeyi aynı anda iki tarafa da uygular', async ({ page }) => {
  test.setTimeout(90_000);
  await bootWithSurface(page, 'mobile');
  await playLocally(page);

  const flipped = await page.evaluate(async () => {
    const { setPreference } = await import('/src/core/preferences.js');
    const m = await import('/src/main.js');
    const reg = await import('/src/core/engineRegistry.js');
    setPreference('controlSurface', 'tabletop');
    await new Promise((r) => setTimeout(r, 250));
    const overlay = document.getElementById('local-mobile-controls');
    return {
      mode: m.roomFlow.getLocalControlMode().mode,
      engineFlag: reg.getEngine('PONG')?.game?.localControlMode,
      overlayHidden: overlay.classList.contains('hidden'),
    };
  });

  expect(flipped.mode).toBe('canvas');
  expect(flipped.engineFlag).toBe('canvas');
  expect(flipped.overlayHidden).toBe(true);
});
