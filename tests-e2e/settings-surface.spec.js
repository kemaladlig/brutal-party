// Ayar yüzeyleri — mobil-yatay dikey bütçesinin ve tek-kaynak sözleşmesinin gardı.
//
// Kilitlenen davranışlar:
//   1. ayar sheeti SEKME DEĞİŞİMİNDE ZIPLAMAZ (yükseklik sabittir),
//   2. gövde kaydırmaya ihtiyaç duymaz, satırlar dokunulabilir yüksekliktedir,
//   3. erişilemeyen ayar satır çizmez ("kullanılamıyor" düğmesi yoktur),
//   4. duraklatma ikinci bir ayar yüzeyi kurmaz: HIZLI şeridi şemadan gelir,
//      başlıktaki dişli AYNI sheet'i üstüne açar, Escape en üsttekine gider.

import { test, expect } from '@playwright/test';

const SURFACE_KEY = 'brutalparty.preferences.v2';
// Yatay telefon: 390 px yükseklik, ayar yüzeyinin gerçek düşmanı.
const PHONE = { width: 844, height: 390 };

async function bootPhone(page) {
  await page.addInitScript(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register = () => Promise.reject(new Error('SW off'));
    }
  });
  await page.goto('/favicon.ico');
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, controlSurface: 'mobile', audioMuted: true }));
  }, SURFACE_KEY);
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'));
}

/** LOCAL maçı gerçek giriş noktalarından kurar ve duraklatmayı açar. */
async function pauseInLocalMatch(page) {
  return page.evaluate(async () => {
    const m = await import('/src/main.js');
    const reg = await import('/src/core/engineRegistry.js');
    const wait = async (fn, ms = 15000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise((r) => setTimeout(r, 120));
      }
      return false;
    };
    m.roomFlow.handleGameCardClick('PONG');
    await wait(() => m.roomFlow.getCurrentMode() === 'PONG'
      && reg.getEngine('PONG')?.game?.state === 'LOBBY');
    await m.roomFlow.enterStaging('PONG');
    m.roomFlow.runCountdown();
    const playing = await wait(() => reg.getEngine('PONG')?.game?.state === 'PLAYING');
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btn-open-options')?.click();
    const paused = await wait(() => !document.getElementById('pause-modal')?.classList.contains('hidden'));
    return playing && paused;
  });
}

async function openSettings(page) {
  await page.evaluate(() => document.getElementById('shell-settings')?.click());
  await page.waitForSelector('.settings-sheet', { state: 'visible' });
}

async function selectTab(page, id) {
  await page.evaluate((tab) => {
    document.querySelector(`.settings-tabs [data-tab="${tab}"]`)
      ?.dispatchEvent(new PointerEvent('click', { bubbles: true }));
  }, id);
  await page.waitForTimeout(140);
}

function measureSettings() {
  const scroll = document.querySelector('.settings-scroll');
  const rows = [...document.querySelectorAll('.settings-scroll .setting-row:not([hidden])')];
  return {
    sheetHeight: Math.round(document.querySelector('.settings-sheet').getBoundingClientRect().height),
    sheetWidth: Math.round(document.querySelector('.settings-sheet').getBoundingClientRect().width),
    headHeight: Math.round(document.querySelector('.settings-head').getBoundingClientRect().height),
    rowCount: rows.length,
    minHeight: rows.reduce((min, row) => Math.min(min, Math.round(row.getBoundingClientRect().height)), 999),
    overflow: scroll.scrollHeight - scroll.clientHeight,
  };
}

test.describe('ayar yüzeyi — 844×390 yatay telefon', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: false });

  test('sekme değişince panel zıplamaz, gövde kaymaz, hedefler dokunulabilir', async ({ page }) => {
    await bootPhone(page);
    await openSettings(page);

    const heights = [];
    for (const tab of ['general', 'control', 'system']) {
      await selectTab(page, tab);
      const m = await page.evaluate(measureSettings);
      heights.push(m.sheetHeight);
      expect(m.rowCount, `${tab}: hiç satır çizilmedi`).toBeGreaterThan(0);
      expect(m.overflow, `${tab}: gövde kayıyor (+${m.overflow}px)`).toBeLessThanOrEqual(1);
      expect(m.minHeight, `${tab}: en küçük satır ${m.minHeight}px`).toBeGreaterThanOrEqual(40);
      expect(m.headHeight, `başlık+sekme şeridi ${m.headHeight}px`).toBeLessThanOrEqual(56);
      // İçerik tüm satır genişliğine yayılmaz: panel merkezde ve sınırlıdır.
      expect(m.sheetWidth).toBeLessThanOrEqual(520);
    }
    expect(new Set(heights).size, `panel yüksekliği sekmeye göre değişti: ${heights.join('/')}`).toBe(1);
  });

  test('yazımlar merkezi tercih deposuna ve ait olduğu modüle gider', async ({ page }) => {
    await bootPhone(page);
    await openSettings(page);

    const haptics = page.locator('.setting-row').filter({ hasText: /Haptik|Haptic/ });
    await expect(haptics).toHaveAttribute('aria-checked', 'false');
    await haptics.click();
    const afterSwitch = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SURFACE_KEY);
    expect(afterSwitch.hapticsEnabled).toBe(true);
    await expect(haptics).toHaveAttribute('aria-checked', 'true');

    await selectTab(page, 'control');
    const tabletop = page.locator('.group-btn').filter({ hasText: /Masa-ortası|Tabletop/ });
    await tabletop.click();
    const afterSegment = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SURFACE_KEY);
    expect(afterSegment.controlSurface).toBe('tabletop');
    await expect(tabletop).toHaveAttribute('aria-pressed', 'true');

    const slider = page.locator('.slider-input');
    await slider.evaluate((node) => {
      node.value = '1.35';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('.slider-value')).toHaveText('1.35');
    const afterSlider = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SURFACE_KEY);
    expect(afterSlider.pongSensitivity).toBe(1.35);
  });

  test('erişilemeyen ayar satır çizmez', async ({ page }) => {
    await bootPhone(page);
    await openSettings(page);
    await selectTab(page, 'control');
    // Menüde düzenlenecek bir kumanda yoktur: satır kuyrukta beklememeli.
    await expect(page.locator('.setting-row.is-action').first()).toBeHidden();
  });

  test('duraklatma: HIZLI şerit şemadan gelir, dişli aynı sheeti üstüne açar', async ({ page }) => {
    test.setTimeout(90_000);
    await bootPhone(page);
    expect(await pauseInLocalMatch(page)).toBe(true);

    const quick = page.locator('#pause-quick-slot .setting-row:not([hidden])');
    expect(await quick.count()).toBeGreaterThan(0);
    // Eski kopya yüzey geri gelmemeli: pause'un kendi anahtarları yok, HIZLI
    // şerit ve menüdeki TÜM AYARLAR satırı merkezi sheet'i açar.
    expect(await page.locator('#btn-toggle-sound, #btn-controller-layout, .settings-all-btn').count()).toBe(0);
    await expect(page.locator('#btn-pause-all-settings')).toBeVisible();

    const stripBox = await page.locator('#pause-quick-slot').boundingBox();
    expect(stripBox.height).toBeLessThanOrEqual(48);

    // Sekmeler: KOLTUKLAR / KONTROLLER, panel alanı sabit yükseklikte.
    const tabs = page.locator('#pause-tabs-host .tab-btn:not([hidden])');
    expect(await tabs.count()).toBe(2);
    const hostBefore = (await page.locator('.pause-panel-host').boundingBox()).height;
    await tabs.nth(1).click();
    await expect(page.locator('#pause-controls-section')).toBeVisible();
    expect((await page.locator('.pause-panel-host').boundingBox()).height).toBe(hostBefore);

    // Dişli ve menüdeki TÜM AYARLAR → merkezi sheet pause'un ÜSTÜNDE;
    // Escape önce onu kapatır.
    await page.locator('#pause-tabs-host .tab-btn').first().click();
    await page.locator('#btn-pause-all-settings').click();
    await page.waitForSelector('.settings-sheet', { state: 'visible' });
    await expect(page.locator('.pause-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-sheet')).toBeHidden();
    await expect(page.locator('.pause-sheet')).toBeVisible();
    await page.locator('#btn-pause-settings').click();
    await page.waitForSelector('.settings-sheet', { state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-sheet')).toBeHidden();
    await expect(page.locator('.pause-sheet')).toBeVisible();
  });
});
