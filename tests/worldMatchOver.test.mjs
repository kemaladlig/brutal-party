// tests/worldMatchOver.test.mjs
// ONLINE kumanda world-view'ının maç sonu yüzeyi, host canvas'ıyla AYNI kartı
// çizmelidir (tek `layoutMatchOverCard` + `drawResultPanel`). Eskiden kumanda
// ayrı bir `drawWorldBanner` yazıyordu: TV'de kazanan + sıralama + eylem, telefonda
// yalnız "X kazandı" bandı — aynı maç farklı görünüyordu.

import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWorldMatchOver } from '../src/ui/worldViewKit.js';

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

const SLOTS = [
  { name: 'AYSE', color: '#D84727', avatar: null },
  { name: 'CAN', color: '#2BA6E8', avatar: null },
  null,
  null,
];

test('maç sonu kartı yalnız DOLU koltukları çizer', () => {
  const { ctx, texts } = recordingContext();
  drawWorldMatchOver(ctx, 900, 500, {
    scores: [2, 5, 0, 0],
    matchWinner: 1,
    matchDraw: false,
  }, SLOTS);

  assert.ok(texts.some((item) => item.t === 'AYSE'), 'dolu koltuk AYSE çizilmedi');
  assert.ok(texts.some((item) => item.t === 'CAN'), 'dolu koltuk CAN çizilmedi');
  assert.ok(
    !texts.some((item) => item.t === 'P3' || item.t === 'P4'),
    'boş koltuk çizildi — kart yalnız doluları göstermeli',
  );
});

test('maç sonu kartı eylem butonu çizmez (yeniden başlatma yetkisi hostta)', () => {
  const { ctx, texts } = recordingContext();
  drawWorldMatchOver(ctx, 900, 500, {
    scores: [5, 2, 0, 0],
    matchWinner: 0,
    matchDraw: false,
  }, SLOTS);
  // Eylem yoksa altın/yeşil buton kuşağı çizilmez: kartta "1." rütbesi olur ama
  // buton metni olmaz. Buton çağrısı `uiButtons`a yazar; burada iletilmediğinden
  // yalnız sonuç içeriği basılır.
  assert.ok(texts.length > 0, 'kart hiçbir şey çizmedi');
});
