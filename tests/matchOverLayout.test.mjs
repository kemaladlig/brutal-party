// tests/matchOverLayout.test.mjs
// Oyun sonu yüzeyinin düzen sözleşmesi.
//
// Neden kilitlendi: final kartının yüksekliği bir süredir 230 tasarım px'te
// SABİTTİ. Telefonda 4 satır ile buton arasında ölçülen boşluk 8 px'e
// iniyordu ve beşinci satır butonun üstüne biniyordu; butonun kendisi de
// 33-39 px'e düşüp dokunma tabanının (44 px) altında kalıyordu. Telefonun
// tam ekran sonuç katmanı ise portre sütunuyla yazıldığı için yatayda
// taşıyor ve `overflow: hidden` içeriği üstten/alttan kırpıyordu.
// Bu test üçü birden olmasın diye yazıldı.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutMatchOverCard, renderMatchOver } from '../src/ui/hud.js';
import { computePlayfield } from '../src/core/playfield.js';
import { UI_SIZES } from '../src/ui/tokens.js';

const EPS = 0.51;

// Yatay telefonlar (kısa kenar < 540 → MOBILE), tablet ve masaüstü/TV.
const VIEWPORTS = [
  [568, 320, 'iPhone SE (1. nesil) yatay'],
  [667, 375, 'iPhone SE yatay'],
  [740, 360, 'ucuz Android yatay'],
  [844, 390, 'iPhone 14 yatay'],
  [932, 430, 'iPhone 15 Pro Max yatay'],
  [1024, 768, 'iPad portre'],
  [1280, 720, 'masaüstü'],
  [1920, 1080, 'TV'],
];

function cardFor(width, height, { rowCount = 4, actionCount = 2 } = {}) {
  return layoutMatchOverCard(computePlayfield(width, height, 'standard'), { rowCount, actionCount });
}

test('final kartı her viewporda sahanın içinde kalır', () => {
  for (const [w, h, label] of VIEWPORTS) {
    const arena = computePlayfield(w, h, 'standard');
    const g = cardFor(w, h);
    assert.ok(g.w > 0 && g.h > 0, `${label}: kart kutusu çökmüş`);
    assert.ok(g.x >= arena.left - EPS, `${label}: kart sol kenardan taşıyor`);
    assert.ok(g.x + g.w <= arena.right + EPS, `${label}: kart sağ kenardan taşıyor`);
    assert.ok(g.y >= arena.top - EPS, `${label}: kart üst kenardan taşıyor`);
    assert.ok(g.y + g.h <= arena.bottom + EPS, `${label}: kart alt kenardan taşıyor`);
  }
});

test('sıralama satırları ile eylem kuşağı hiçbir sayıda çakışmaz', () => {
  for (const [w, h, label] of VIEWPORTS) {
    for (const rowCount of [0, 1, 4]) {
      const g = cardFor(w, h, { rowCount });
      for (let i = 1; i < g.rows.length; i++) {
        assert.ok(
          g.rows[i].y >= g.rows[i - 1].y + g.rows[i - 1].h,
          `${label}: satır ${i} önceki satırla çakışıyor`,
        );
      }
      const lastRow = g.rows[g.rows.length - 1];
      const firstAction = g.actions[0];
      if (lastRow && firstAction) {
        assert.ok(
          firstAction.y - (lastRow.y + lastRow.h) >= UI_SIZES.finalSectionGap * 0.6,
          `${label}: satır ↔ buton boşluğu ${firstAction.y - (lastRow.y + lastRow.h)}px'e indi`,
        );
      }
      for (const rect of [...g.rows, ...g.actions]) {
        assert.ok(
          rect.x >= g.x - EPS && rect.y >= g.y - EPS
          && rect.x + rect.w <= g.x + g.w + EPS
          && rect.y + rect.h <= g.y + g.h + EPS,
          `${label}: içerik kutusu kartın dışında`,
        );
      }
    }
  }
});

test('eylem butonları dokunma tabanının altına inmez', () => {
  for (const [w, h, label] of VIEWPORTS) {
    for (const actionCount of [1, 2]) {
      const g = cardFor(w, h, { actionCount });
      assert.equal(g.actions.length, actionCount, `${label}: eylem sayısı`);
      for (const btn of g.actions) {
        assert.ok(btn.h >= UI_SIZES.finalBtnHMin, `${label}: buton yüksekliği ${btn.h}px`);
        assert.ok(btn.w >= UI_SIZES.finalBtnMinW, `${label}: buton genişliği ${btn.w}px`);
      }
    }
  }
});

test('yatay yüzey iki sütuna bölünür, kareye yakın yüzey bölünmez', () => {
  assert.equal(cardFor(844, 390).split, true, 'telefon yatayda iki sütun olmalı');
  assert.equal(cardFor(1920, 1080).split, true, 'TV iki sütun olmalı');
  assert.equal(cardFor(1024, 768).split, false, 'iPad portre tek sütun kalmalı');
});

test('kazanan bloğu kartın içinde ve avatar ile ad çakışmaz', () => {
  for (const [w, h, label] of VIEWPORTS) {
    const g = cardFor(w, h);
    assert.ok(g.hero.cy - g.hero.r >= g.y - EPS, `${label}: avatar kartın üstünden taşıyor`);
    assert.ok(g.hero.cx - g.hero.r >= g.x - EPS, `${label}: avatar kartın solundan taşıyor`);
    assert.ok(g.hero.cy + g.hero.r <= g.y + g.h + EPS, `${label}: avatar kartın altından taşıyor`);
    assert.ok(
      g.name.x >= g.x - EPS && g.name.x + g.name.w <= g.x + g.w + EPS
      && g.name.y >= g.y - EPS && g.name.y + g.name.h <= g.y + g.h + EPS,
      `${label}: isim alanı kartın dışında`,
    );

    // Geniş yüzeyde ad avatarın ALTINDA (sütunun tüm genişliğini kullanır),
    // dar yüzeyde YANINDA. İkisinde de kutular kesişmez.
    const overlaps = g.name.x < g.hero.cx + g.hero.r
      && g.name.x + g.name.w > g.hero.cx - g.hero.r
      && g.name.y < g.hero.cy + g.hero.r
      && g.name.y + g.name.h > g.hero.cy - g.hero.r;
    assert.ok(!overlaps, `${label}: isim avatar kutusuyla çakışıyor`);
    if (g.split) {
      assert.ok(g.name.y >= g.hero.cy + g.hero.r, `${label}: yatayda ad avatarın altında olmalı`);
    }
  }
});

// --- Telefonun tam ekran sonuç katmanı (CSS + markup) -----------------------

test('sonuç ekranının yatay dalı var: dikey sütun kırpılma üretmez', () => {
  const css = readFileSync(new URL('../src/gamepad.css', import.meta.url), 'utf8');
  const landscape = /@media \(orientation: landscape\)[^{]*\{([^]*?)\n\}/g;
  let coversResult = false;
  let block;
  while ((block = landscape.exec(css)) !== null) {
    if (block[1].includes('.gamepad-result')) coversResult = true;
  }
  assert.ok(coversResult, 'gamepad.css: .gamepad-result için landscape dalı yok');
  assert.match(css, /\.gamepad-result\s*\{[^}]*overflow-y:\s*auto/, 'sonuç yüzeyi kendi içinde kaydırabilir olmalı');
});

test('sonuç ekranı iki grup sarmalayıcısıyla çizilir', () => {
  const markup = readFileSync(new URL('../src/gamepad.js', import.meta.url), 'utf8');
  assert.match(markup, /class="result-lead"/, 'başlık bloğu sarmalayıcısı yok');
  assert.match(markup, /class="result-board"/, 'skor bloğu sarmalayıcısı yok');
});

test('motorlar sıralama satırlarını kopya metin yerine veri olarak verir', () => {
  const src = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  assert.match(src, /row\.name/, 'kart yapılandırılmış satır okumuyor');
  assert.doesNotMatch(src, /row\.text/, 'kart hâlâ kopya metin biçimine bakıyor');
});

// --- Çizim davranışı -------------------------------------------------------

function recordingContext() {
  const texts = [];
  const noop = () => {};
  const target = {
    measureText: (t) => ({ width: String(t).length * 8 }),
    fillText: (t, x, y) => { texts.push({ t: String(t), x, y }); },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  const ctx = new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : noop; },
    set(obj, prop, value) { obj[prop] = value; return true; },
  });
  return { ctx, texts };
}

test('puanını taşıyan satırlar kartta puan sırasına dizilir ve rütbelendirilir', () => {
  const arena = computePlayfield(1280, 720, 'standard');
  const { ctx, texts } = recordingContext();
  renderMatchOver(ctx, {
    arena,
    uiButtons: [],
    headline: 'ŞAMPİYON',
    winnerName: 'CAN',
    winnerColor: '#35B36A',
    rows: [
      { name: 'AHMET', value: '1★', score: 1, color: '#F0483C' },
      { name: 'CAN', value: '4★', score: 4, color: '#35B36A' },
      { name: 'ZEHRA', value: '2★', score: 2, color: '#FFD24A' },
    ],
    onRestart: () => {},
  });

  const g = layoutMatchOverCard(arena, { rowCount: 3, actionCount: 1 });
  // Kazanan adı da satır metinlerinden biridir: çizim x'ine göre yalnız
  // sıralama bandındaki etiketler sayılır (lead sütunu ayrı yerde durur).
  const inBoard = (item) => item.x >= g.rows[0].x - 1;
  const drawn = texts
    .filter((item) => ['AHMET', 'CAN', 'ZEHRA'].includes(item.t) && inBoard(item))
    .sort((a, b) => a.y - b.y)
    .map((item) => item.t);
  assert.deepEqual(drawn, ['CAN', 'ZEHRA', 'AHMET'], 'kart puan sırasına dizilmedi');
  const ranks = texts
    .filter((item) => ['1', '2', '3'].includes(item.t) && inBoard(item))
    .map((item) => item.t);
  assert.deepEqual(ranks, ['1', '2', '3'], 'rütbe numaraları çizilmedi');
});

test('puan taşımayan listede uydurma rütbe çizilmez', () => {
  const arena = computePlayfield(1280, 720, 'standard');
  const { ctx, texts } = recordingContext();
  renderMatchOver(ctx, {
    arena,
    uiButtons: [],
    headline: 'ŞAMPİYON',
    winnerName: 'AHMET',
    rows: [
      { name: 'AHMET', value: 'berabere', color: '#F0483C' },
      { name: 'CAN', value: 'berabere', color: '#35B36A' },
    ],
    onRestart: () => {},
  });
  const ranks = texts.filter((item) => ['1', '2'].includes(item.t));
  assert.equal(ranks.length, 0, 'puan yokken rütbe numarası basıldı');
});
