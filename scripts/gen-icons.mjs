// Simge üretimi: `public/icon.svg` → PNG (192/512).
// Fredoka gerçekten yüklensin diye önce Playwright/Chromium ile render edilir
// (tarayıcı Google Fonts'u çeker); ağ/yükleyici yoksa sharp/librsvg'ye düşer.
// Varlık üretimi dev-time bir iştir, runtime'a koda girmez.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const SVG = readFileSync('public/icon.svg', 'utf8');
const TARGETS = [
  [192, 'public/icon-192.png'],
  [512, 'public/icon-512.png'],
];

async function viaPlaywright() {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>html,body{margin:0;padding:0;background:#14101f}svg{display:block}</style>
      </head><body>${SVG}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const svg = page.locator('svg');
    for (const [size, out] of TARGETS) {
      await svg.evaluate((el, s) => {
        el.setAttribute('width', String(s));
        el.setAttribute('height', String(s));
        el.style.width = `${s}px`;
        el.style.height = `${s}px`;
      }, size);
      await svg.screenshot({ path: out });
      console.log(`playwright → ${out} (${size})`);
    }
  } finally {
    await browser.close();
  }
}

async function viaSharp() {
  for (const [size, out] of TARGETS) {
    await sharp(Buffer.from(SVG), { density: 384 })
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`sharp → ${out} (${size})`);
  }
}

try {
  await viaPlaywright();
} catch (err) {
  console.warn('Playwright simge render başarısız, sharp fallback:', err.message);
  await viaSharp();
}
