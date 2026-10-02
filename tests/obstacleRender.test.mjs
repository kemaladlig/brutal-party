// Engel çizimi regresyon kalkanı — 2.5D yolunun (prizma/silindir + gölge)
// KONTRACT'INI kilitler. Görseli değil, ölçülebilir olanı:
//
//   1) OP BÜTÇESİ: blok başına ≤ 22 raster/path op, kare başına gradyan/desen YOK.
//      Not: `arenaLayout.test.mjs` bütçesi TEPEDEN BAKIŞ yolunu (`drawObstacle`)
//      ölçer; 2.5D prizma yolu bugüne kadar ölçülmüyordu, bu dosya onu kapatır.
//   2) SİLUET: oblique projeksiyonda (PERSP = 0) blok silueti TEK bir
//      dikdörtgendir. "Yan yüz" (x sabit) ekranda sıfır genişliktedir; eskiden
//      çizilen dikey dikiş çizgisi hem klip-art hem de KONUMA BAĞLI idi
//      (bloğun `cam.x`e göre solunda mı sağında mı olduğuna göre yeri değişiyordu).
//   3) RELIEF DETERMİNİZMİ: aynı dikdörtgen aynı çizim programını üretir; paket
//      0.1 px yuvarlaması relief'i değiştirmez (host ↔ client aynı okunur).
//   4) GÖLGE: ayak izinin TAM altında (yatay ofset yok), yumuşak damga.
//   5) OKUNABİLİRLİK: her temanın engel derisi zemin matından ΔL* ≥ 8 ayrışır
//      ve oyuncu renklerine kanal-uzaklığı ≥ 60 kalır.
//   6) TAHSİZ: `materialFromSkin` kova başına AYNI referansı döndürür
//      (kare başına palet/string üretimi GC baskısıdır).
//   7) KAYNAK TARAMASI: `createPattern` / `shadowBlur` / `getImageData`
//      engel çizim yolunda yasak (§9).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  OBSTACLE_STYLES,
  drawObstacle25dMass,
  drawObstacle25dShadow,
  materialFromSkin,
  obstacleMass,
  obstacleStyle,
} from '../src/core/arenaKit.js';
import { createProjector } from '../src/core/projection2d.js';
import { drawFieldRail } from '../src/core/fieldKit.js';
import { UI_COLORS } from '../src/ui/tokens.js';
import { strictRecorder, logRecorder } from './helpers/recorder.mjs';
import { lstar, rgbDistance } from './helpers/color.mjs';

const TABLET = [1180, 820];
const THEMES = UI_COLORS.arena25dThemes;
const RASTER_RE = /^(fill|stroke|fillRect|strokeRect|ellipse|moveTo|lineTo|arc)\(/;

function projectorFor(themeId) {
  const proj = createProjector();
  proj.fit(
    { width: TABLET[0], height: TABLET[1] },
    { left: 120, top: 120, right: 900, bottom: 700, cx: 510, cy: 410, width: 780, height: 580, size: 580 },
    { theme: themeId },
  );
  return proj;
}

/** Aynı dikdörtgenin yalnız relief'ini taşıyan imza: mutlak konum HARİÇ. */
function reliefSignature(log) {
  return log.map((entry) => {
    const open = entry.indexOf('(');
    const name = entry.slice(0, open);
    const args = entry.slice(open + 1, -1).split(',');
    return `${name}|${args.slice(2).join(',')}`;
  });
}

/** Log'tan belirli bir çağrının sayısal argümanlarını çeker. */
function calls(log, name) {
  return log
    .filter((e) => e.startsWith(`${name}(`))
    .map((e) => e.slice(name.length + 1, -1).split(',').map(Number));
}

// ---------------------------------------------------------------------------
// 1. Op bütçesi + gradyan/desen yasağı
// ---------------------------------------------------------------------------
test('2.5D engel gövdesi blok başına op bütçesinde kalır ve gradyan üretmez', () => {
  const shapes = [
    { x: 300, y: 300, w: 96, h: 64 },   // prizma (kerb/duvar)
    { x: 300, y: 300, w: 220, h: 40 },  // prizma (uzun duvar)
    { x: 300, y: 300, w: 54, h: 54 },   // silindir (kolon)
  ];
  for (const [themeId, palette] of Object.entries(THEMES)) {
    for (const obs of shapes) {
      const proj = projectorFor(themeId);
      const ctx = strictRecorder(`engel ${themeId}`);
      drawObstacle25dMass(ctx, proj, obs); // strictRecorder gradyan/desen üretiminde patlar
      const raster = ctx.log.filter((e) => RASTER_RE.test(e));
      assert.ok(
        raster.length <= 22,
        `${themeId} ${palette.block} ${obs.w}x${obs.h}: ${raster.length} raster/path op (bütçe 22)`,
      );
    }
  }
});

test('2.5D temas gölgesi gradyan üretmez ve bloğun op bütçesini yükseltmez', () => {
  for (const themeId of Object.keys(THEMES)) {
    const proj = projectorFor(themeId);
    const ctx = strictRecorder(`gölge ${themeId}`);
    drawObstacle25dShadow(ctx, proj, { x: 300, y: 300, w: 96, h: 64 });
    const raster = ctx.log.filter((e) => RASTER_RE.test(e));
    assert.ok(raster.length <= 8, `${themeId}: gölge ${raster.length} op (bütçe 8)`);
  }
});

// ---------------------------------------------------------------------------
// 2. Siluet tek dikdörtgen; yan yüz dikişi yok
// ---------------------------------------------------------------------------
test('prizma silueti TEK dikdörtgendir — konuma bağlı yan-yüz dikişi çizilmez', () => {
  const proj = projectorFor('wood');
  // Bloğu kameranın İKİ tarafına da koy: eski çizim `x + w/2 < cam.x` ile
  // dikişi sola/sağa taşıyordu, yani aynı blok sahada başka yerde farklı
  // çiziliyordu. Yeni çizim programı konumdan bağımsız olmalı.
  // (aspect = 2.2, minDim > 66 → prizma dalı; kısa/kare blok silindire gider.)
  const left = { x: 200, y: 320, w: 120, h: 54 };
  const right = { x: 720, y: 320, w: 120, h: 54 };

  for (const obs of [left, right]) {
    const ctx = strictRecorder('prizma silueti');
    drawObstacle25dMass(ctx, proj, obs);
    assert.ok(ctx.log.some((e) => e.startsWith('strokeRect(')), 'prizma dalı seçilmeli');
    const rects = calls(ctx.log, 'fillRect');
    const outline = calls(ctx.log, 'strokeRect');
    assert.equal(outline.length, 1, 'siluet konturu tam olarak bir kez basılmalı');
    // Kontur ve dört düz dolgu (duvar/çatı/birleşim/AO) AYNI sol kenar ve
    // genişlikte olmalı: hiçbir yüz dikdörtgenin dışına taşmaz, içinde dikey
    // dikiş yoktur.
    assert.ok(rects.length >= 3, 'duvar + çatı + birleşim (+AO) düz dolgu olmalı');
    for (const [rx, , rw] of [...rects, ...outline]) {
      assert.equal(rx, outline[0][0], 'dolgu ve kontur aynı sol kenarda olmalı');
      assert.equal(rw, outline[0][2], 'dolgu ve kontur aynı genişlikte olmalı');
    }
    // Yan yüz kalıntısı: eskiden `quad()` + 3 ayrı `strokePoly` basılıyordu.
    assert.ok(!ctx.log.some((e) => e.startsWith('quad(')), 'dolgu quad() ile değil fillRect ile yapılır');
  }

  // Çizim PROGRAMI konumdan bağımsız: op adları dizisi iki tarafta da aynı.
  // (Ölçüler `obstacleMass`'e bağlı olduğu için argümanlar değil, program
  // karşılaştırılır — konuma göre değişen tek şey eskiden dikişin YERİYDİ.)
  const a = strictRecorder('a');
  const b = strictRecorder('b');
  drawObstacle25dMass(a, proj, left);
  drawObstacle25dMass(b, proj, right);
  const names = (log) => log.map((e) => e.slice(0, e.indexOf('(')));
  assert.deepEqual(names(a.log), names(b.log));
});

test('kenar tamponu da TEK siluet konturu basar (prizma sözleşmesi ray yolu)', () => {
  // `drawFieldRail` aynı `drawPrism`'i çağırır: her 2.5D sahanın çevresi bu
  // yoldan geçer, yani prizma düzeltmesi rayları da değiştirir. Kontur sayısı
  // burada da tektir ve yan-yüz dikişi yoktur.
  //
  // `logRecorder`: `drawRailDetail` ray üst yüzüne bilerek gradyan basar —
  // gevşek kaydedici onu loglar, `strictRecorder` ise patlatırdı.
  const proj = projectorFor('wood');
  const arena = { left: 120, top: 120, right: 900, bottom: 700, cx: 510, cy: 410, width: 780, height: 580, size: 580 };
  for (const side of ['north', 'east', 'south', 'west']) {
    const ctx = logRecorder();
    drawFieldRail(ctx, proj, { arena, side });
    const outlines = ctx.log.filter((e) => e.startsWith('strokeRect(')).length;
    // 1 ray gövdesi + 2 köşe kapağı (`drawRailCap` da `drawPrism` çağırır) —
    // her yüz başına ayrı kontur basılmadığının kanıtı tam olarak 3 olmasıdır.
    assert.equal(outlines, 3, `${side}: 1 gövde + 2 kapak konturu beklenir, ${outlines} bulundu`);
    assert.ok(!ctx.log.some((e) => e.startsWith('quad(')),
      `${side}: ray dolgusu fillRect olmalı (quad = eski yüz-başına çizim)`);
  }
});

// ---------------------------------------------------------------------------
// 3. Relief determinizmi (host ↔ client)
// ---------------------------------------------------------------------------
test('aynı dikdörtgen her cihazda aynı blok reliefini basar', () => {
  const proj = projectorFor('garden');
  const obs = { x: 412.37, y: 260.91, w: 96, h: 64 };
  const a = strictRecorder('a');
  const b = strictRecorder('b');
  drawObstacle25dMass(a, proj, obs);
  drawObstacle25dMass(b, proj, { ...obs });
  assert.deepEqual(a.log, b.log);

  // Paket koordinatı 0.1 px'e yuvarlanır (worldCore.round1); relief ±0.1 px
  // kaymadan AYNI kalmalı.
  const c = strictRecorder('c');
  drawObstacle25dMass(c, proj, { x: 412.4, y: 260.9, w: 96, h: 64 });
  assert.deepEqual(reliefSignature(a.log), reliefSignature(c.log));
});

test('silindir yolu da aynı dikdörtgende deterministik', () => {
  const proj = projectorFor('marble');
  const obs = { x: 380, y: 300, w: 54, h: 54 };
  const a = strictRecorder('a');
  const b = strictRecorder('b');
  drawObstacle25dMass(a, proj, obs);
  drawObstacle25dMass(b, proj, { ...obs });
  assert.deepEqual(a.log, b.log);
  assert.ok(a.log.some((e) => e.startsWith('ellipse(')), 'silindir tabla elipsi basmalı');
});

// ---------------------------------------------------------------------------
// 4. Gölge: ayak izinin tam altında, yumuşak damga
// ---------------------------------------------------------------------------
test('temas gölgesi ayak izinin tam altındadır (yatay ofset yok)', () => {
  const proj = projectorFor('picnic');
  const obs = { x: 300, y: 300, w: 120, h: 80 };
  const ctx = strictRecorder('gölge');
  drawObstacle25dShadow(ctx, proj, obs);
  const ellipses = calls(ctx.log, 'ellipse');
  assert.ok(ellipses.length >= 1, 'DOM yoksa düz-çizim düşüşü elips basar');
  const expectedCx = proj.proj(obs.x + obs.w / 2, obs.y + obs.h, 0).x;
  for (const [cx] of ellipses) {
    assert.ok(Math.abs(cx - expectedCx) < 0.01, `gölge merkezi ${cx}, ayak izi merkezi ${expectedCx}`);
  }
});

// ---------------------------------------------------------------------------
// 5. Okunabilirlik: deri ↔ zemin ve deri ↔ oyuncu
// ---------------------------------------------------------------------------
test('her temanın engel derisi zemin matından ΔL* ≥ 8 ayrışır', () => {
  for (const [id, palette] of Object.entries(THEMES)) {
    assert.ok(palette.block, `${id}: tema bir engel derisi (\`block\`) bildirmeli`);
    const style = OBSTACLE_STYLES[palette.block];
    assert.ok(style, `${id}: block='${palette.block}' OBSTACLE_STYLES'ta yok`);
    for (const key of ['fill', 'top']) {
      const d = Math.abs(lstar(style[key]) - lstar(palette.mat));
      assert.ok(
        d >= 8,
        `${id} (${palette.block}).${key}: zemin matıyla ΔL*=${d.toFixed(1)} < 8 — blok zemine gömülür`,
      );
    }
  }
});

test('engel derileri oyuncu renklerinden ayırt edilebilir kalır', () => {
  // Yalnız L* yetmez: `metal` derisi yeşil oyuncuyla aynı parlaklıkta ama
  // tonca ayrı. Kapı kanal-uzaklığıdır.
  for (const [sid, style] of Object.entries(OBSTACLE_STYLES)) {
    for (const player of UI_COLORS.players) {
      const d = rgbDistance(style.fill, player);
      assert.ok(d >= 60, `${sid} ↔ ${player}: renk uzaklığı ${d.toFixed(0)} < 60`);
    }
  }
});

test('engel derisi zemin matıyla aynı tonu taşıyamaz (deri seçimi kapılı)', () => {
  for (const [id, palette] of Object.entries(THEMES)) {
    const style = OBSTACLE_STYLES[palette.block];
    assert.notEqual(style.fill.toLowerCase(), palette.mat.toLowerCase(), `${id}: deri zemini tekrar ediyor`);
  }
});

// ---------------------------------------------------------------------------
// 6. Tahsiz: palet kova başına aynı referans
// ---------------------------------------------------------------------------
test('materialFromSkin kare başına tahsis yapmaz', () => {
  const style = OBSTACLE_STYLES.crate;
  assert.equal(materialFromSkin(style, 0.31), materialFromSkin(style, 0.31), 'aynı kova aynı referans');
  assert.equal(materialFromSkin(style, 0.31), materialFromSkin(style, 0.36), 'aynı kovaya düşen mass aynı referans');
  // Kovaya göre ton değişmeli: tek düz deri bütün sahayı tek renge boyar.
  const tones = new Set();
  for (let i = 0; i < 8; i += 1) tones.add(materialFromSkin(style, (i + 0.5) / 8).front);
  assert.equal(tones.size, 8, 'sekiz kova sekiz ayrı ton üretmeli');

  const pal = materialFromSkin(style, 0.5);
  assert.equal(typeof pal.top, 'string');
  assert.equal(typeof pal.front, 'string');
  assert.equal(typeof pal.side, 'string');
});

test('deri sözlüğünde doku/grain/wear alanları eksiksiz', () => {
  for (const [id, style] of Object.entries(OBSTACLE_STYLES)) {
    assert.equal(typeof style.texture, 'string', `${id}.texture eksik`);
    assert.ok(Number(style.grain) > 0 && Number(style.grain) < 1, `${id}.grain [0,1) olmalı`);
    assert.ok(Number(style.wear) >= 0 && Number(style.wear) <= 1, `${id}.wear [0,1] olmalı`);
  }
});

test('obstacleStyle tema kimliğinden deriyi çözer (2.5D ve 2D yol aynı köprü)', () => {
  // 2.5D yolu `proj.theme` NESNESİNİ geçer (palet sözlüğü); tepeden bakış yolu
  // `FIELD_THEMES` KİMLİĞİNİ (string) geçer ve `fieldTheme` üzerinden çözülür.
  // İki yol da aynı `palette.block` alanını okur — köprü tek.
  for (const [id, palette] of Object.entries(THEMES)) {
    assert.equal(obstacleStyle({ theme: palette }), OBSTACLE_STYLES[palette.block], `${id} nesne yolu`);
  }
  assert.equal(obstacleStyle({ theme: 'reactor' }), OBSTACLE_STYLES.metal, 'string yolu (FIELD_THEMES)');
  assert.equal(obstacleStyle({ theme: 'reactor', variant: 'dark' }), OBSTACLE_STYLES.dark, 'açık variant kazanır');
});

// ---------------------------------------------------------------------------
// 7. Kaynak taraması: yasaklı API'lar engel çizim yolunda yok
// ---------------------------------------------------------------------------
test('engel çizim yolu kare başına desen/konvolüsyon/getImageData üretmez', () => {
  // Doku bir kez üretilen bir TUVALDEN blit edilir; `createPattern` deseni her
  // karede yeniden kurar (CPU + GPU hızlı yolunu kapatır), `shadowBlur`
  // konvolüsyon yapar, `getImageData` GPU'dan okuma zorlar.
  //
  // Kapsam bilinçli olarak `arenaKit.js`tir: `projection2d.js` zemin katmanı
  // için ctx-başına ÖNBELLEKLİ bir `cachedPattern` taşır (karede yeniden
  // kurulmaz). Engel yolunda desen hiç yoktur — asıl garanti zaten
  // `strictRecorder`'dır: çizim sırasında desen/gradyan üretilirse patlar
  // (bkz. bu dosyanın ilk iki testi).
  const src = readFileSync(join(process.cwd(), 'src/core/arenaKit.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['createPattern', 'shadowBlur', 'getImageData']) {
    assert.ok(!src.includes(banned), `arenaKit.js: ${banned} yasak (§9)`);
  }
});
