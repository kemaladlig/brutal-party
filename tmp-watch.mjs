// Geçici: headed Playwright ile oyunu gerçek uygulamada izleme/oynama.
import { chromium } from 'playwright';

const URL = process.env.WATCH_URL || 'http://localhost:3100/';
const GAME = process.env.WATCH_GAME || 'BRUTAL PONG';
const HOLD_MS = Number(process.env.WATCH_HOLD_MS || 0); // 0 = siz kapatana kadar
const SHOT = process.env.WATCH_SHOT || '';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

const dump = async (label) => {
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button,[role="button"]')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => `${(b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34)}`)
      .filter(Boolean));
  console.log(`--- ${label} ---\n` + buttons.join(' | '));
  if (SHOT) await page.screenshot({ path: `${SHOT}-${label}.png` });
};

const click = async (sel, label, wait = 900) => {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await loc.click({ timeout: 8000 }).catch((e) => console.log('click fail', sel, String(e).slice(0, 100)));
  await page.waitForTimeout(wait);
  if (label) await dump(label);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await click('button:has-text("OYUNLAR")', 'oyunlar');
await click(`.game-card:has-text("${GAME}")`, 'oyun-secildi');
await click('button.scene-btn.games-play', 'oyna-tiklandi');

// LOCAL lobi canvas üstünde: orta kart "DEVAM ET" = canvas merkezi.
const box = await page.locator('canvas').first().boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(4500); // 3-2-1 + oynanış başlangıcı
  if (SHOT) await page.screenshot({ path: `${SHOT}-playing.png` });
  console.log('mac baslatildi, siz de oynayabilirsiniz (P1 WASD/Space).');
}

if (HOLD_MS > 0) await page.waitForTimeout(HOLD_MS);
else await new Promise((r) => setTimeout(r, 24 * 3600_000));
await browser.close();
