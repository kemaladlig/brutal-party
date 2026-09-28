// Ayar yüzeyi — mobil-yatay dikey bütçesinin ve tek-kaynak sözleşmesinin gardı.
//
// AGENTS.md §8'in "dikey alan kritik" kararı ölçülmeden sürükleniyordu: başlık
// şeridi + her ayarın tek ekranda olması 844×390 telefonda kaydırmaya
// sığmıyordu. Bu spec dört şeyi kilitler:
//   1. sekme başına içerik KAYDIRMASIZ sığar,
//   2. her satır dokunabilir yüksekliktedir,
//   3. erişilemeyen ayar satır çizmez (ölü düğme yok),
//   4. duraklatma YENİ bir ayar yüzeyi kurmaz — aynı satırları gerer.

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

/** LOCAL maçı gerçek giriş noktalarından kurar (motora dokunmadan). */
async function playLocally(page) {
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
    const ok = await wait(() => reg.getEngine('PONG')?.game?.state === 'PLAYING');
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btn-open-options')?.click();
    await wait(() => !document.getElementById('pause-modal')?.classList.contains('hidden'));
    return ok;
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
  await page.waitForTimeout(120);
}

function measure() {
  const scroll = document.querySelector('.settings-scroll');
  const rows = [...document.querySelectorAll('.setting-row:not([hidden])')];
  const head = document.querySelector('.settings-head');
  const close = document.querySelector('.settings-sheet .sheet-close');
  return {
    overflow: scroll ? scroll.scrollHeight - scroll.clientHeight : -1,
    rowCount: rows.length,
    minHeight: rows.reduce((min, row) => Math.min(min, Math.round(row.getBoundingClientRect().height)), 999),
    headHeight: head ? Math.round(head.getBoundingClientRect().height) : -1,
    closeWidth: close ? Math.round(close.getBoundingClientRect().width) : -1,
    sheetWidth: Math.round(document.querySelector('.settings-sheet')?.getBoundingClientRect().width ?? 9999),
  };
}

test.describe('ayar yüzeyi — 844×390 yatay telefon', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: false });

  test('her sekme kaydırmasız sığar, hedefler dokunulabilir', async ({ page }) => {
    await bootPhone(page);
    await openSettings(page);

    for (const tab of ['general', 'control', 'system']) {
      await selectTab(page, tab);
      const m = await page.evaluate(measure);
      expect(m.rowCount, `${tab}: hiç satır çizilmedi`).toBeGreaterThan(0);
      expect(m.overflow, `${tab}: gövde kayıyor (+${m.overflow}px)`).toBeLessThanOrEqual(1);
      expect(m.minHeight, `${tab}: en küçük satır ${m.minHeight}px`).toBeGreaterThanOrEqual(40);
      // Kaldırılan başlık şeridi ~68px'ti. Şerit 44px kapatma hedefinin
      // ALTINA inemez (mobil dokunma bütçesi), bu yüzden tavan 60px.
      expect(m.headHeight, `sekme şeridi ${m.headHeight}px`).toBeLessThanOrEqual(60);
      expect(m.closeWidth, 'kapat düğmesi sekme şeridine ezmiş').toBeGreaterThanOrEqual(30);
      expect(m.sheetWidth).toBeLessThanOrEqual(PHONE.width);
    }
  });

  test('yazımlar merkezi tercih deposuna ve ait olduğu modüle gider', async ({ page }) => {
    await bootPhone(page);
    await openSettings(page);

    const haptics = page.locator('.setting-row').filter({ hasText: /Haptik|Haptic/ });
    await expect(haptics).toHaveAttribute('aria-checked', 'true');
    await haptics.click();
    const afterSwitch = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SURFACE_KEY);
    expect(afterSwitch.hapticsEnabled).toBe(false);
    await expect(haptics).toHaveAttribute('aria-checked', 'false');

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

  test('duraklatma aynı satırları gerer, ikinci bir ayar yüzeyi kurmaz', async ({ page }) => {
    test.setTimeout(90_000);
    await bootPhone(page);
    expect(await playLocally(page)).toBe(true);

    const quick = page.locator('#pause-settings-slot .setting-row:not([hidden])');
    expect(await quick.count()).toBeGreaterThan(0);
    // Eski kopya yüzey: pause'un kendi anahtarları geri gelmemeli.
    expect(await page.locator('#btn-toggle-sound, #btn-toggle-bots, #btn-controller-layout').count()).toBe(0);

    const pauseBox = await page.locator('.pause-sheet').boundingBox();
    const quickBox = await quick.first().boundingBox();
    expect(quickBox.height).toBeLessThanOrEqual(48);
    expect(pauseBox.height).toBeLessThan(PHONE.height);

    await page.locator('.settings-all-btn').click();
    await page.waitForSelector('.settings-sheet', { state: 'visible' });
    await expect(page.locator('.pause-sheet')).toBeVisible();

    // Escape en üsttekine gider: ayar kapanır, duraklatma açık kalır.
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-sheet')).toBeHidden();
    await expect(page.locator('.pause-sheet')).toBeVisible();
  });
});
