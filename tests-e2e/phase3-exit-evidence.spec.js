// Faz 3 ÇIKIŞ KANITI — "4 kişilik kaos anı"nda okunurluk ekran görüntüleri.
// MOTION_PLAN Faz 3 çıkış kanıtı: küçük telefon (SE yatay) + TV'de yan yana
// kareler; her avatar tanınır, HUD üstünde hiçbir şey uçuşmaz, T3 solukluğu ölçülür.
//
// Ham motordan (registry) kurulur — UI seçicisi yoktur (engine-smoke deseni).
// Dolu 4 koltuk + `localControlSlot` (tek-görür) → T1 kendisi tam opak, T3 diğerleri
// soluk; paylaşılan TV'de (selfSlot yok) dim olmaz. Kareler gitignored `test-results/`
// altına yazılır (kaynak değil, doğrulama artığıdır — .gitignore §Playwright).
//
// Bu test "görsel kalite" iddia etmez; kanıt ÜRETİR. Geçme koşulu: her kare
// üretildi, sayfa hatası yok, en az bir motor PLAYING'e ulaştı.

import { test, expect } from '@playwright/test';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const MODES = ['ZONE', 'TANKS', 'HORDE'];
const VIEWPORTS = [
  { name: 'se', w: 667, h: 375 }, // iPhone SE yatay — gerçek en küçük hedef
  { name: 'tv', w: 1920, h: 1080 }, // 4 kişilik TV
];
const OUT_DIR = resolve('test-results', 'phase3-exit');
const FRAMES = 300; // ~5 sn: 3-2-1 sayacı biter, botlar çarpışmaya girer

test('Faz 3 çıkış kanıtı: 4 kişilik kaos kareleri (SE yatay + TV)', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT_DIR, { recursive: true });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

  await page.goto('/favicon.ico'); // aynı origin, sıfır script

  for (const mode of MODES) {
    for (const vp of VIEWPORTS) {
      // 1) Motoru kur: dolu 4 koltuk (1 insan + 3 bot = kaos), tek-görür = P1.
      const ok = await page.evaluate(async ({ mode, w, h, frames }) => {
        const { CARTRIDGES } = await import('/src/core/engineRegistry.js');
        const cart = CARTRIDGES[mode];
        if (!cart) throw new Error(`CARTRIDGES kaydı yok: ${mode}`);
        const Cls = await cart.load();
        const canvas = document.createElement('canvas');
        canvas.id = 'exit-capture';
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.style.display = 'block';
        document.body.appendChild(canvas);
        const game = new Cls(canvas);
        game.resize(w, h);
        // Dolu 4 koltuk: T3 solukluğu ve 4'lü HUD görünür olsun.
        game.slotTypes = ['human', 'bot_normal', 'bot_god', 'bot_normal'];
        game.localControlSlot = 0; // P1 = bu cihazın görücüsü (T1)
        game.startNewMatch();
        let now = performance.now();
        game.lastTime = now;
        // Duvar-saati simülasyona sızar (yük altında 300 kare ~13 sn gerçek zaman
        // alır), bu yüzden SON durum oyun-bağımlı değişebilir. Sözleşme (yukarıdaki
        // geçme koşulu) "PLAYING'e ULAŞTI"dır — yan etkisi yalnız zamanın daha çok
        // akması olan gecikmeye dayanıklı ölçüm budur.
        let reachedPlaying = false;
        let lastState = game.state;
        for (let i = 0; i < frames; i++) {
          now += 16.7;
          game.update(now);
          game.render();
          lastState = game.state;
          if (lastState === 'PLAYING') reachedPlaying = true;
        }
        return { state: lastState, reachedPlaying };
      }, { mode, w: vp.w, h: vp.h, frames: FRAMES });

      // 2) Kareyi al (element ekran görüntüsü = tam çözünürlük).
      const outPath = resolve(OUT_DIR, `${mode.toLowerCase()}-${vp.name}-${vp.w}x${vp.h}.png`);
      await page.locator('#exit-capture').screenshot({ path: outPath });

      // 3) Kanıt gerçekten üretildi + motor oynanabilir duruma geldi.
      expect(statSync(outPath).size, `boş kare: ${outPath}`).toBeGreaterThan(1000);
      expect(ok.reachedPlaying, `${mode} PLAYING'e ulaşamadı (son state=${ok.state})`).toBe(true);

      await page.evaluate(() => document.getElementById('exit-capture')?.remove());
    }
  }

  expect(pageErrors, `sayfa geneli hata: ${pageErrors.join(' | ')}`).toEqual([]);
});
