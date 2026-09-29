// tests/worldRoundBanner.test.mjs
// ONLINE kumanda raunt-sonu bandı, host canvas'ıyla AYNI `renderRoundBanner`
// çizimini kullanmalıdır: aynı başlık kuralı (`game.won` / `game.draw`), aynı
// kazanan rengi ve aynı geri sayım. Eskiden kumanda ayrı bir `drawWorldBanner`
// yazıyordu; panel ölçüsü, rengi ve sayısı host'tan sapıyordu.

import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWorldRoundBanner } from '../src/ui/worldViewKit.js';
import { t } from '../src/i18n.js';

function recordingContext() {
  const calls = [];
  const noop = () => {};
  const target = {
    measureText: (text) => ({ width: String(text).length * 8 }),
    fillText(text, x, y) { calls.push({ text: String(text), x, y, fill: target.fillStyle }); },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  const ctx = new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : noop; },
    set(obj, prop, value) { obj[prop] = value; return true; },
  });
  return { ctx, calls };
}

test('raunt bandı host ile aynı başlığı ve kazanan rengini kullanır', () => {
  const { ctx, calls } = recordingContext();
  const slots = [{ name: 'AYSE', color: '#111111' }, { name: 'CAN', color: '#2BA6E8' }];
  drawWorldRoundBanner(ctx, 800, 450, { roundWinner: 1 }, slots, { roundGap: 0 });
  const title = calls.find((c) => c.text === t('game.won', 'CAN'));
  assert.ok(title, 'kazanan başlığı `game.won` üzerinden yazılır');
  assert.equal(title.fill, '#2BA6E8', 'başlık rengi kazananın koltuk rengidir');
});

test('raunt bandı berabere ise `game.draw` başlığı yazar', () => {
  const { ctx, calls } = recordingContext();
  drawWorldRoundBanner(ctx, 800, 450, {}, [{ name: 'AYSE', color: '#111111' }], {});
  assert.ok(calls.some((c) => c.text === t('game.draw')));
});

test('raunt bandı geri sayımı host ile aynı sayıyla basar', () => {
  const { ctx, calls } = recordingContext();
  drawWorldRoundBanner(ctx, 800, 450, { roundWinner: 0 }, [{ name: 'AYSE', color: '#111111' }], { roundGap: 2.5 });
  assert.ok(calls.some((c) => c.text === '3'), 'ceil(2.5) = 3');
});

test('geri sayım yokken band hiçbir sayı basmaz', () => {
  const { ctx, calls } = recordingContext();
  drawWorldRoundBanner(ctx, 800, 450, { roundWinner: 0 }, [{ name: 'AYSE', color: '#111111' }], { roundGap: 0 });
  assert.ok(!calls.some((c) => /^\d+$/.test(c.text)));
});
